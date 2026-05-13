/**
 * POST /api/context/seed
 *
 * Manually seed the Context profile for the calling user's shop from
 * the data we already have in Brief — voice_profile JSON on shops,
 * boilerplate fragments, scope_summary text on past quotes, captured
 * margin_pct values, and so on. Idempotent: re-running upserts.
 *
 * This is the Phase-1 substitute for the Intake agent's automated
 * ingestion. Operator hits it once per shop to bootstrap Context;
 * Intake takes over from there.
 */
import type { APIRoute } from 'astro';

import { upsertChunks, type ChunkInput } from '@/lib/context';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  // Pull what we know about the shop.
  const { data: shop } = await svc
    .from('shops')
    .select(
      'voice_profile, default_markup_pct, default_labor_rate, default_overhead_pct, default_margin_range_low, default_margin_range_high, license_classification, business_noun, trade_name, legal_name',
    )
    .eq('id', shopId)
    .maybeSingle();
  if (!shop) return json({ error: 'Shop not found' }, 404);

  const inputs: ChunkInput[] = [];

  // ── Voice samples ────────────────────────────────────────────────
  const vp = (shop.voice_profile ?? {}) as {
    tone?: string;
    preferred_terms?: string[];
    avoided_terms?: string[];
    boilerplate_intro?: string;
    boilerplate_closing?: string;
  };
  if (vp.tone) {
    inputs.push({
      chunk_type: 'voice_sample',
      source_ref: 'voice/tone',
      content: `Tone: ${vp.tone}`,
    });
  }
  if (vp.preferred_terms?.length) {
    inputs.push({
      chunk_type: 'voice_sample',
      source_ref: 'voice/preferred_terms',
      content: `Preferred terms this shop uses verbatim: ${vp.preferred_terms.join(', ')}`,
    });
  }
  if (vp.avoided_terms?.length) {
    inputs.push({
      chunk_type: 'voice_sample',
      source_ref: 'voice/avoided_terms',
      content: `Avoided terms — never use these: ${vp.avoided_terms.join(', ')}`,
    });
  }
  if (vp.boilerplate_intro) {
    inputs.push({
      chunk_type: 'voice_sample',
      source_ref: 'voice/boilerplate_intro',
      content: `Standard email opener: "${vp.boilerplate_intro}"`,
    });
  }
  if (vp.boilerplate_closing) {
    inputs.push({
      chunk_type: 'voice_sample',
      source_ref: 'voice/boilerplate_closing',
      content: `Standard email closing: "${vp.boilerplate_closing}"`,
    });
  }

  // ── Pricing rules ────────────────────────────────────────────────
  inputs.push({
    chunk_type: 'pricing_rule',
    source_ref: 'pricing/defaults',
    content:
      `Default markup ${shop.default_markup_pct}%. Loaded labor rate $${shop.default_labor_rate}/hr. ` +
      `Overhead ${shop.default_overhead_pct}%. Target margin range ${shop.default_margin_range_low}–${shop.default_margin_range_high}%.`,
  });

  // ── Service definition (from license + trade name) ───────────────
  if (shop.license_classification) {
    inputs.push({
      chunk_type: 'service_definition',
      source_ref: 'service/license',
      content: `License classification: ${shop.license_classification}. Trade name: ${shop.trade_name ?? shop.legal_name}. Operates as a ${shop.business_noun ?? 'shop'}.`,
    });
  }

  // ── Past quote summaries (scope + outcome) ───────────────────────
  const { data: quotes } = await svc
    .from('quotes')
    .select('id, ref, state, scope_summary, project_title, total, margin_pct, client_name')
    .eq('shop_id', shopId)
    .not('scope_summary', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  for (const q of quotes ?? []) {
    if (!q.scope_summary) continue;
    inputs.push({
      chunk_type: 'past_quote_summary',
      source_ref: `quote/${q.ref ?? q.id}`,
      content:
        `${q.state} ${q.ref ?? '—'} for ${q.client_name}. ` +
        `Project: ${q.project_title ?? '(untitled)'}. ` +
        `Total $${Number(q.total ?? 0).toLocaleString()}. ` +
        `Margin ${q.margin_pct ?? '?'}%. ` +
        `Scope: ${q.scope_summary}`,
      metadata: {
        quote_id: q.id,
        state: q.state,
        total: Number(q.total ?? 0),
        margin_pct: q.margin_pct,
      },
    });
  }

  // ── Scope patterns (group descriptions by category, dedupe) ──────
  const { data: items } = await svc
    .from('quote_line_items')
    .select('description, category, qty, unit, quote_id')
    .in('quote_id', (quotes ?? []).map((q) => q.id))
    .limit(500);
  const byCat = new Map<string, Set<string>>();
  for (const li of items ?? []) {
    const cat = li.category ?? 'other';
    if (!byCat.has(cat)) byCat.set(cat, new Set());
    byCat.get(cat)!.add(li.description);
  }
  for (const [cat, descs] of byCat.entries()) {
    const sample = Array.from(descs).slice(0, 20).join('\n- ');
    inputs.push({
      chunk_type: 'scope_pattern',
      source_ref: `scope_pattern/${cat}`,
      content: `${cat} line-item phrasings this shop uses:\n- ${sample}`,
      metadata: { category: cat, distinct_count: descs.size },
    });
  }

  const result = await upsertChunks(env, svc, shopId, inputs);
  return json(
    { shop_id: shopId, candidates: inputs.length, ...result },
    200,
  );
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
