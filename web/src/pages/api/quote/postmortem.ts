/**
 * POST /api/quote/postmortem
 *
 * Loss postmortem for a LOST quote. Reads the quote + outcome columns
 * (competitor, winning_bid, reason) + recent comparable losses in the
 * same shop, asks Claude for structured analysis, and pins the numeric
 * facts (our_price, winning_price, deltas) from the DB row so the LLM
 * can't fabricate the math.
 *
 * Returns the structured PostmortemResult JSON. The consumer renders
 * it inline on /quotes/[id] when state=LOST.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { generateText } from '@/lib/ai';

export const prerender = false;

const SYSTEM_PROMPT = `You write structured loss-postmortem analyses for a
specialty contractor. You are given:
- The lost quote (project, our price, our margin %, the operator's
  free-text reason for losing it)
- The winning competitor's name and bid (when known)
- The shop's pricing defaults (target margin, range)
- Recent comparable LOST quotes from the same shop

Produce JSON in this exact shape (return ONLY the JSON, no fences):

{
  "likely_reasons": [str],
  "price_gap_analysis": {
    "our_price": number,
    "winning_price": number|null,
    "delta_usd": number|null,
    "delta_pct": number|null,
    "interpretation": str
  },
  "scope_signal": str,
  "relationship_factor": str,
  "pattern_across_recent_losses": str,
  "recommendations_for_next_bid": [str],
  "confidence": "low" | "medium" | "high"
}

Rules:
- Reasons must be specific to this quote — never generic "they were
  cheaper" without the why.
- Confidence: "low" when fewer than 3 comparable losses recorded,
  "medium" at 3-7, "high" at 8+.
- Recommendations are concrete moves the operator can make on the
  next bid in this segment — pricing, scope, relationship, timing.
- DO NOT invent numbers. Every dollar/percent comes from the facts.`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: { quote_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  const { data: quote } = await svc
    .from('quotes')
    .select('*')
    .eq('id', body.quote_id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);
  if (quote.state !== 'LOST') {
    return json({ error: `Postmortem only runs on LOST quotes; this one is ${quote.state}` }, 400);
  }

  const { data: recentLosses } = await svc
    .from('quotes')
    .select('total, margin_pct, outcome_competitor, outcome_winning_bid, outcome_reason, project_title')
    .eq('shop_id', shopId)
    .eq('state', 'LOST')
    .neq('id', body.quote_id)
    .order('outcome_captured_at', { ascending: false, nullsFirst: false })
    .limit(10);

  const { data: shop } = await svc
    .from('shops')
    .select('default_markup_pct, default_margin_range_low, default_margin_range_high')
    .eq('id', shopId)
    .maybeSingle();

  const ourPrice = Number(quote.total ?? 0);
  const winningPrice =
    quote.outcome_winning_bid != null ? Number(quote.outcome_winning_bid) : null;
  const deltaUsd = winningPrice != null ? round(ourPrice - winningPrice, 2) : null;
  const deltaPct =
    winningPrice != null && ourPrice ? round(((ourPrice - winningPrice) / ourPrice) * 100, 2) : null;

  const facts = {
    quote: {
      client_name: quote.client_name,
      project_title: quote.project_title,
      scope_summary: (quote.scope_summary ?? '').slice(0, 500),
      our_price: ourPrice,
      our_margin_pct: Number(quote.margin_pct ?? 0),
      relationship: quote.relationship ?? 'new',
      operator_reason: quote.outcome_reason ?? null,
      days_to_outcome:
        quote.sent_at && quote.outcome_captured_at
          ? Math.round((+new Date(quote.outcome_captured_at) - +new Date(quote.sent_at)) / 86_400_000)
          : null,
    },
    competitor: {
      name: quote.outcome_competitor,
      winning_price: winningPrice,
      delta_usd: deltaUsd,
      delta_pct: deltaPct,
    },
    shop_pricing: {
      target_margin_pct: Number(shop?.default_markup_pct ?? 32),
      margin_range_low_pct: Number(shop?.default_margin_range_low ?? 25),
      margin_range_high_pct: Number(shop?.default_margin_range_high ?? 40),
    },
    recent_comparable_losses: (recentLosses ?? []).map((r: any) => ({
      project: r.project_title,
      our_total: Number(r.total ?? 0),
      competitor: r.outcome_competitor,
      winning_bid: r.outcome_winning_bid != null ? Number(r.outcome_winning_bid) : null,
      reason: r.outcome_reason,
    })),
    n_recent_losses: (recentLosses ?? []).length,
  };

  const userMsg =
    `Loss postmortem facts (authoritative — do not invent numbers):\n\n` +
    `${JSON.stringify(facts.quote)}\n\nCompetitor: ${JSON.stringify(facts.competitor)}\n\n` +
    `Shop pricing: ${JSON.stringify(facts.shop_pricing)}\n\n` +
    `Recent comparable LOSS history (n=${facts.n_recent_losses}):\n` +
    `${JSON.stringify(facts.recent_comparable_losses)}\n\n` +
    `Produce the postmortem JSON.`;

  let text: string;
  try {
    text = await generateText(env, {
      max_tokens: 1500,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }

  let parsed: any;
  try {
    const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    const payload = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0] ?? text;
    parsed = JSON.parse(payload);
  } catch (err) {
    return json({ error: `Could not parse postmortem JSON: ${err}` }, 502);
  }

  // Pin authoritative numbers — never let the LLM fabricate the math.
  parsed.price_gap_analysis = {
    our_price: ourPrice,
    winning_price: winningPrice,
    delta_usd: deltaUsd,
    delta_pct: deltaPct,
    interpretation: parsed.price_gap_analysis?.interpretation ?? '',
  };

  return json(parsed, 200);
};

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
