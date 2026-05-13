/**
 * POST /api/offer/recommend
 *
 * Body: { quote_id, scope_summary?, line_items_preview?, service_line_hint? }
 *
 * Runs the Offer agent end-to-end: generates lookup spec, executes
 * lookups deterministically, fills the rationale template, persists
 * an offer_recommendations row. Returns the recommendation + citations.
 */
import type { APIRoute } from 'astro';

import { recommendOffer } from '@/lib/offer-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: {
    quote_id?: string;
    scope_summary?: string;
    line_items_preview?: Array<{ description: string; qty: number; unit: string }>;
    service_line_hint?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);

  const svc = supabaseService(env, 'service');

  // If scope_summary not provided, pull from the quote.
  let scope = body.scope_summary;
  let items = body.line_items_preview;
  if (!scope || !items) {
    const { data: q } = await svc
      .from('quotes')
      .select('scope_summary')
      .eq('id', body.quote_id)
      .eq('shop_id', locals.membership.shop_id)
      .maybeSingle();
    if (!q) return json({ error: 'quote not found' }, 404);
    scope = scope ?? q.scope_summary ?? '';
    if (!items) {
      const { data: li } = await svc
        .from('quote_line_items')
        .select('description, qty, unit')
        .eq('quote_id', body.quote_id);
      items = (li ?? []).map((r) => ({
        description: r.description,
        qty: Number(r.qty),
        unit: r.unit ?? 'lump_sum',
      }));
    }
  }

  const rec = await recommendOffer(env, svc, locals.membership.shop_id, {
    scope_summary: scope ?? '',
    line_items_preview: items,
    service_line_hint: body.service_line_hint,
  });

  await svc.from('offer_recommendations').insert({
    shop_id: locals.membership.shop_id,
    quote_id: body.quote_id,
    lookup_spec: rec.lookup_spec,
    computed: rec.computed,
    rationale_text: rec.rationale_text,
    citations: rec.citations,
    recommended_low: rec.recommended_low,
    recommended_center: rec.recommended_center,
    recommended_high: rec.recommended_high,
    confidence: rec.confidence,
  });

  return json(rec, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
