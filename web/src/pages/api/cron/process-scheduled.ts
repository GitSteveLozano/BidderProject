/**
 * POST /api/cron/process-scheduled
 *
 * Dispatcher for messages the operator queued for later. Scans
 * quote_messages for rows where draft=true AND scheduled_for IS NOT
 * NULL AND scheduled_for <= now() AND sent_at IS NULL, then sends each
 * via Brevo/Twilio using the existing delivery lib. Flips draft→false
 * and stamps sent_at on success.
 *
 * Triggered by an external cron (CF Cron Triggers on a sibling worker
 * or cron-job.org hitting this URL every minute). Authenticated via
 * shared CRON_SECRET in the `x-brief-cron-secret` header — no user
 * session needed.
 *
 * Returns a small JSON report: { processed, sent, failed, errors }.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { sendEmail, sendSms } from '@/lib/delivery';

export const prerender = false;

const MAX_BATCH = 50;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);

  const secret = request.headers.get('x-brief-cron-secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const svc = supabaseService(env, 'service');

  const { data: due, error } = await svc
    .from('quote_messages')
    .select(
      `id, quote_id, channel, subject, body, drafted_by, scheduled_for,
       quotes!inner(id, shop_id, state, client_id, ref, project_title)`,
    )
    .eq('draft', true)
    .is('sent_at', null)
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(MAX_BATCH);
  if (error) return json({ error: error.message }, 500);

  const report = { processed: 0, sent: 0, failed: 0, errors: [] as string[] };

  for (const row of due ?? []) {
    report.processed += 1;
    const quote = row.quotes as unknown as {
      id: string;
      shop_id: string;
      state: string;
      client_id: string;
      ref: string;
      project_title: string;
    };

    const { data: client } = await svc
      .from('clients')
      .select('primary_contact_email, primary_contact_phone, primary_contact_name')
      .eq('id', quote.client_id)
      .maybeSingle();
    const { data: shop } = await svc
      .from('shops')
      .select('owner_email, trade_name, legal_name')
      .eq('id', quote.shop_id)
      .maybeSingle();
    const fromLabel = shop?.trade_name || shop?.legal_name || 'Your contractor';

    let delivery: { provider: string; id: string } | null = null;
    let deliveryError: string | null = null;

    if (row.channel === 'email') {
      if (!client?.primary_contact_email) {
        deliveryError = 'No email on file for client';
      } else {
        const result = await sendEmail(env, {
          to: client.primary_contact_email,
          reply_to: shop?.owner_email ?? undefined,
          subject: row.subject ?? `Re: ${quote.project_title} · ${quote.ref}`,
          text: row.body,
        });
        if (result.ok) delivery = { provider: result.provider, id: result.id };
        else deliveryError = result.message;
      }
    } else if (row.channel === 'sms') {
      if (!client?.primary_contact_phone) {
        deliveryError = 'No phone on file for client';
      } else {
        const result = await sendSms(env, {
          to: client.primary_contact_phone,
          body: `${row.body}\n\n— ${fromLabel}`,
        });
        if (result.ok) delivery = { provider: result.provider, id: result.id };
        else deliveryError = result.message;
      }
    }

    // Whether or not delivery succeeded, mark the row as sent so we
    // don't keep retrying on every tick. The delivery_error lives on
    // the events row for the operator to see.
    const sentAt = new Date().toISOString();
    await svc
      .from('quote_messages')
      .update({ draft: false, sent_at: sentAt })
      .eq('id', row.id);

    if (quote.state === 'SENT' && row.channel !== 'manual') {
      await svc.from('quotes').update({ state: 'AWAITING' }).eq('id', quote.id);
    }

    await svc.from('events').insert({
      shop_id: quote.shop_id,
      quote_id: quote.id,
      type: 'nudge.sent',
      actor: 'cron',
      payload: {
        channel: row.channel,
        delivery,
        delivery_error: deliveryError,
        scheduled_for: row.scheduled_for,
      },
    });

    if (deliveryError) {
      report.failed += 1;
      report.errors.push(`${row.id}: ${deliveryError}`);
    } else {
      report.sent += 1;
    }
  }

  return json(report, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
