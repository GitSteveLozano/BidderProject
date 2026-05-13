/**
 * PATCH  /api/change-order/:id/line-item/:lid — edit a CO line
 * DELETE /api/change-order/:id/line-item/:lid — remove a CO line
 *
 * Only allowed while the parent CO is PROPOSED. Mirrors the
 * quote_line_items endpoints in shape.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface PatchBody {
  description?: string;
  qty?: number;
  unit?: string | null;
  unit_price?: number;
  category?: string | null;
  margin_pct?: number | null;
}

async function loadLine(svc: any, shopId: string, coId: string, lid: string) {
  const { data: line } = await svc
    .from('change_order_line_items')
    .select('*, change_orders!inner(id, state, shop_id)')
    .eq('id', lid)
    .eq('change_order_id', coId)
    .eq('change_orders.shop_id', shopId)
    .maybeSingle();
  if (!line) return null;
  return { line, co: line.change_orders };
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit change orders' }, 403);
  const { id, lid } = params;
  if (!id || !lid) return json({ error: 'id + lid required' }, 400);

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const found = await loadLine(svc, locals.membership.shop_id, id, lid);
  if (!found) return json({ error: 'Line item not found' }, 404);
  if (found.co.state !== 'PROPOSED') {
    return json({ error: `Cannot edit lines on a ${found.co.state} CO` }, 409);
  }

  const next = {
    description: body.description ?? found.line.description,
    qty: body.qty != null ? Number(body.qty) : Number(found.line.qty),
    unit: body.unit !== undefined ? body.unit : found.line.unit,
    unit_price: body.unit_price != null ? Number(body.unit_price) : Number(found.line.unit_price),
    category: body.category !== undefined ? body.category : found.line.category,
    margin_pct:
      body.margin_pct !== undefined
        ? body.margin_pct
        : found.line.margin_pct,
  };
  const subtotal = round2(next.qty * next.unit_price);

  const { data, error } = await svc
    .from('change_order_line_items')
    .update({ ...next, subtotal })
    .eq('id', lid)
    .select('*')
    .single();
  if (error || !data) return json({ error: error?.message ?? 'update failed' }, 500);

  await recomputeCoTotal(svc, id);
  return json(data, 200);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit change orders' }, 403);
  const { id, lid } = params;
  if (!id || !lid) return json({ error: 'id + lid required' }, 400);

  const svc = supabaseService(env, 'service');
  const found = await loadLine(svc, locals.membership.shop_id, id, lid);
  if (!found) return json({ error: 'Line item not found' }, 404);
  if (found.co.state !== 'PROPOSED') {
    return json({ error: `Cannot delete lines on a ${found.co.state} CO` }, 409);
  }

  const { error } = await svc.from('change_order_line_items').delete().eq('id', lid);
  if (error) return json({ error: error.message }, 500);

  await recomputeCoTotal(svc, id);
  return json({ ok: true }, 200);
};

async function recomputeCoTotal(svc: any, coId: string) {
  const { data: co } = await svc
    .from('change_orders')
    .select('margin_pct')
    .eq('id', coId)
    .maybeSingle();
  const coMargin = Number(co?.margin_pct ?? 0);
  const { data: lis } = await svc
    .from('change_order_line_items')
    .select('subtotal, margin_pct')
    .eq('change_order_id', coId);
  const total = round2(
    (lis ?? []).reduce((s: number, r: any) => {
      const m = r.margin_pct != null ? Number(r.margin_pct) : coMargin;
      return s + Number(r.subtotal) * (1 + m / 100);
    }, 0),
  );
  await svc.from('change_orders').update({ total }).eq('id', coId);
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
