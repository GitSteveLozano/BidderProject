/**
 * POST /api/followup/draft
 *
 * Body: { followup_id }
 *
 * Generates voice-matched prose for a scheduled follow-up via the
 * Composition agent and writes it to followup_schedules.draft_text.
 */
import type { APIRoute } from 'astro';

import { draftFollowup } from '@/lib/followup-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: { followup_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.followup_id) return json({ error: 'followup_id required' }, 400);

  const svc = supabaseService(env, 'service');
  // Confirm tenant ownership before drafting.
  const { data: row } = await svc
    .from('followup_schedules')
    .select('shop_id')
    .eq('id', body.followup_id)
    .maybeSingle();
  if (!row || row.shop_id !== locals.membership.shop_id) {
    return json({ error: 'follow-up not found' }, 404);
  }

  const result = await draftFollowup(env, svc, body.followup_id);
  if (!result) return json({ error: 'draft failed' }, 500);
  return json(result, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
