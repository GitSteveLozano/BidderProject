/**
 * GET /api/job/:id/cost-lines  — return cost lines for a job
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const id = params.id;
  if (!id) return json({ error: 'job id required' }, 400);

  const svc = supabaseService(env, 'service');
  // Confirm the job belongs to the user's shop
  const { data: job } = await svc
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!job) return json({ error: 'Job not found' }, 404);

  const { data, error } = await svc
    .from('job_cost_lines')
    .select('id, category, description, estimated, actual, source')
    .eq('job_id', id)
    .order('category')
    .order('description');
  if (error) return json({ error: error.message }, 500);
  return json(data ?? [], 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
