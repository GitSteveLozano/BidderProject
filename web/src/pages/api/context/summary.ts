/**
 * GET /api/context/summary
 *
 * Profile inspection: chunk counts per type + last-updated timestamps.
 * Powers the read-only Context section on /settings.
 */
import type { APIRoute } from 'astro';

import { profileSummary } from '@/lib/context';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const svc = supabaseService(env, 'service');
  const summary = await profileSummary(svc, locals.membership.shop_id);
  const total = summary.reduce((s, r) => s + r.count, 0);
  return json({ shop_id: locals.membership.shop_id, total, by_type: summary }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
