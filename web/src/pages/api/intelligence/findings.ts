/**
 * GET  /api/intelligence/findings — list non-dismissed findings
 * POST /api/intelligence/findings — { id, action: 'dismiss' | 'act' }
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const svc = supabaseService(env, 'service');
  const { data, error } = await svc
    .from('intelligence_findings')
    .select(
      'id, finding_type, headline, body, supporting_quote_ids, supporting_job_ids, sample_size, projected_impact_usd, generated_at, expires_at',
    )
    .eq('shop_id', locals.membership.shop_id)
    .is('dismissed_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('generated_at', { ascending: false })
    .limit(40);
  if (error) return json({ error: error.message }, 500);
  return json({ findings: data ?? [] }, 200);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: { id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.id || (body.action !== 'dismiss' && body.action !== 'act')) {
    return json({ error: 'id + action required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const patch =
    body.action === 'dismiss'
      ? { dismissed_at: new Date().toISOString() }
      : { acted_on_at: new Date().toISOString() };
  const { error } = await svc
    .from('intelligence_findings')
    .update(patch)
    .eq('id', body.id)
    .eq('shop_id', locals.membership.shop_id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
