/**
 * PATCH /api/quote/line-item/:id — inline edit a line item
 * DELETE /api/quote/line-item/:id — remove a line item
 *
 * Both recompute quotes.total afterwards. Sibling POST in
 * /api/quote/line-item.ts handles create.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface PatchBody {
  description?: string;
  qty?: number;
  unit_price?: number;
  unit?: string | null;
  category?: string | null;
  confidence?: string | null;
  /** null clears the override; a number sets it. */
  margin_pct?: number | null;
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const { quote, line } = await loadLine(svc, id, locals.membership.shop_id);
  if (!quote || !line) return json({ error: 'Not found' }, 404);
  if (quote.state !== 'DRAFT') {
    return json({ error: 'Cannot edit line items on a sent quote' }, 409);
  }

  const next = {
    description: body.description ?? line.description,
    qty: body.qty != null ? Number(body.qty) : Number(line.qty),
    unit: body.unit !== undefined ? body.unit : line.unit,
    unit_price: body.unit_price != null ? Number(body.unit_price) : Number(line.unit_price),
    category: body.category !== undefined ? body.category : line.category,
    confidence: body.confidence !== undefined ? body.confidence : line.confidence,
    margin_pct:
      body.margin_pct !== undefined
        ? body.margin_pct
        : line.margin_pct,
  };
  const subtotal = round2(next.qty * next.unit_price);

  const { data: row, error } = await svc
    .from('quote_line_items')
    .update({ ...next, subtotal })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !row) return json({ error: error?.message ?? 'update failed' }, 500);

  await recomputeTotal(svc, quote.id);
  return json(row, 200);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  const svc = supabaseService(env, 'service');
  const { quote, line } = await loadLine(svc, id, locals.membership.shop_id);
  if (!quote || !line) return json({ error: 'Not found' }, 404);
  if (quote.state !== 'DRAFT') {
    return json({ error: 'Cannot edit line items on a sent quote' }, 409);
  }

  const { error } = await svc.from('quote_line_items').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  await recomputeTotal(svc, quote.id);
  return json({ ok: true }, 200);
};

async function loadLine(svc: any, id: string, shopId: string) {
  const { data: line } = await svc
    .from('quote_line_items')
    .select('*, quotes!inner(id, state, shop_id)')
    .eq('id', id)
    .eq('quotes.shop_id', shopId)
    .maybeSingle();
  if (!line) return { line: null, quote: null };
  return { line, quote: line.quotes };
}

/** Re-sum the quote total applying each line's margin_pct override
 * or the quote-level margin_pct as fallback. Mirrors the recompute in
 * /api/quote/line-item.ts. */
async function recomputeTotal(svc: any, quoteId: string) {
  const { data: quote } = await svc
    .from('quotes')
    .select('margin_pct')
    .eq('id', quoteId)
    .maybeSingle();
  const quoteMargin = Number(quote?.margin_pct ?? 0);
  const { data: lis } = await svc
    .from('quote_line_items')
    .select('subtotal, margin_pct')
    .eq('quote_id', quoteId);
  const total = round2(
    (lis ?? []).reduce((s: number, r: any) => {
      const m = r.margin_pct != null ? Number(r.margin_pct) : quoteMargin;
      return s + Number(r.subtotal) * (1 + m / 100);
    }, 0),
  );
  await svc.from('quotes').update({ total }).eq('id', quoteId);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
