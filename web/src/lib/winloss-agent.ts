/**
 * Win/Loss agent — async outcome capture.
 *
 * Fires when a quote moves to WON, LOST, WITHDRAWN, or NO_DECISION
 * (timed out). Captures three things:
 *
 *   1. A snapshot of the quote at decision time (total, margin, scope
 *      summary, line item categories, days-in-flight) so retrospective
 *      analysis can compare apples to apples even after the source
 *      quote gets edited or archived.
 *   2. The operator's free-text "why" — they paste/type the reason in
 *      the mark-won / mark-lost flow. Most valuable signal we get.
 *   3. The LLM's inferred factors — structured tags ("priced_high",
 *      "incumbent_relationship", "scope_mismatch", "timing_lost") with
 *      evidence pointers, so Intelligence can pattern-match later.
 *
 * The agent feeds successful inferences back into Context as new
 * past_quote_summary chunks. That's the closed loop: Win/Loss writes
 * to Context, Context informs the next Offer + Composition pass.
 *
 * `ready_for_intelligence` flips true when a finding's sample size
 * supports it (n>=15 win/loss, n>=8 service line — per the design).
 * Intelligence agent reads only flagged rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { generateText, extractJson } from './ai';
import { upsertChunk } from './context';
import type { CloudflareEnv } from './supabase';

export type Outcome = 'won' | 'lost' | 'withdrawn' | 'no_decision';

export interface QuoteSnapshot {
  total: number;
  margin_pct: number | null;
  scope_summary: string;
  client_relationship: string | null;
  source: string | null;
  line_item_count: number;
  days_in_flight: number;
  sent_at: string | null;
  responded_at: string | null;
}

export interface InferredFactor {
  factor: string;
  weight: number;            // 0-1, agent's confidence this factor contributed
  evidence: string;          // <= 200 chars
}

export interface WinLossCapture {
  outcome: Outcome;
  captured_reason: string | null;
  inferred_factors: InferredFactor[];
  snapshot: QuoteSnapshot;
}

const KNOWN_FACTORS = [
  'priced_high',
  'priced_low',
  'incumbent_relationship',
  'cold_relationship',
  'scope_mismatch',
  'timing_lost',
  'response_too_slow',
  'budget_constraint',
  'spec_match',
  'voice_match',
  'follow_up_cadence',
  'competitor_underbid',
  'no_followup_received',
] as const;

const SYSTEM_PROMPT = `You are Brief's Win/Loss agent. You read a closed
quote (won, lost, withdrawn, or no_decision) and infer what contributed
to the outcome. Return ONLY this JSON shape — no fences, no preamble.

{
  "inferred_factors": [
    { "factor": one of the known factors,
      "weight": 0-1 (how strongly this contributed),
      "evidence": "<=200 chars, specific to this quote" }
  ]
}

Known factors:
- priced_high / priced_low (price vs apparent budget signals)
- incumbent_relationship / cold_relationship (prior history with client)
- scope_mismatch (operator's scope didn't match what client wanted)
- timing_lost (client moved before we responded)
- response_too_slow (sent_at to responded_at too long)
- budget_constraint (client signaled $$$ ceiling)
- spec_match / voice_match (positive: alignment was strong)
- follow_up_cadence (right or wrong rhythm of touches)
- competitor_underbid (lost to a lower bid)
- no_followup_received (timed out without explicit decision)

Rules:
- Maximum 3 factors per outcome. Quality over quantity.
- For "won": only positive factors (incumbent, voice_match, spec_match).
- For "lost": negative factors. Speculate cautiously — only assert
  factors with evidence in the snapshot or captured_reason.
- For "no_decision": almost always [no_followup_received, response_too_slow].
- If captured_reason is rich, factors should align with it.
- Evidence quotes the snapshot or captured_reason where possible.`;

/**
 * Build a quote snapshot from the DB record. Caller passes the
 * quote_id; we fetch the quote + its line items.
 */
