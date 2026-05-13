/**
 * POST /api/quote/line-item — append a new line item to a quote, then
 * recompute the quote total. PATCH/DELETE per-line live in [id].ts.
 *
 * Body: { quote_id, description, qty, unit_price, unit?, category?,
 *         confidence? }
 *
 * Only allowed while the quote is in DRAFT — once it's sent we treat
 * line items as historical record. Returns the inserted row.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface Body {
  quote_id?: string;
  description?: string;
  qty?: number;
  unit_price?: number;
  unit?: string | null;
  category?: string | null;
  confidence?: string | null;
  margin_pct?: number | null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id || !body.description) {
    return json({ error: 'quote_id + description required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const { data: quote } = await svc
    .from('quotes')
    .select('id, state')
    .eq('id', body.quote_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);
  if (quote.state !== 'DRAFT') {
    return json({ error: 'Cannot edit line items on a sent quote' }, 409);
  }

  const { data: lastPos } = await svc
    .from('quote_line_items')
    .select('position')
    .eq('quote_id', body.quote_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const qty = Number(body.qty ?? 1);
  const unit_price = Number(body.unit_price ?? 0);
  const subtotal = round2(qty * unit_price);

  const { data: row, error } = await svc
    .from('quote_line_items')
    .insert({
      quote_id: body.quote_id,
      position: (lastPos?.position ?? 0) + 1,
      description: body.description,
      qty,
      unit: body.unit ?? null,
      unit_price,
      subtotal,
      category: body.category ?? null,
      confidence: body.confidence ?? 'manual',
      margin_pct: body.margin_pct ?? null,
    })
    .select('*')
    .single();
  if (error || !row) return json({ error: error?.message ?? 'insert failed' }, 500);

  await recomputeTotal(svc, body.quote_id);
  return json(row, 200);
};

/** Re-sum the quote total, applying each line's margin_pct override
 * or the quote-level margin_pct as fallback. Without this, quote.total
 * would stay at cost-basis sum and diverge from what the operator
 * sees on the Pricing wizard. */
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
