/**
 * POST /api/change-order/:id/line-item — append a line to a CO
 *
 * Only PROPOSED COs accept edits. Once SENT the CO is locked except
 * for state transitions (approve/reject). Recomputes change_orders.total
 * with margin applied. The jobs.change_order_total trigger fires only
 * when the CO itself flips APPROVED, so unsent edits don't touch the
 * job rollup.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface Body {
  description?: string;
  qty?: number;
  unit?: string | null;
  unit_price?: number;
  category?: string | null;
  margin_pct?: number | null;
}

export const POST: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit change orders' }, 403);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.description?.trim()) return json({ error: 'description required' }, 400);

  const svc = supabaseService(env, 'service');
  const { data: co } = await svc
    .from('change_orders')
    .select('id, state, margin_pct')
    .eq('id', id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!co) return json({ error: 'Change order not found' }, 404);
  if (co.state !== 'PROPOSED') {
    return json({ error: `Cannot edit lines on a ${co.state} CO` }, 409);
  }

  const { data: lastPos } = await svc
    .from('change_order_line_items')
    .select('position')
    .eq('change_order_id', id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const qty = Number(body.qty ?? 1);
  const unit_price = Number(body.unit_price ?? 0);
  const subtotal = round2(qty * unit_price);

  const { data: row, error } = await svc
    .from('change_order_line_items')
    .insert({
      change_order_id: id,
      position: (lastPos?.position ?? 0) + 1,
      description: body.description.trim(),
      qty,
      unit: body.unit ?? null,
      unit_price,
      subtotal,
      category: body.category ?? null,
      margin_pct: body.margin_pct ?? null,
    })
    .select('*')
    .single();
  if (error || !row) return json({ error: error?.message ?? 'insert failed' }, 500);

  await recomputeCoTotal(svc, id);
  return json(row, 200);
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
