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
    recipients?: { to?: string[]; cc?: string[]; phones?: string[] };
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
    const { data: contacts } = await svc
      .from('client_contacts')
      .select('email, phone, always_notify, is_primary')
      .eq('client_id', quote.client_id);
    const { data: shop } = await svc
      .from('shops')
      .select('owner_email, trade_name, legal_name')
      .eq('id', locals.membership.shop_id)
      .maybeSingle();
    const fromLabel = shop?.trade_name || shop?.legal_name || 'Your contractor';

    if (channel === 'email') {
      const explicit = body.recipients?.to?.filter((e) => e && e.includes('@')) ?? [];
      const defaults = (contacts ?? [])
        .filter((c: any) => c.email && c.always_notify)
        .map((c: any) => c.email as string);
      const to = explicit.length > 0
        ? explicit
        : defaults.length > 0
          ? defaults
          : client?.primary_contact_email
            ? [client.primary_contact_email]
            : [];
      const cc = body.recipients?.cc?.filter((e) => e && e.includes('@')) ?? [];
      if (to.length === 0) {
        deliveryError = 'No email recipients on file';
      } else {
        const result = await sendEmail(env, {
          to,
          cc: cc.length > 0 ? cc : undefined,
          reply_to: shop?.owner_email ?? undefined,
          subject: body.subject ?? `Re: ${quote.project_title} · ${quote.ref}`,
          text: body.body,
        });
        if (result.ok) delivery = { provider: result.provider, id: result.id };
        else deliveryError = result.message;
      }
    } else if (channel === 'sms') {
      const explicitPhones = body.recipients?.phones?.filter((p) => !!p) ?? [];
      const fallbackPhones = (contacts ?? [])
        .filter((c: any) => c.phone && c.always_notify)
        .map((c: any) => c.phone as string);
      const phones = explicitPhones.length > 0
        ? explicitPhones
        : fallbackPhones.length > 0
          ? fallbackPhones
          : client?.primary_contact_phone
            ? [client.primary_contact_phone]
            : [];
      if (phones.length === 0) {
        deliveryError = 'No phone on file for client';
      } else {
        // SMS is one message per recipient — Twilio doesn't bcc-style fan out.
        const results = await Promise.all(
          phones.map((to) =>
            sendSms(env, { to, body: `${body.body}\n\n— ${fromLabel}` }),
          ),
        );
        const firstOk = results.find((r) => r.ok);
        if (firstOk && firstOk.ok) delivery = { provider: firstOk.provider, id: firstOk.id };
        const failures = results.filter((r) => !r.ok);
        if (failures.length === results.length) {
          deliveryError = failures.map((f) => (f as any).message).join(' · ');
        } else if (failures.length > 0) {
          deliveryError = `Sent to ${results.length - failures.length}/${results.length}; failures: ${failures.map((f) => (f as any).message).join(' · ')}`;
        }
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
    payload: { channel, delivery, delivery_error: deliveryError, recipients: body.recipients ?? null },
  });

  return json({ ok: true, delivery, delivery_error: deliveryError }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
