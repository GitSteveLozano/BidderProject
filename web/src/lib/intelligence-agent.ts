/**
 * Intelligence agent — strategic findings, not tactical recs.
 *
 * Four output types. Each runs as a pure deterministic analysis over
 * shop data (quotes / jobs / winloss_signals / followup_schedules),
 * then formats findings via the LLM for operator-facing prose.
 *
 *   1. capacity_pricing
 *      "You're at 84% utilization for stucco in May. The Esprit Heights
 *      quote at $175k is priced for 29% margin — schedule supports
 *      holding firm, don't discount."
 *
 *   2. winrate_by_size
 *      "60% hit rate under $40k, 12% over $100k. Worth questioning
 *      whether to keep bidding the big ones." Requires n>=15.
 *
 *   3. margin_trend
 *      "Delivered margin on EIFS jobs trended 32% → 26% over the last
 *      four. Three of four ran labor 12-18% over. Recommend +12% labor
 *      buffer on next EIFS quote." Requires n>=8 per service line + JCR.
 *
 *   4. exclusions_drift
 *      "2 of last 8 stucco quotes were missing the rough-grade
 *      exclusion; both led to scope creep. Composition now auto-flags."
 *
 * Sample-size thresholds are hard gates — below threshold, the finding
 * is not produced (would mislead). Findings include the supporting
 * quote/job IDs so the operator can drill in.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { generateText } from './ai';
import type { CloudflareEnv } from './supabase';

export type FindingType =
  | 'capacity_pricing'
  | 'winrate_by_size'
  | 'margin_trend'
  | 'exclusions_drift';

export interface Finding {
  finding_type: FindingType;
  headline: string;
  body: string;
  supporting_quote_ids: string[];
  supporting_job_ids: string[];
  sample_size: number;
  projected_impact_usd: number | null;
  expires_at: string | null;
}

const WINLOSS_MIN_N = 15;
const SERVICE_LINE_MIN_N = 8;

const PROSE_SYSTEM = `You convert a structured analysis into operator-facing
prose. Return ONLY this JSON shape — no fences, no preamble.

{
  "headline": "<=90 chars, money-anchored when possible. Specific.",
  "body": "<=400 chars, 2-3 short sentences. Concrete data points. End
    with a recommended action if the analysis supports one."
}

Voice: builder-to-builder. No fluff. No "leverage", no "synergy".
Specific dollar figures and counts where the analysis provides them.`;

// ───────────────────────────────────────────────────────────────────
// 1. Capacity-aware pricing intelligence
// ───────────────────────────────────────────────────────────────────
export async function generateCapacityFindings(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
): Promise<Finding[]> {
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 56); // 8 weeks
  const horizonDate = horizon.toISOString().slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);
  const { data: scheduled } = await svc
    .from('jobs')
    .select('id, project_title, scheduled_start, scheduled_end, estimated_total, change_order_total')
    .eq('shop_id', shopId)
    .gte('scheduled_start', todayDate)
    .lte('scheduled_start', horizonDate);

  const { data: openQuotes } = await svc
    .from('quotes')
    .select('id, ref, scope_summary, total, margin_pct, state')
    .eq('shop_id', shopId)
    .in('state', ['AWAITING', 'RESPONDED']);

  if (!scheduled || !openQuotes || openQuotes.length === 0) return [];

  // Group scheduled jobs by a derived service-line tag (from project_title).
  // The Brief schema doesn't have a service_line column yet — we derive
  // a coarse bucket from keyword matches; precise grouping comes when
  // Intake stamps service_line on jobs in a later iteration.
  const byService = new Map<string, typeof scheduled>();
  for (const j of scheduled) {
    const k = deriveServiceLine(j.project_title ?? '');
    if (!byService.has(k)) byService.set(k, []);
    byService.get(k)!.push(j);
  }

  const findings: Finding[] = [];
  for (const [serviceLine, jobs] of byService.entries()) {
    if (jobs.length < 3) continue;
    // Open quotes whose scope_summary matches this service line.
    const matching = openQuotes.filter((q) =>
      (q.scope_summary ?? '').toLowerCase().includes(serviceLine.replace(/_/g, ' ')),
    );
    if (matching.length === 0) continue;

    const headlineQuote = matching.sort((a, b) => Number(b.total) - Number(a.total))[0];
    const utilization = Math.min(1, jobs.length / 5); // crude proxy until staff_count is wired

    const analysis = {
      service_line: serviceLine,
      scheduled_jobs: jobs.length,
      utilization_estimate: `${Math.round(utilization * 100)}%`,
      open_quotes_count: matching.length,
      headline_quote: {
        ref: headlineQuote.ref,
        total: Number(headlineQuote.total),
        margin_pct: Number(headlineQuote.margin_pct ?? 0),
      },
      recommendation: utilization >= 0.7 ? 'hold_firm' : 'normal',
    };

    const prose = await renderProse(env, 'capacity_pricing', analysis);
    findings.push({
      finding_type: 'capacity_pricing',
      headline: prose.headline,
      body: prose.body,
      supporting_quote_ids: matching.map((q) => q.id),
      supporting_job_ids: jobs.map((j) => j.id),
      sample_size: jobs.length,
      projected_impact_usd:
        utilization >= 0.7
          ? round(Number(headlineQuote.total) * 0.05, 2) // 5% discount avoided
          : null,
      // Capacity findings expire — utilization shifts weekly.
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
  }
  return findings;
}

// ───────────────────────────────────────────────────────────────────
// 2. Win-rate by deal size
// ───────────────────────────────────────────────────────────────────
export async function generateWinRateBySizeFindings(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
): Promise<Finding[]> {
  const { data } = await svc
    .from('quotes')
    .select('id, total, state')
    .eq('shop_id', shopId)
    .in('state', ['WON', 'LOST', 'WITHDRAWN'])
    .limit(500);
  const closed = (data ?? []).filter((q) => Number(q.total) > 0);
  if (closed.length < WINLOSS_MIN_N) return [];

  const bands: Array<{ label: string; low: number; high: number }> = [
    { label: 'under $20k', low: 0, high: 20000 },
    { label: '$20k–$40k', low: 20000, high: 40000 },
    { label: '$40k–$75k', low: 40000, high: 75000 },
    { label: '$75k–$150k', low: 75000, high: 150000 },
    { label: 'over $150k', low: 150000, high: Infinity },
  ];
  const cohorts = bands
    .map((b) => {
      const inBand = closed.filter((q) => Number(q.total) >= b.low && Number(q.total) < b.high);
      const wins = inBand.filter((q) => q.state === 'WON').length;
      return {
        label: b.label,
        n: inBand.length,
        wins,
        rate: inBand.length ? wins / inBand.length : 0,
        ids: inBand.map((q) => q.id),
      };
    })
    .filter((c) => c.n >= 5);
  if (cohorts.length < 2) return [];

  cohorts.sort((a, b) => b.rate - a.rate);
  const best = cohorts[0];
  const worst = cohorts[cohorts.length - 1];
  if (best.rate - worst.rate < 0.25) return []; // not a notable spread

  const analysis = {
    best_band: { label: best.label, rate: best.rate, n: best.n },
    worst_band: { label: worst.label, rate: worst.rate, n: worst.n },
    spread_pp: Math.round((best.rate - worst.rate) * 100),
    total_closed: closed.length,
  };
  const prose = await renderProse(env, 'winrate_by_size', analysis);
  return [
    {
      finding_type: 'winrate_by_size',
      headline: prose.headline,
      body: prose.body,
      supporting_quote_ids: [...best.ids, ...worst.ids],
      supporting_job_ids: [],
      sample_size: closed.length,
      projected_impact_usd: null,
      expires_at: null,
    },
  ];
}

// ───────────────────────────────────────────────────────────────────
// 3. Delivered margin trend by service line
// ───────────────────────────────────────────────────────────────────
export async function generateMarginTrendFindings(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
): Promise<Finding[]> {
  // Schema today: jobs has estimated_total + actual_total + variance_pct.
  // Approximation: delivered margin ≈ quote margin_pct − variance_pct.
  // Real margin computation requires JCR cost-line reconciliation; that
  // wires up when JCR data lands. Until then this proxy catches the
  // biggest drift signal (jobs ran over budget) without claiming false
  // precision.
  const { data } = await svc
    .from('jobs')
    .select('id, project_title, quote_id, estimated_total, actual_total, variance_pct, actual_end')
    .eq('shop_id', shopId)
    .not('actual_end', 'is', null)
    .not('actual_total', 'is', null)
    .order('actual_end', { ascending: false })
    .limit(200);

  if (!data || data.length === 0) return [];

  // Pull quote margins for the matched quotes so we can compute the proxy.
  const quoteIds = data.map((j) => j.quote_id).filter(Boolean);
  const { data: quotes } = quoteIds.length
    ? await svc
        .from('quotes')
        .select('id, margin_pct')
        .in('id', quoteIds)
    : { data: [] as Array<{ id: string; margin_pct: number | null }> };
  const marginByQuote = new Map<string, number>(
    (quotes ?? [])
      .filter((q) => q.margin_pct != null)
      .map((q) => [q.id, Number(q.margin_pct)]),
  );

  const byLine = new Map<string, typeof data>();
  for (const j of data) {
    const k = deriveServiceLine(j.project_title ?? '');
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k)!.push(j);
  }

  const findings: Finding[] = [];
  for (const [serviceLine, jobs] of byLine.entries()) {
    if (jobs.length < SERVICE_LINE_MIN_N) continue;
    // Trend: compare first-half to second-half margin proxy.
    const margins = jobs
      .map((j) => {
        const quoted = marginByQuote.get(j.quote_id);
        const variance = Number(j.variance_pct);
        if (quoted == null || !Number.isFinite(variance)) return null;
        return quoted - variance;
      })
      .filter((m): m is number => m != null && m > 0);
    if (margins.length < SERVICE_LINE_MIN_N) continue;
    const mid = Math.floor(margins.length / 2);
    const recent = margins.slice(0, mid);
    const older = margins.slice(mid);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const recentAvg = avg(recent);
    const olderAvg = avg(older);
    const drift = recentAvg - olderAvg;
    if (Math.abs(drift) < 3) continue; // < 3pp not actionable

    const analysis = {
      service_line: serviceLine,
      recent_avg_margin_pct: round(recentAvg, 1),
      prior_avg_margin_pct: round(olderAvg, 1),
      drift_pp: round(drift, 1),
      sample_size: jobs.length,
      direction: drift < 0 ? 'eroding' : 'improving',
    };
    const prose = await renderProse(env, 'margin_trend', analysis);
    findings.push({
      finding_type: 'margin_trend',
      headline: prose.headline,
      body: prose.body,
      supporting_quote_ids: [],
      supporting_job_ids: jobs.map((j) => j.id),
      sample_size: jobs.length,
      projected_impact_usd: null,
      expires_at: null,
    });
  }
  return findings;
}

// ───────────────────────────────────────────────────────────────────
// 4. Exclusions drift — quotes missing standard exclusions
// ───────────────────────────────────────────────────────────────────
export async function generateExclusionsDriftFindings(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
): Promise<Finding[]> {
  // Pull standard exclusions from Context.
  const { data: chunks } = await svc
    .from('company_profile_chunks')
    .select('source_ref, content')
    .eq('shop_id', shopId)
    .eq('chunk_type', 'exclusion');
  if (!chunks || chunks.length === 0) return [];

  // Look at last 8 quotes' free-text scope sections. (When a dedicated
  // exclusions_text column exists we'll include it too.)
  const { data: recent } = await svc
    .from('quotes')
    .select('id, ref, scope_summary')
    .eq('shop_id', shopId)
    .in('state', ['SENT', 'WON', 'LOST', 'RESPONDED'])
    .order('created_at', { ascending: false })
    .limit(8);
  if (!recent || recent.length < SERVICE_LINE_MIN_N) return [];

  const findings: Finding[] = [];
  for (const exclusion of chunks) {
    const keyword = exclusion.source_ref.replace(/^exclusion\//, '').replace(/_/g, ' ');
    if (keyword.length < 3) continue;
    const missing = recent.filter((q) => {
      const text = (q.scope_summary ?? '').toLowerCase();
      return !text.includes(keyword.toLowerCase());
    });
    if (missing.length < 2) continue;

    const analysis = {
      exclusion_keyword: keyword,
      missing_count: missing.length,
      sample_size: recent.length,
      missing_refs: missing.map((q) => q.ref).filter(Boolean),
    };
    const prose = await renderProse(env, 'exclusions_drift', analysis);
    findings.push({
      finding_type: 'exclusions_drift',
      headline: prose.headline,
      body: prose.body,
      supporting_quote_ids: missing.map((q) => q.id),
      supporting_job_ids: [],
      sample_size: recent.length,
      projected_impact_usd: null,
      expires_at: null,
    });
  }
  return findings;
}

async function renderProse(
  env: CloudflareEnv,
  findingType: FindingType,
  analysis: Record<string, unknown>,
): Promise<{ headline: string; body: string }> {
  try {
    const raw = await generateText(env, {
      max_tokens: 400,
      temperature: 0.3,
      json: true,
      messages: [
        { role: 'system', content: PROSE_SYSTEM },
        {
          role: 'user',
          content: `Finding type: ${findingType}\nAnalysis:\n${JSON.stringify(analysis, null, 2)}\n\nReturn the JSON.`,
        },
      ],
    });
    const parsed = JSON.parse(raw.replace(/```(?:json)?/g, '').trim()) as {
      headline?: string;
      body?: string;
    };
    return {
      headline: parsed.headline ?? `Finding: ${findingType}`,
      body: parsed.body ?? JSON.stringify(analysis),
    };
  } catch {
    return {
      headline: `Finding: ${findingType.replace(/_/g, ' ')}`,
      body: JSON.stringify(analysis),
    };
  }
}

/**
 * Run all four finding types and persist new ones. Returns the count
 * of findings written. Idempotent within a run-window: skips inserting
 * a finding whose headline matches one written in the last 7 days.
 */
