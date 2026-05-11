/**
 * POST /api/bids/postmortem
 *
 * Loss postmortem agent — TypeScript port of agents/postmortem.py.
 * Reads a LOST bid + competitor info + recent comparable losses, asks
 * Claude for structured analysis, pins numeric facts from the DB row
 * (so the LLM can't fabricate a price delta), and writes an
 * intelligence_insights row so the finding surfaces on the dashboard.
 *
 * Astro API route — see comment in api/health.ts for why this isn't
 * a Cloudflare Pages Function.
 */

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

import { client as supabaseClient } from '@/lib/supabase';

export const prerender = false;

const SYSTEM_PROMPT = `You write structured loss-postmortem analyses for a
specialty contractor. You are given:
- The lost bid (scope, our price, our labor hours, our exclusions)
- The winning competitor's name and price (when known)
- The company's pricing logic (target margin, range, capacity behavior)
- Recent comparable LOST bids for this service line

Produce structured JSON in this exact shape (return ONLY the JSON):

{
  "likely_reasons": [str],
  "price_gap_analysis": {
    "our_price": number,
    "winning_price": number|null,
    "delta_usd": number|null,
    "delta_pct": number|null,
    "interpretation": str
  },
  "exclusions_signal": str,
  "capacity_factor": str,
  "pattern_across_recent_losses": str,
  "recommendations_for_next_bid": [str],
  "confidence": "low" | "medium" | "high"
}

Rules:
- Reasons must be specific — never generic "they were cheaper".
- Confidence: "low" when n<3 comparable losses, "medium" at 3-7, "high" at 8+.
- DO NOT invent numbers. Every dollar/percent must come from the facts.`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return jsonError(500, 'Cloudflare runtime not available');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const { bid_id } = body;
  if (!bid_id) return jsonError(400, 'Missing bid_id');

  const sb = supabaseClient(env, 'service');

  const { data: bid, error: bidErr } = await sb
    .from('bids')
    .select('*')
    .eq('id', bid_id)
    .maybeSingle();
  if (bidErr) return jsonError(500, bidErr.message);
  if (!bid) return jsonError(404, 'Bid not found');
  if (bid.outcome !== 'LOST') {
    return jsonError(400, `Postmortem only runs on LOST bids; this one is ${bid.outcome}`);
  }

  const { data: recentLosses } = await sb
    .from('bids')
    .select('estimated_value, outcome_competitor, outcome_winning_bid, estimated_labor_hours, exclusions_missing')
    .eq('company_id', bid.company_id)
    .eq('service_line', bid.service_line)
    .eq('outcome', 'LOST')
    .neq('id', bid_id)
    .order('outcome_captured_at', { ascending: false, nullsFirst: false })
    .limit(10);

  const { data: pricingLogic } = await sb
    .from('pricing_logic')
    .select('*')
    .eq('company_id', bid.company_id)
    .maybeSingle();

  const ourPrice = Number(bid.estimated_value ?? 0);
  const winningPrice = bid.outcome_winning_bid != null
    ? Number(bid.outcome_winning_bid) : null;
  const deltaUsd = winningPrice != null && ourPrice
    ? round(ourPrice - winningPrice, 2) : null;
  const deltaPct = winningPrice != null && ourPrice
    ? round(((ourPrice - winningPrice) / ourPrice) * 100, 2) : null;

  const facts = {
    bid: {
      client_name: bid.client_name,
      service_line: bid.service_line,
      scope_summary: (bid.scope_summary ?? '').slice(0, 500),
      our_price: ourPrice,
      labor_hours: bid.estimated_labor_hours,
      exclusions_applied: bid.exclusions_applied ?? [],
      exclusions_skipped: bid.exclusions_missing ?? [],
      capacity_at_quote: Number(bid.capacity_at_quote ?? 0),
    },
    competitor: {
      name: bid.outcome_competitor,
      winning_price: winningPrice,
      delta_usd: deltaUsd,
      delta_pct: deltaPct,
    },
    company_pricing_logic: {
      target_margin_pct: Number(pricingLogic?.target_margin_pct ?? 32),
      margin_range_low_pct: Number(pricingLogic?.margin_range_low_pct ?? 25),
      margin_range_high_pct: Number(pricingLogic?.margin_range_high_pct ?? 40),
      capacity_behavior:
        pricingLogic?.capacity_discount_behavior ?? 'flex_by_schedule',
    },
    recent_comparable_losses: (recentLosses ?? []).map((r) => ({
      value: Number(r.estimated_value ?? 0),
      competitor: r.outcome_competitor,
      winning_bid: r.outcome_winning_bid != null
        ? Number(r.outcome_winning_bid) : null,
    })),
    n_recent_losses: (recentLosses ?? []).length,
  };

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonError(500, 'ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey });

  const companyContext =
    `Company id: ${bid.company_id}\n` +
    `Pricing logic for this company:\n` +
    `${JSON.stringify(facts.company_pricing_logic)}\n\n` +
    `Recent comparable LOSS history (last ${facts.n_recent_losses}):\n` +
    `${JSON.stringify(facts.recent_comparable_losses)}`;

  const userMsg =
    `Loss postmortem facts (authoritative — do not invent numbers):\n\n` +
    `${JSON.stringify(facts.bid)}\n\nCompetitor: ${JSON.stringify(facts.competitor)}\n\n` +
    `Produce the postmortem JSON.`;

  try {
    const resp = await client.messages.create({
      model: env.DEFAULT_MODEL_SONNET ?? 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.2,
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        {
          type: 'text',
          text: companyContext,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMsg }],
    });

    const text = (resp.content
      .map((b) => ('text' in b ? b.text : ''))
      .join('') || '').trim();

    let parsed: any;
    try {
      const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const payload = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/)?.[0] ?? text);
      parsed = JSON.parse(payload);
    } catch (e) {
      return jsonError(502, `Could not parse postmortem JSON: ${e}`);
    }

    // Pin authoritative numbers — never let the LLM fabricate a delta.
    parsed.price_gap_analysis = {
      our_price: ourPrice,
      winning_price: winningPrice,
      delta_usd: deltaUsd,
      delta_pct: deltaPct,
      interpretation: parsed.price_gap_analysis?.interpretation ?? '',
    };

    try {
      const headline = `Loss postmortem: ${bid.client_name} (${bid.service_line}, $${ourPrice.toLocaleString()})`;
      const finding = (parsed.likely_reasons ?? []).map((r: string) => `- ${r}`).join('\n')
        || parsed.pattern_across_recent_losses || '(no findings)';
      const recommendation = (parsed.recommendations_for_next_bid ?? [])
        .map((r: string) => `- ${r}`).join('\n') || '(no recommendations)';
      const severity = parsed.confidence === 'high' ? 'high'
        : parsed.confidence === 'medium' ? 'medium' : 'info';
      const projected = deltaPct != null
        ? `Price delta ${deltaPct}% vs ${bid.outcome_competitor ?? 'competitor'}`
        : 'Competitor price unknown';
      await sb.from('intelligence_insights').insert({
        company_id: bid.company_id,
        category: 'competitor',
        severity,
        headline,
        finding,
        recommendation,
        projected_impact: projected,
        supporting_bids: [bid_id],
        status: 'open',
      });
    } catch (e) {
      console.warn('insight insert failed', e);
    }

    return new Response(JSON.stringify(parsed), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(500, msg);
  }
};

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
