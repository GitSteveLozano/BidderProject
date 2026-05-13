/**
 * POST /api/quote/mark-lost
 *
 * Transitions a quote to LOST and captures the outcome. The schema
 * already carries outcome_competitor / outcome_winning_bid /
 * outcome_reason — this endpoint actually writes them so we
 * accumulate signal for future pricing recommendations and the
 * postmortem flow.
 *
 * Body:
 *   { quote_id: string,
 *     reason?: string,                 // free-text
 *     competitor?: string,
 *     winning_bid?: number | null }
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';
import { captureOutcome } from '@/lib/winloss-agent';
import { runIntelligencePass } from '@/lib/intelligence-agent';

export const prerender = false;

interface Body {
  quote_id?: string;
  reason?: string | null;
  competitor?: string | null;
  winning_bid?: number | null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  const { data: quote } = await svc
    .from('quotes')
    .select('id, state')
    .eq('id', body.quote_id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);
  if (quote.state === 'WON') {
    return json({ error: 'Cannot mark a WON quote as lost' }, 409);
  }

  const now = new Date().toISOString();
  await svc
    .from('quotes')
    .update({
      state: 'LOST',
      outcome_reason: body.reason ?? null,
      outcome_competitor: body.competitor ?? null,
      outcome_winning_bid: body.winning_bid ?? null,
      outcome_captured_at: now,
    })
    .eq('id', quote.id);

  await svc.from('events').insert({
    shop_id: shopId,
    quote_id: quote.id,
    type: 'quote.lost',
    actor: locals.user.email ?? 'user',
    payload: {
      reason: body.reason ?? null,
      competitor: body.competitor ?? null,
      winning_bid: body.winning_bid ?? null,
    },
  });

  // Win/Loss agent: infer contributing factors + write a
  // past_quote_summary chunk back into Context so future similar
  // scopes can retrieve this loss + its reasons.
  try {
    await captureOutcome(env, svc, shopId, quote.id, 'lost', body.reason ?? null);
  } catch (e) {
    console.warn('[mark-lost] winloss capture failed', e);
  }

  // Intelligence pass: a fresh loss shifts win-rate/margin trends.
  runIntelligencePass(env, svc, shopId).catch((e) => {
    console.warn('[mark-lost] intelligence run failed', e);
  });

  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
