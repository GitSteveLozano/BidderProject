/**
 * POST /api/context/seed
 *
 * Diagnostic-only endpoint. Brief auto-seeds Context on onboarding
 * completion + lazily on first quote save (see lib/context.maybeBootstrapShop)
 * — operators never call this directly. Kept here so we can manually
 * re-seed via curl if something gets corrupted.
 */
import type { APIRoute } from 'astro';

import { seedFromShop } from '@/lib/context';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  const svc = supabaseService(env, 'service');
  const result = await seedFromShop(env, svc, locals.membership.shop_id);
  return json({ shop_id: locals.membership.shop_id, ...result }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
