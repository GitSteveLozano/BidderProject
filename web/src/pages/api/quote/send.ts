/**
 * POST /api/quote/send
 *
 * Transition a DRAFT quote to SENT. Records the event for the activity
 * feed. Email delivery is stubbed (no SMTP wired in this PR — followup).
 *
 * Body: { quote_id: string, channel?: 'email' | 'manual' }
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: { quote_id?: string; channel?: 'email' | 'manual' };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  const { data: quote, error } = await svc
    .from('quotes')
    .select('id, state, client_name, ref')
    .eq('id', body.quote_id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!quote) return json({ error: 'Quote not found' }, 404);
  if (quote.state !== 'DRAFT') {
    return json({ error: `Cannot send a ${quote.state} quote` }, 400);
  }

  const sentAt = new Date().toISOString();
  await svc
    .from('quotes')
    .update({ state: 'SENT', sent_at: sentAt })
    .eq('id', quote.id);

  await svc.from('events').insert({
    shop_id: shopId,
    quote_id: quote.id,
    type: 'quote.sent',
    actor: locals.user.email ?? 'user',
    payload: { channel: body.channel ?? 'manual' },
  });

  // TODO: actual email send via Resend / Postmark / etc. For now we
  // record the intent — the operator delivers the PDF manually.
  return json({ id: quote.id, ref: quote.ref, sent_at: sentAt }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
