/**
 * POST /api/intelligence/run
 *
 * Runs all four Intelligence finding types for the calling shop and
 * persists new findings. Idempotent within 7d (skips dup headlines).
 *
 * Intended to be triggered (a) manually from the UI's "refresh
 * insights" button, and (b) nightly by the cron worker.
 */
import type { APIRoute } from 'astro';

import { runIntelligencePass } from '@/lib/intelligence-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  const svc = supabaseService(env, 'service');
  const result = await runIntelligencePass(env, svc, locals.membership.shop_id);
  return json(result, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