export async function buildSnapshot(
  svc: SupabaseClient,
  quoteId: string,
): Promise<QuoteSnapshot | null> {
  const { data: q } = await svc
    .from('quotes')
    .select('total, margin_pct, scope_summary, relationship, source, sent_at, responded_at, created_at')
    .eq('id', quoteId)
    .maybeSingle();
  if (!q) return null;
  const { count } = await svc
    .from('quote_line_items')
    .select('*', { count: 'exact', head: true })
    .eq('quote_id', quoteId);
  const sent = q.sent_at ? new Date(q.sent_at) : new Date(q.created_at);
  const respondedOrNow = q.responded_at ? new Date(q.responded_at) : new Date();
  const days = Math.max(0, Math.round((respondedOrNow.getTime() - sent.getTime()) / 86400000));
  return {
    total: Number(q.total ?? 0),
    margin_pct: q.margin_pct != null ? Number(q.margin_pct) : null,
    scope_summary: q.scope_summary ?? '',
    client_relationship: q.relationship ?? null,
    source: q.source ?? null,
    line_item_count: count ?? 0,
    days_in_flight: days,
    sent_at: q.sent_at,
    responded_at: q.responded_at,
  };
}

/**
 * Run the LLM inference pass. Returns the structured factors (clean
 * + filtered to known values). Failure mode = empty list.
 */
export async function inferFactors(
  env: CloudflareEnv,
  outcome: Outcome,
  snapshot: QuoteSnapshot,
  capturedReason: string | null,
): Promise<InferredFactor[]> {
  const userMsg =
    `Outcome: ${outcome}\n` +
    `Captured reason: ${capturedReason ?? '(none provided)'}\n` +
    `Snapshot:\n${JSON.stringify(snapshot, null, 2)}\n\n` +
    `Return inferred_factors JSON now.`;
  let raw = '';
  try {
    raw = await generateText(env, {
      max_tokens: 800,
      temperature: 0.2,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });
  } catch (e) {
    console.warn('[winloss] generation failed', e);
    return [];
  }
  const parsed = extractJson<{ inferred_factors?: InferredFactor[] }>(raw);
  const raw_factors = Array.isArray(parsed?.inferred_factors) ? parsed!.inferred_factors : [];
  return raw_factors
    .filter(
      (f): f is InferredFactor =>
        f != null &&
        typeof f === 'object' &&
        typeof (f as { factor?: unknown }).factor === 'string' &&
        (KNOWN_FACTORS as readonly string[]).includes((f as { factor: string }).factor),
    )
    .map((f) => ({
      factor: f.factor,
      weight: Math.max(0, Math.min(1, Number(f.weight) || 0)),
      evidence: typeof f.evidence === 'string' ? f.evidence.slice(0, 200) : '',
    }))
    .slice(0, 3);
}

/**
 * Capture an outcome end-to-end. Persists the signal row + writes a
 * past_quote_summary chunk to Context for retrieval next time we see
 * a similar scope.
 */
export async function captureOutcome(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  quoteId: string,
  outcome: Outcome,
  capturedReason: string | null,
): Promise<WinLossCapture | null> {
  const snapshot = await buildSnapshot(svc, quoteId);
  if (!snapshot) return null;
  const factors = await inferFactors(env, outcome, snapshot, capturedReason);

  await svc.from('winloss_signals').upsert(
    {
      shop_id: shopId,
      quote_id: quoteId,
      outcome,
      captured_reason: capturedReason,
      inferred_factors: factors,
      snapshot,
      ready_for_intelligence: outcome === 'won' || outcome === 'lost', // baseline; Intelligence does its own n-check
    },
    { onConflict: 'quote_id' },
  );

  // Feed back into Context. One-paragraph summary so future retrieval
  // surfaces this case for similar scopes.
  const { data: q } = await svc
    .from('quotes')
    .select('ref, scope_summary, total, project_title')
    .eq('id', quoteId)
    .maybeSingle();
  if (q && q.scope_summary) {
    const summary =
      `${outcome.toUpperCase()} ${q.ref ?? quoteId} — ${q.project_title ?? 'project'}. ` +
      `Total $${Number(q.total ?? 0).toLocaleString()}. ` +
      `Scope: ${q.scope_summary}. ` +
      (capturedReason ? `Reason: ${capturedReason}. ` : '') +
      (factors.length
        ? `Factors: ${factors.map((f) => `${f.factor} (${Math.round(f.weight * 100)}%)`).join(', ')}.`
        : '');
    await upsertChunk(env, svc, shopId, {
      chunk_type: 'past_quote_summary',
      source_ref: `quote/${q.ref ?? quoteId}`,
      content: summary,
      metadata: { outcome, quote_id: quoteId, days_in_flight: snapshot.days_in_flight },
    });
  }

  return { outcome, captured_reason: capturedReason, inferred_factors: factors, snapshot };
}
