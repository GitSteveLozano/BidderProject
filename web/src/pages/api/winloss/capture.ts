/**
 * POST /api/winloss/capture
 *
 * Body: { quote_id, outcome, captured_reason? }
 *
 * Captures an outcome end-to-end: builds snapshot, runs LLM factor
 * inference, persists winloss_signals row, writes past_quote_summary
 * chunk back into Context. Called by mark-won / mark-lost flows.
 */
import type { APIRoute } from 'astro';

import { captureOutcome, type Outcome } from '@/lib/winloss-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const VALID_OUTCOMES: Outcome[] = ['won', 'lost', 'withdrawn', 'no_decision'];

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: { quote_id?: string; outcome?: string; captured_reason?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);
  if (!VALID_OUTCOMES.includes(body.outcome as Outcome)) {
    return json({ error: 'outcome must be one of: ' + VALID_OUTCOMES.join(', ') }, 400);
  }

  const svc = supabaseService(env, 'service');
  const result = await captureOutcome(
    env,
    svc,
    locals.membership.shop_id,
    body.quote_id,
    body.outcome as Outcome,
    body.captured_reason ?? null,
  );
  if (!result) return json({ error: 'quote not found' }, 404);
  return json(result, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
