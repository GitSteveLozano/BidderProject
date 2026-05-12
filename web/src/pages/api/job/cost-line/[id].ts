/**
 * PATCH /api/job/cost-line/:id  — update a cost line (typically the
 * actual). The refresh_job_totals trigger recomputes the parent job's
 * totals + variance automatically.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const EDITABLE = ['description', 'estimated', 'actual', 'source', 'note', 'category'];

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const id = params.id;
  if (!id) return json({ error: 'line id required' }, 400);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) return json({ error: 'No editable fields' }, 400);

  const svc = supabaseService(env, 'service');
  // RLS would protect this, but as service-role we double-check by joining to jobs.shop_id
  const { data: line } = await svc
    .from('job_cost_lines')
    .select('id, jobs:job_id(shop_id)')
    .eq('id', id)
    .maybeSingle();
  if (!line || (line.jobs as any)?.shop_id !== locals.membership.shop_id) {
    return json({ error: 'Not found' }, 404);
  }

  const { error } = await svc.from('job_cost_lines').update(patch).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
