/**
 * Offer agent — price recommendation with traceable citations.
 *
 * Hallucination-resistance principle: the LLM never asserts a number.
 * It produces a *lookup spec* (what to fetch from where) plus a
 * *rationale template* (prose with {placeholders}). App code then:
 *
 *   1. Executes each lookup deterministically against pgvector
 *      (Context chunks for labor rates, scope phrasings) and the
 *      quotes/jobs tables (for historical price points + margins +
 *      win rates).
 *   2. Aggregates the lookups into labor_total, material_total,
 *      overhead, margin band, capacity signal.
 *   3. Fills the rationale template with real numbers.
 *   4. Builds a citation list mapping each number back to its source.
 *
 * Output:
 *   - recommended_low / center / high
 *   - confidence (0-1, reflects retrieval coverage)
 *   - rationale_text
 *   - citations[]
 *
 * The LLM can be wrong about *what to look up*, but it can never
 * make up *what was found*. That's the protocol-level guarantee.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { generateText, extractJson } from './ai';
import { retrieve } from './context';
import type { CloudflareEnv } from './supabase';

export interface LookupSpec {
  labor_lookups: Array<{ trade: string; hours: number; rationale?: string }>;
  material_lookups: Array<{ item: string; quantity: number; unit: string; rationale?: string }>;
  win_rate_lookups: Array<{ job_type: string; candidate_price_band: string }>;
  margin_lookups: Array<{ service_line: string }>;
  capacity_lookups: Array<{ service_line: string; weeks_ahead: number }>;
  rationale_template: string;
}

export interface OfferCitation {
  source: 'context' | 'quotes' | 'jobs' | 'shop_defaults';
  ref: string;
  contribution: string;
  amount?: number;
}

export interface OfferRecommendation {
  lookup_spec: LookupSpec;
  computed: {
    labor_total: number;
    material_total: number;
    overhead: number;
    margin_low_pct: number;
    margin_center_pct: number;
    margin_high_pct: number;
    capacity_narrative: string;
    win_rate_narrative: string;
  };
  recommended_low: number;
  recommended_center: number;
  recommended_high: number;
  confidence: number;
  rationale_text: string;
  citations: OfferCitation[];
}

const SYSTEM_PROMPT = `You are Brief's Offer agent. You produce a LOOKUP SPEC,
not a price. App code will execute the lookups against real data and fill
in the numbers; you must never assert a number you weren't given.

Return ONLY this JSON shape — no fences, no preamble:

{
  "labor_lookups": [
    { "trade": "stucco_journeyman" | "stucco_helper" | ...,
      "hours": number, "rationale": "<= 100 chars why" }
  ],
  "material_lookups": [
    { "item": "ADEX basecoat" | "wire lath" | ...,
      "quantity": number, "unit": "sqft" | "lf" | "each" | ...,
      "rationale": "<= 100 chars why" }
  ],
  "win_rate_lookups": [
    { "job_type": "stucco_conventional" | "EIFS_commercial" | ...,
      "candidate_price_band": "20k_40k" | "40k_75k" | ... }
  ],
  "margin_lookups": [
    { "service_line": "stucco_conventional" | "EIFS" | ... }
  ],
  "capacity_lookups": [
    { "service_line": "stucco" | ..., "weeks_ahead": 4 | 8 | 12 }
  ],
  "rationale_template": "Plain prose with {placeholders}. Available
    placeholders: {labor_total}, {material_total}, {overhead}, {margin_pct},
    {recommended_low}, {recommended_center}, {recommended_high},
    {capacity_narrative}, {win_rate_narrative}. App code fills these
    deterministically."
}

Rules:
- ONLY produce a lookup spec. Do not output specific dollar amounts.
- Hour estimates are fine (those are scope-driven, not price-asserted).
- The trade names and service_line tags should match what's in the
  shop's Context profile. Stay close to the categories you'd see in
  past quotes.
- rationale_template: short, professional, no fluff. Explain WHY the
  recommendation lands where it does (capacity tight? margin healthy?
  historical win-rate at this size?).`;

interface LaborRates {
  [trade: string]: number; // $/hr loaded
}

interface MaterialRates {
  [item: string]: { unit_cost: number; unit: string };
}

export interface OfferInputs {
  scope_summary: string;
  line_items_preview?: Array<{ description: string; qty: number; unit: string }>;
  service_line_hint?: string;
}

/** Default loaded labor rates by trade. In production these come
 * from shop.labor_rates_by_trade (jsonb) or a per-job override; for
 * v1 we read shop.default_labor_rate and fan out a small map. */
