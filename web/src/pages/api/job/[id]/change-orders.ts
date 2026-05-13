/**
 * GET    /api/job/:id/change-orders — list COs for a job
 * POST   /api/job/:id/change-orders — create a new CO
 *
 * Each CO gets a ref like CO-YYYY-NNNN minted per shop+year. Starts
 * in PROPOSED state; transitions live in /api/change-order/[id]/state.ts.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface NewCO {
  title?: string;
  reason?: string | null;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  const svc = supabaseService(env, 'service');
  const { data, error } = await svc
    .from('change_orders')
    .select('*, change_order_line_items(*)')
    .eq('job_id', id)
    .eq('shop_id', locals.membership.shop_id)
    .order('created_at', { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json(data ?? [], 200);
};

export const POST: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot create change orders' }, 403);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  let body: NewCO;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.title || !body.title.trim()) {
    return json({ error: 'title required' }, 400);
  }

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');
  // Confirm the job is in this shop before linking.
  const { data: job } = await svc
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (!job) return json({ error: 'Job not found' }, 404);

  // Mint a CO ref: CO-YYYY-NNNN per shop+year. Mirrors how
  // /api/quote/save mints quote refs.
  const year = new Date().getUTCFullYear();
  const { count } = await svc
    .from('change_orders')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .gte('created_at', `${year}-01-01T00:00:00Z`);
  const n = (count ?? 0) + 1;
  const ref = `CO-${year}-${String(n).padStart(4, '0')}`;

  const { data, error } = await svc
    .from('change_orders')
    .insert({
      shop_id: shopId,
      job_id: id,
      ref,
      title: body.title.trim(),
      reason: body.reason?.trim() || null,
      state: 'PROPOSED',
    })
    .select('*, change_order_line_items(*)')
    .single();
  if (error) return json({ error: error.message }, 500);

  await svc.from('events').insert({
    shop_id: shopId,
    job_id: id,
    type: 'change_order.created',
    actor: locals.user.email ?? 'user',
    payload: { ref, title: body.title.trim() },
  });

  return json(data, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
