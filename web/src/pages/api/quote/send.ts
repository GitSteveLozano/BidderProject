/**
 * POST /api/quote/send
 *
 * Transition a DRAFT quote to SENT. Records the event for the activity
 * feed. When channel='email', delivers to the recipients on the body
 * (or, if omitted, every always_notify contact + the legacy
 * primary_contact_email fallback).
 *
 * Body:
 *   { quote_id: string,
 *     channel?: 'email' | 'manual',
 *     recipients?: { to?: string[], cc?: string[] } }
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { sendEmail } from '@/lib/delivery';
import { scheduleForQuote } from '@/lib/followup-agent';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: {
    quote_id?: string;
    channel?: 'email' | 'manual';
    recipients?: { to?: string[]; cc?: string[] };
  };
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
    .select('id, state, client_name, client_id, ref, project_title, total, offer_kind')
    .eq('id', body.quote_id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!quote) return json({ error: 'Quote not found' }, 404);
  if (quote.state !== 'DRAFT') {
    return json({ error: `Cannot send a ${quote.state} quote` }, 400);
  }

  const channel = body.channel ?? 'manual';
  let delivery: { provider: string; id: string } | null = null;
  let deliveryError: string | null = null;

  if (channel === 'email') {
    const { data: client } = await svc
      .from('clients')
      .select('primary_contact_email, primary_contact_name')
      .eq('id', quote.client_id)
      .maybeSingle();
    const { data: contacts } = await svc
      .from('client_contacts')
      .select('email, name, always_notify, is_primary')
      .eq('client_id', quote.client_id);
    const { data: shop } = await svc
      .from('shops')
      .select('owner_email, trade_name, legal_name')
      .eq('id', shopId)
      .maybeSingle();

    // Resolve recipients: explicit list wins; otherwise default to
    // always_notify contacts; otherwise fall back to legacy primary.
    const recipientsTo = body.recipients?.to?.filter((e) => e && e.includes('@')) ?? [];
    const recipientsCc = body.recipients?.cc?.filter((e) => e && e.includes('@')) ?? [];

    let to = recipientsTo;
    let cc = recipientsCc;
    if (to.length === 0) {
      const defaults = (contacts ?? [])
        .filter((c: any) => c.email && c.always_notify)
        .map((c: any) => c.email as string);
      if (defaults.length > 0) {
        to = defaults;
      } else if (client?.primary_contact_email) {
        to = [client.primary_contact_email];
      }
    }

    if (to.length === 0) {
      deliveryError = 'No recipients resolved — marked sent without delivery';
    } else {
      const fromLabel = shop?.trade_name || shop?.legal_name || 'Your contractor';
      const publicLink = `${url.origin}/q/${quote.id}`;
      const pixel = `${url.origin}/api/quote/${quote.id}/track-open?from=email`;
      const totalStr = `$${Number(quote.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      // Greeting uses the primary contact's name if their email is in
      // the to-list, otherwise generic.
      const primary = (contacts ?? []).find(
        (c: any) => c.is_primary && c.email && to.includes(c.email),
      );
      const greetingName = primary?.name ?? client?.primary_contact_name ?? '';
      const result = await sendEmail(env, {
        to,
        cc: cc.length > 0 ? cc : undefined,
        reply_to: shop?.owner_email ?? undefined,
        subject: `${offerSubjectLabel(quote.offer_kind)} for ${quote.project_title} · ${quote.ref}`,
        text:
          `${greetingName ? `Hi ${greetingName},\n\n` : 'Hello,\n\n'}` +
          `Here's the quote for ${quote.project_title}. Total: ${totalStr}.\n\n` +
          `Read it here: ${publicLink}\n\n` +
          `Reply to this email with any questions.\n\n` +
          `— ${fromLabel}`,
        html:
          `<p>${greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hello,'}</p>` +
          `<p>Here's the quote for <strong>${escapeHtml(quote.project_title)}</strong>. Total: <strong>${totalStr}</strong>.</p>` +
          `<p><a href="${publicLink}" style="background:#a85432;color:#fffaf2;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block;font-family:sans-serif;font-size:14px">Read the quote</a></p>` +
          `<p>Reply to this email with any questions.</p>` +
          `<p>— ${escapeHtml(fromLabel)}</p>` +
          `<img src="${pixel}" width="1" height="1" alt="" style="display:none" />`,
      });
      if (result.ok) {
        delivery = { provider: result.provider, id: result.id };
      } else {
        deliveryError = result.message;
      }
    }
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
    payload: {
      channel,
      delivery,
      delivery_error: deliveryError,
      recipients: body.recipients ?? null,
    },
  });

  // Follow-up agent: schedule the three post-send touches (check-in,
  // nudge, last-call) keyed off sent_at + the shop's winning cadence.
  // Best-effort — never blocks the send response.
  let followups: { scheduled: number } | null = null;
  try {
    followups = await scheduleForQuote(svc, shopId, quote.id);
  } catch (e) {
    console.warn('[send] follow-up scheduling failed', e);
  }

  return json(
    {
      id: quote.id,
      ref: quote.ref,
      sent_at: sentAt,
      delivery,
      delivery_error: deliveryError,
      followups_scheduled: followups?.scheduled ?? 0,
    },
    200,
  );
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Email-subject prefix for the offer kind. Defaults to 'Quote' for
 * older rows that pre-date migration 012. */
function offerSubjectLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'bid':
      return 'Bid';
    case 'proposal':
      return 'Proposal';
    case 'contract':
      return 'Contract';
    case 'quote':
    default:
      return 'Quote';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