async function loadLaborRates(svc: SupabaseClient, shopId: string): Promise<LaborRates> {
  const { data } = await svc
    .from('shops')
    .select('default_labor_rate, default_overhead_pct')
    .eq('id', shopId)
    .maybeSingle();
  const base = Number(data?.default_labor_rate ?? 92);
  // Generic spread until per-trade rates exist on shops.
  return {
    stucco_journeyman: base * 1.0,
    stucco_helper: base * 0.65,
    stucco_foreman: base * 1.25,
    eifs_journeyman: base * 1.1,
    plaster_journeyman: base * 1.05,
    laborer: base * 0.55,
    default: base,
  };
}

/** Default material rates. Like labor, this is a sketch — a real
 * impl pulls from a materials_catalog table or per-shop overrides. */
function defaultMaterialRates(): MaterialRates {
  return {
    'ADEX basecoat': { unit_cost: 0.42, unit: 'sqft' },
    'wire lath': { unit_cost: 0.78, unit: 'sqft' },
    'sand-float finish': { unit_cost: 0.55, unit: 'sqft' },
    'integral pigment': { unit_cost: 0.18, unit: 'sqft' },
    'paper backing': { unit_cost: 0.21, unit: 'sqft' },
    cement: { unit_cost: 14.5, unit: 'each' },
    sand: { unit_cost: 28, unit: 'cy' },
  };
}

/** Look up the shop's historical margin for a service line. Falls
 * back to default_margin_range_low/high when n < 8. */
async function lookupMargin(
  svc: SupabaseClient,
  shopId: string,
  serviceLine: string,
): Promise<{ low_pct: number; center_pct: number; high_pct: number; n: number }> {
  const { data: similar } = await svc
    .from('quotes')
    .select('margin_pct, scope_summary')
    .eq('shop_id', shopId)
    .not('margin_pct', 'is', null)
    .ilike('scope_summary', `%${serviceLine.replace(/_/g, ' ')}%`)
    .limit(50);

  const margins = (similar ?? [])
    .map((r) => Number(r.margin_pct))
    .filter((m) => Number.isFinite(m) && m > 0);

  if (margins.length < 8) {
    const { data: shop } = await svc
      .from('shops')
      .select('default_margin_range_low, default_margin_range_high')
      .eq('id', shopId)
      .maybeSingle();
    const lo = Number(shop?.default_margin_range_low ?? 25);
    const hi = Number(shop?.default_margin_range_high ?? 40);
    return { low_pct: lo, center_pct: (lo + hi) / 2, high_pct: hi, n: margins.length };
  }

  margins.sort((a, b) => a - b);
  const pct = (p: number) => margins[Math.floor((margins.length - 1) * p)];
  return {
    low_pct: pct(0.25),
    center_pct: pct(0.5),
    high_pct: pct(0.75),
    n: margins.length,
  };
}

