/**
 * POST /api/quote/message
 *
 * Append a message to a quote's thread. For channel='email' delivers
 * via Resend; for channel='sms' delivers via Twilio. Either provider
 * being unconfigured falls back to "record-only" — the message still
 * lands in quote_messages so the operator's thread is intact, and the
 * UI surfaces delivery_error so they know to send manually.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { sendEmail, sendSms } from '@/lib/delivery';

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
  const { data: quote } = await svc
    .from('quotes')
    .select('id, shop_id, state, client_id, ref, project_title')
    .eq('id', body.quote_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);

  const channel = body.channel ?? 'email';
  const scheduled = !!body.scheduled_for;
  let delivery: { provider: string; id: string } | null = null;
  let deliveryError: string | null = null;

  if (!scheduled && (channel === 'email' || channel === 'sms')) {
    const { data: client } = await svc
      .from('clients')
      .select('primary_contact_email, primary_contact_phone, primary_contact_name')
      .eq('id', quote.client_id)
      .maybeSingle();
    const { data: shop } = await svc
      .from('shops')
      .select('owner_email, trade_name, legal_name')
      .eq('id', locals.membership.shop_id)
      .maybeSingle();
    const fromLabel = shop?.trade_name || shop?.legal_name || 'Your contractor';

    if (channel === 'email') {
      if (!client?.primary_contact_email) {
        deliveryError = 'No email on file for client';
      } else {
        const result = await sendEmail(env, {
          to: client.primary_contact_email,
          reply_to: shop?.owner_email ?? undefined,
          subject: body.subject ?? `Re: ${quote.project_title} · ${quote.ref}`,
          text: body.body,
        });
        if (result.ok) delivery = { provider: result.provider, id: result.id };
        else deliveryError = result.message;
      }
    } else if (channel === 'sms') {
      if (!client?.primary_contact_phone) {
        deliveryError = 'No phone on file for client';
      } else {
        const result = await sendSms(env, {
          to: client.primary_contact_phone,
          body: `${body.body}\n\n— ${fromLabel}`,
        });
        if (result.ok) delivery = { provider: result.provider, id: result.id };
        else deliveryError = result.message;
      }
    }
  }

  const sentAt = scheduled ? null : new Date().toISOString();

  const { error } = await svc.from('quote_messages').insert({
    quote_id: quote.id,
    direction: 'outbound',
    channel,
    subject: body.subject ?? null,
    body: body.body,
    draft: scheduled,
    drafted_by: body.drafted_by ?? 'user',
    scheduled_for: body.scheduled_for ?? null,
    sent_at: sentAt,
  });
  if (error) return json({ error: error.message }, 500);

  if (quote.state === 'SENT' && channel !== 'manual') {
    await svc.from('quotes').update({ state: 'AWAITING' }).eq('id', quote.id);
  }

  await svc.from('events').insert({
    shop_id: locals.membership.shop_id,
    quote_id: quote.id,
    type: 'nudge.sent',
    actor: locals.user.email ?? 'user',
    payload: { channel, delivery, delivery_error: deliveryError },
  });

  return json({ ok: true, delivery, delivery_error: deliveryError }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
