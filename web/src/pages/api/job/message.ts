/**
 * POST /api/job/message
 *
 * Records an outbound message about a job (status update or check-in)
 * as an event. We don't yet have a job_messages table; the structured
 * thread can land later. For now we log enough to drive an activity
 * feed and keep the operator's intent recorded.
 *
 * Mirrors POST /api/quote/message in shape.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: {
    job_id?: string;
    kind?: 'update' | 'check-in';
    subject?: string;
    body?: string;
    drafted_by?: 'brief' | 'user';
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.job_id || !body.body) {
    return json({ error: 'job_id + body required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const { data: job } = await svc
    .from('jobs')
    .select('id, shop_id')
    .eq('id', body.job_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!job) return json({ error: 'Job not found' }, 404);

  const type = body.kind === 'check-in' ? 'job.check_in.sent' : 'job.update.sent';
  const { error } = await svc.from('events').insert({
    shop_id: locals.membership.shop_id,
    job_id: job.id,
    type,
    actor: locals.user.email ?? 'user',
    payload: {
      subject: body.subject ?? null,
      body: body.body,
      drafted_by: body.drafted_by ?? 'user',
    },
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