/** Capacity check: count APPROVED jobs scheduled in the next N weeks. */
async function lookupCapacity(
  svc: SupabaseClient,
  shopId: string,
  weeksAhead: number,
): Promise<{ scheduled_count: number; narrative: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const horizonDate = new Date(Date.now() + weeksAhead * 7 * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  const { count } = await svc
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .gte('scheduled_start', today)
    .lte('scheduled_start', horizonDate);
  const n = count ?? 0;
  let narrative = '';
  if (n >= 4) narrative = `Tight — ${n} jobs scheduled in the next ${weeksAhead} weeks. Hold pricing firm.`;
  else if (n >= 2) narrative = `Moderate — ${n} jobs in the next ${weeksAhead} weeks. Standard pricing.`;
  else narrative = `Open — only ${n} jobs scheduled in the next ${weeksAhead} weeks. Some flex on price to win.`;
  return { scheduled_count: n, narrative };
}

/** Look up win rate by job type + price band. Returns null when
 * sample size too small (n < 15). */
async function lookupWinRate(
  svc: SupabaseClient,
  shopId: string,
  jobType: string,
  band: string,
): Promise<{ hit_rate: number | null; n: number; narrative: string }> {
  const bandRange = parseBand(band);
  if (!bandRange) return { hit_rate: null, n: 0, narrative: '' };
  const { data } = await svc
    .from('quotes')
    .select('state, total, scope_summary')
    .eq('shop_id', shopId)
    .gte('total', bandRange.low)
    .lte('total', bandRange.high)
    .in('state', ['WON', 'LOST', 'WITHDRAWN'])
    .ilike('scope_summary', `%${jobType.replace(/_/g, ' ')}%`)
    .limit(200);
  const closed = data ?? [];
  if (closed.length < 15) {
    return {
      hit_rate: null,
      n: closed.length,
      narrative: `Win-rate sample size below threshold (n=${closed.length}, need 15+).`,
    };
  }
  const wins = closed.filter((q) => q.state === 'WON').length;
  const rate = wins / closed.length;
  return {
    hit_rate: rate,
    n: closed.length,
    narrative: `${Math.round(rate * 100)}% win rate for ${jobType.replace(/_/g, ' ')} in the ${band.replace(/_/g, '–')} range (n=${closed.length}).`,
  };
}

function parseBand(b: string): { low: number; high: number } | null {
  const m = b.match(/^(\d+)k?_(\d+)k?$/);
  if (!m) return null;
  return { low: parseInt(m[1], 10) * 1000, high: parseInt(m[2], 10) * 1000 };
}

/**
 * Main entry. Given a quote's scope + (optional) line item preview,
 * produces a price recommendation with full citation trail.
 */
export async function recommendOffer(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  inputs: OfferInputs,
): Promise<OfferRecommendation> {
  // Step 1: pull Context chunks so the LLM has the shop's pricing
  // language + scope phrasings to anchor on.
  const profileBits = await retrieve(env, svc, shopId, inputs.scope_summary, {
    chunk_types: ['pricing_rule', 'scope_pattern', 'service_definition', 'past_quote_summary'],
    limit: 6,
  });
  const contextBlock = profileBits
    .map((c, i) => `[${i + 1}] (${c.chunk_type}/${c.source_ref}) ${c.content}`)
    .join('\n');

  // Step 2: ask LLM for a lookup spec.
  const userMsg =
    `Scope summary: ${inputs.scope_summary}\n` +
    (inputs.line_items_preview?.length
      ? `Line items (operator-edited preview):\n${inputs.line_items_preview.map((li) => `  - ${li.qty} ${li.unit} ${li.description}`).join('\n')}\n`
      : '') +
    `Service line hint: ${inputs.service_line_hint ?? '(none — infer from scope)'}\n\n` +
    `Shop context chunks:\n${contextBlock || '(none retrieved — Context not seeded yet)'}\n\n` +
    `Return the lookup spec JSON now.`;

  let raw = '';
  try {
    raw = await generateText(env, {
      max_tokens: 2000,
      temperature: 0.2,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });
  } catch (e) {
    console.warn('[offer] generation failed', e);
  }

  const spec = (extractJson<LookupSpec>(raw) as LookupSpec | null) ?? emptySpec();

  // Step 3: execute the lookups deterministically.
  const laborRates = await loadLaborRates(svc, shopId);
  const materialRates = defaultMaterialRates();
  const citations: OfferCitation[] = profileBits.map((c) => ({
    source: 'context',
    ref: `${c.chunk_type}/${c.source_ref}`,
    contribution: 'context retrieval',
  }));

  let laborTotal = 0;
  for (const l of spec.labor_lookups ?? []) {
    const rate = laborRates[l.trade] ?? laborRates.default;
    const amt = rate * (Number(l.hours) || 0);
    laborTotal += amt;
    citations.push({
      source: 'shop_defaults',
      ref: `labor_rate/${l.trade}`,
      contribution: `${l.hours}hr × $${rate.toFixed(2)}/hr = $${amt.toFixed(2)}`,
      amount: amt,
    });
  }

  let materialTotal = 0;
  for (const m of spec.material_lookups ?? []) {
    const rate = materialRates[m.item];
    if (!rate) continue;
    const amt = rate.unit_cost * (Number(m.quantity) || 0);
    materialTotal += amt;
    citations.push({
      source: 'shop_defaults',
      ref: `material_rate/${m.item}`,
      contribution: `${m.quantity} ${m.unit} × $${rate.unit_cost.toFixed(2)} = $${amt.toFixed(2)}`,
      amount: amt,
    });
  }

  // Pick first margin/capacity/win_rate lookup as the headline.
  const marginLookup = spec.margin_lookups?.[0]?.service_line ?? inputs.service_line_hint ?? 'general';
  const margin = await lookupMargin(svc, shopId, marginLookup);
  citations.push({
    source: 'quotes',
    ref: `margin/${marginLookup}`,
    contribution: `historical p25/p50/p75 = ${margin.low_pct.toFixed(1)}%/${margin.center_pct.toFixed(1)}%/${margin.high_pct.toFixed(1)}% (n=${margin.n})`,
  });

  const capacityLookup = spec.capacity_lookups?.[0] ?? { service_line: marginLookup, weeks_ahead: 8 };
  const capacity = await lookupCapacity(svc, shopId, capacityLookup.weeks_ahead);
  citations.push({
    source: 'jobs',
    ref: `capacity/${capacityLookup.weeks_ahead}wk`,
    contribution: capacity.narrative,
  });

  const winRateLookup = spec.win_rate_lookups?.[0];
  let winRateNarrative = '';
  if (winRateLookup) {
    const wr = await lookupWinRate(svc, shopId, winRateLookup.job_type, winRateLookup.candidate_price_band);
    winRateNarrative = wr.narrative;
    citations.push({
      source: 'quotes',
      ref: `winrate/${winRateLookup.job_type}/${winRateLookup.candidate_price_band}`,
      contribution: wr.narrative,
    });
  }

  // Step 4: compose final numbers.
  const { data: shop } = await svc
    .from('shops')
    .select('default_overhead_pct')
    .eq('id', shopId)
    .maybeSingle();
  const overheadPct = Number(shop?.default_overhead_pct ?? 18);
  const overhead = (laborTotal + materialTotal) * (overheadPct / 100);
  const costBasis = laborTotal + materialTotal + overhead;
  const low = round(costBasis * (1 + margin.low_pct / 100), 2);
  const center = round(costBasis * (1 + margin.center_pct / 100), 2);
  const high = round(costBasis * (1 + margin.high_pct / 100), 2);

  // Confidence: function of retrieval coverage + sample sizes.
  const retrievalFactor = profileBits.length >= 4 ? 1 : profileBits.length / 4;
  const marginFactor = margin.n >= 8 ? 1 : margin.n / 8;
  const confidence = round(0.4 + 0.3 * retrievalFactor + 0.3 * marginFactor, 3);

  // Fill the rationale template.
  const template =
    spec.rationale_template ||
    'Recommended {recommended_center} (range {recommended_low}–{recommended_high}). Cost basis {labor_total} labor + {material_total} materials + {overhead} overhead. Margin {margin_pct}%. {capacity_narrative} {win_rate_narrative}';
  const rationale = template
    .replace(/\{labor_total\}/g, money(laborTotal))
    .replace(/\{material_total\}/g, money(materialTotal))
    .replace(/\{overhead\}/g, money(overhead))
    .replace(/\{margin_pct\}/g, `${margin.center_pct.toFixed(1)}`)
    .replace(/\{recommended_low\}/g, money(low))
    .replace(/\{recommended_center\}/g, money(center))
    .replace(/\{recommended_high\}/g, money(high))
    .replace(/\{capacity_narrative\}/g, capacity.narrative)
    .replace(/\{win_rate_narrative\}/g, winRateNarrative);

  return {
    lookup_spec: spec,
    computed: {
      labor_total: round(laborTotal, 2),
      material_total: round(materialTotal, 2),
      overhead: round(overhead, 2),
      margin_low_pct: margin.low_pct,
      margin_center_pct: margin.center_pct,
      margin_high_pct: margin.high_pct,
      capacity_narrative: capacity.narrative,
      win_rate_narrative: winRateNarrative,
    },
    recommended_low: low,
    recommended_center: center,
    recommended_high: high,
    confidence,
    rationale_text: rationale,
    citations,
  };
}

function emptySpec(): LookupSpec {
  return {
    labor_lookups: [],
    material_lookups: [],
    win_rate_lookups: [],
    margin_lookups: [],
    capacity_lookups: [],
    rationale_template: '',
  };
}

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
