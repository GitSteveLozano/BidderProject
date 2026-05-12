/**
 * POST /api/quote/send
 *
 * Transition a DRAFT quote to SENT. Records the event for the activity
 * feed. When channel='email' and the client has an email on file, the
 * quote link is delivered via Resend; otherwise the endpoint succeeds
 * as a "marked sent" record so the operator can deliver manually
 * (matches the pre-Resend behavior).
 *
 * Body: { quote_id: string, channel?: 'email' | 'manual' }
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { sendEmail } from '@/lib/delivery';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, url }) => {
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
    .select('id, state, client_name, client_id, ref, project_title, total')
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
    const { data: shop } = await svc
      .from('shops')
      .select('owner_email, trade_name, legal_name')
      .eq('id', shopId)
      .maybeSingle();

    const recipientEmail = client?.primary_contact_email;
    if (!recipientEmail) {
      deliveryError = 'No email on file for client — marked sent without delivery';
    } else {
      const fromLabel = shop?.trade_name || shop?.legal_name || 'Your contractor';
      const publicLink = `${url.origin}/q/${quote.id}`;
      const pixel = `${url.origin}/api/quote/${quote.id}/track-open?from=email`;
      const totalStr = `$${Number(quote.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const result = await sendEmail(env, {
        to: recipientEmail,
        reply_to: shop?.owner_email ?? undefined,
        subject: `Quote for ${quote.project_title} · ${quote.ref}`,
        text:
          `Hi ${client.primary_contact_name ?? recipientEmail},\n\n` +
          `Here's the quote for ${quote.project_title}. Total: ${totalStr}.\n\n` +
          `Read it here: ${publicLink}\n\n` +
          `Reply to this email with any questions.\n\n` +
          `— ${fromLabel}`,
        html:
          `<p>Hi ${escapeHtml(client.primary_contact_name ?? recipientEmail)},</p>` +
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
    payload: { channel, delivery, delivery_error: deliveryError },
  });

  return json(
    { id: quote.id, ref: quote.ref, sent_at: sentAt, delivery, delivery_error: deliveryError },
    200,
  );
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
