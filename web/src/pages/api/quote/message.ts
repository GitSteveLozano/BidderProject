/**
 * POST /api/quote/message
 *
 * Append a message to a quote's thread. If channel='email' or 'sms',
 * record sent_at = now; we don't actually deliver email/sms yet (the
 * operator copies the body into their preferred client). When real
 * delivery ships (Resend/Postmark/Twilio), this is the wire-up point.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: {
    quote_id?: string;
    channel?: 'email' | 'sms' | 'manual';
    subject?: string;
    body?: string;
    drafted_by?: 'brief' | 'user';
    scheduled_for?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id || !body.body) {
    return json({ error: 'quote_id + body required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  // Verify the quote belongs to the user's shop
  const { data: quote } = await svc
    .from('quotes')
    .select('id, shop_id, state')
    .eq('id', body.quote_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);

  const sentAt = body.scheduled_for ? null : new Date().toISOString();

  const { error } = await svc.from('quote_messages').insert({
    quote_id: quote.id,
    direction: 'outbound',
    channel: body.channel ?? 'email',
    subject: body.subject ?? null,
    body: body.body,
    draft: !!body.scheduled_for,
    drafted_by: body.drafted_by ?? 'user',
    scheduled_for: body.scheduled_for ?? null,
    sent_at: sentAt,
  });
  if (error) return json({ error: error.message }, 500);

  // Move state to AWAITING after a nudge if currently SENT
  if (quote.state === 'SENT' && body.channel !== 'manual') {
    await svc.from('quotes').update({ state: 'AWAITING' }).eq('id', quote.id);
  }

  // Activity event
  await svc.from('events').insert({
    shop_id: locals.membership.shop_id,
    quote_id: quote.id,
    type: 'nudge.sent',
    actor: locals.user.email ?? 'user',
    payload: { channel: body.channel },
  });

  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
