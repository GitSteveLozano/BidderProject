/**
 * POST /api/inbound/email — record an inbound message on a quote.
 *
 * Today this serves two callers:
 *   1. The operator pastes a client reply from their personal inbox
 *      via the "Log a reply" form on /quotes/[id]. They're signed in,
 *      so we resolve shop_id from the session.
 *   2. (Future) A real inbound-parsing webhook from Brevo / Cloudflare
 *      Email Routing once a custom domain is set up. That path would
 *      POST a payload that names the quote_id (via subject line or
 *      threading header) plus the raw email body. We accept a shared
 *      `INBOUND_WEBHOOK_SECRET` env var to authenticate webhook calls
 *      so we don't gate them on user sessions.
 *
 * Side effects:
 *   - Insert into quote_messages (direction='inbound').
 *   - Transition quote state SENT|AWAITING → RESPONDED (idempotent).
 *   - Emit `quote.responded` event for the activity feed.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface Body {
  quote_id?: string;
  from?: string;
  subject?: string;
  body?: string;
  received_at?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);

  // Auth: either a user session (operator paste) or the shared webhook
  // secret (automated path). One of the two must be present.
  const webhookSecret = request.headers.get('x-brief-webhook-secret');
  const isWebhook = !!webhookSecret && webhookSecret === env.INBOUND_WEBHOOK_SECRET;
  if (!isWebhook && (!locals.user || !locals.membership)) {
    return json({ error: 'Not authenticated' }, 401);
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id || !body.body) {
    return json({ error: 'quote_id + body required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const quoteQuery = svc
    .from('quotes')
    .select('id, shop_id, state')
    .eq('id', body.quote_id);
  if (!isWebhook && locals.membership) {
    quoteQuery.eq('shop_id', locals.membership.shop_id);
  }
  const { data: quote } = await quoteQuery.maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);

  const sentAt = body.received_at ?? new Date().toISOString();

  const { error: msgError } = await svc.from('quote_messages').insert({
    quote_id: quote.id,
    direction: 'inbound',
    channel: 'email',
    subject: body.subject ?? null,
    body: body.body,
    drafted_by: 'user',
    sent_at: sentAt,
    sender_email: body.from ?? null,
  });
  if (msgError) return json({ error: msgError.message }, 500);

  // Advance state once. If the operator pastes a second reply on an
  // already-RESPONDED quote we leave state alone.
  if (quote.state === 'SENT' || quote.state === 'AWAITING') {
    await svc
      .from('quotes')
      .update({ state: 'RESPONDED', responded_at: sentAt })
      .eq('id', quote.id);
  }

  await svc.from('events').insert({
    shop_id: quote.shop_id,
    quote_id: quote.id,
    type: 'quote.responded',
    actor: body.from ?? 'client',
    payload: {
      source: isWebhook ? 'webhook' : 'paste',
      subject: body.subject ?? null,
    },
  });

  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
