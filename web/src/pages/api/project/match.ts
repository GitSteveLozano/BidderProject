/**
 * POST /api/project/match
 *
 * Given a doc's signal text (extracted/pasted intake), returns
 * existing projects that look similar. Used by the multi-upload UI's
 * auto-group step:
 *
 *   - operator drops 5 files
 *   - each file gets its text extracted client-side
 *   - for each, POST here → returns matches
 *   - cluster files whose top-match is the same project
 *   - propose: attach cluster A to project P; mint a new project P'
 *     for cluster B; cluster C is uncategorized.
 *
 * Body: { signal: string } where signal is text we'll embed
 * (typically client_name + address + first ~600 chars of doc text).
 */
import type { APIRoute } from 'astro';

import { findMatchingProjects } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'AI binding not configured' }, 500);

  let body: { signal?: string; limit?: number; threshold?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.signal || body.signal.trim().length < 10) {
    return json({ error: 'signal too short' }, 400);
  }
  const svc = supabaseService(env, 'service');
  const matches = await findMatchingProjects(env, svc, locals.membership.shop_id, body.signal, {
    limit: body.limit ?? 5,
    threshold: body.threshold,
  });
  return json({ matches }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
