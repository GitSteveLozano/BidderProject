/**
 * POST /api/followup/schedule
 *
 * Body: { quote_id }
 *
 * Schedules the three post-send follow-ups (initial_check_in,
 * gentle_nudge, last_call) keyed to the quote's sent_at and the shop's
 * historical winning cadence. Idempotent (supersedes prior schedules).
 */
import type { APIRoute } from 'astro';

import { scheduleForQuote } from '@/lib/followup-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: { quote_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);

  const svc = supabaseService(env, 'service');
  const result = await scheduleForQuote(svc, locals.membership.shop_id, body.quote_id);
  return json(result, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
