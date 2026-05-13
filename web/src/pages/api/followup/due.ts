/**
 * GET /api/followup/due
 *
 * Lists scheduled follow-ups whose scheduled_for has elapsed. Used by
 * the dashboard "needs-action" feed + the cron worker.
 */
import type { APIRoute } from 'astro';

import { listDue } from '@/lib/followup-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const svc = supabaseService(env, 'service');
  const due = await listDue(svc, locals.membership.shop_id);
  return json({ due, count: due.length }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
