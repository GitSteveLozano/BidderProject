/**
 * PATCH  /api/change-order/:id — edit title/reason or transition state
 * DELETE /api/change-order/:id — remove (only allowed on PROPOSED or VOID)
 *
 * State transitions are guarded server-side. APPROVED writes a
 * job_id-scoped event so the activity feed reflects the contract bump.
 * The jobs.change_order_total rollup is maintained by trigger
 * (refresh_job_change_order_total, in migration 006).
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

type State = 'PROPOSED' | 'SENT' | 'APPROVED' | 'REJECTED' | 'VOID';

interface PatchBody {
  title?: string;
  reason?: string | null;
  margin_pct?: number | null;
  state?: State;
  rejected_reason?: string | null;
}

const VALID_TRANSITIONS: Record<State, State[]> = {
  PROPOSED: ['SENT', 'APPROVED', 'REJECTED', 'VOID'],
  SENT:     ['APPROVED', 'REJECTED', 'VOID'],
  APPROVED: ['VOID'],
  REJECTED: ['PROPOSED', 'VOID'],
  VOID:     [],
};

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit change orders' }, 403);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const { data: existing } = await svc
    .from('change_orders')
    .select('*')
    .eq('id', id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!existing) return json({ error: 'Change order not found' }, 404);

  const patch: Record<string, unknown> = {};
  if ('title' in body && body.title?.trim()) patch.title = body.title.trim();
  if ('reason' in body) patch.reason = body.reason ?? null;
  if ('margin_pct' in body) patch.margin_pct = body.margin_pct;

  if (body.state && body.state !== existing.state) {
    const allowed = VALID_TRANSITIONS[existing.state as State] ?? [];
    if (!allowed.includes(body.state)) {
      return json(
        { error: `Cannot transition from ${existing.state} to ${body.state}` },
        409,
      );
    }
    patch.state = body.state;
    const now = new Date().toISOString();
    if (body.state === 'SENT') patch.sent_at = now;
    if (body.state === 'APPROVED') {
      patch.approved_at = now;
      patch.responded_at = now;
    }
    if (body.state === 'REJECTED') {
      patch.rejected_at = now;
      patch.responded_at = now;
      if ('rejected_reason' in body) patch.rejected_reason = body.rejected_reason ?? null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable fields in body' }, 400);
  }

  const { data, error } = await svc
    .from('change_orders')
    .update(patch)
    .eq('id', id)
    .select('*, change_order_line_items(*)')
    .single();
  if (error) return json({ error: error.message }, 500);

  if (patch.state) {
    await svc.from('events').insert({
      shop_id: locals.membership.shop_id,
      job_id: existing.job_id,
      type: `change_order.${(patch.state as string).toLowerCase()}`,
      actor: locals.user.email ?? 'user',
      payload: { ref: existing.ref, total: Number(existing.total) },
    });
  }

  return json(data, 200);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot delete change orders' }, 403);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  const svc = supabaseService(env, 'service');
  const { data: existing } = await svc
    .from('change_orders')
    .select('id, state')
    .eq('id', id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!existing) return json({ error: 'Change order not found' }, 404);
  if (existing.state !== 'PROPOSED' && existing.state !== 'VOID') {
    return json({ error: `Cannot delete a ${existing.state} change order — void it instead` }, 409);
  }

  const { error } = await svc.from('change_orders').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