export async function runIntelligencePass(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
): Promise<{ written: number; skipped: number }> {
  const all = (
    await Promise.all([
      generateCapacityFindings(env, svc, shopId),
      generateWinRateBySizeFindings(env, svc, shopId),
      generateMarginTrendFindings(env, svc, shopId),
      generateExclusionsDriftFindings(env, svc, shopId),
    ])
  ).flat();

  if (all.length === 0) return { written: 0, skipped: 0 };

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recent } = await svc
    .from('intelligence_findings')
    .select('headline')
    .eq('shop_id', shopId)
    .gte('generated_at', since);
  const recentHeadlines = new Set((recent ?? []).map((r) => r.headline));

  let written = 0;
  let skipped = 0;
  for (const f of all) {
    if (recentHeadlines.has(f.headline)) {
      skipped += 1;
      continue;
    }
    const { error } = await svc.from('intelligence_findings').insert({
      shop_id: shopId,
      finding_type: f.finding_type,
      headline: f.headline,
      body: f.body,
      supporting_quote_ids: f.supporting_quote_ids,
      supporting_job_ids: f.supporting_job_ids,
      sample_size: f.sample_size,
      projected_impact_usd: f.projected_impact_usd,
      expires_at: f.expires_at,
    });
    if (error) {
      console.warn('[intelligence] insert failed', error.message);
      continue;
    }
    written += 1;
  }
  return { written, skipped };
}

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/**
 * Map a free-text project title to a coarse service-line bucket.
 * Replaces the missing jobs.service_line column until it's wired up
 * by a dedicated migration. Order matters — more specific keywords
 * first.
 */
function deriveServiceLine(title: string): string {
  const t = title.toLowerCase();
  if (/eifs/.test(t)) return 'eifs';
  if (/stucco/.test(t)) return 'stucco';
  if (/plaster/.test(t)) return 'plaster';
  if (/lath/.test(t)) return 'lath';
  if (/repair|patch/.test(t)) return 'repair';
  return 'general';
}
