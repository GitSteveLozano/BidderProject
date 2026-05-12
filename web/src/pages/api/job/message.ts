/**
 * POST /api/job/message
 *
 * Records an outbound message about a job (status update or check-in)
 * as an event, and — when channel='email'|'sms' — delivers via Resend
 * / Twilio. Unconfigured providers fall back to "record-only" so the
 * intent is still captured and the UI can surface delivery_error.
 *
 * Mirrors POST /api/quote/message in shape.
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
    job_id?: string;
    kind?: 'update' | 'check-in';
    channel?: 'email' | 'sms' | 'manual';
    subject?: string;
    body?: string;
    drafted_by?: 'brief' | 'user';
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.job_id || !body.body) {
    return json({ error: 'job_id + body required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const { data: job } = await svc
    .from('jobs')
    .select('id, shop_id, client_id, ref, project_title')
    .eq('id', body.job_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!job) return json({ error: 'Job not found' }, 404);

  const channel = body.channel ?? 'email';
  let delivery: { provider: string; id: string } | null = null;
  let deliveryError: string | null = null;

  if (channel === 'email' || channel === 'sms') {
    const { data: client } = await svc
      .from('clients')
      .select('primary_contact_email, primary_contact_phone, primary_contact_name')
      .eq('id', job.client_id)
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
          subject: body.subject ?? `${body.kind === 'check-in' ? 'Check-in' : 'Update'} on ${job.project_title} · ${job.ref}`,
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

  const type = body.kind === 'check-in' ? 'job.check_in.sent' : 'job.update.sent';
  const { error } = await svc.from('events').insert({
    shop_id: locals.membership.shop_id,
    job_id: job.id,
    type,
    actor: locals.user.email ?? 'user',
    payload: {
      subject: body.subject ?? null,
      body: body.body,
      drafted_by: body.drafted_by ?? 'user',
      channel,
      delivery,
      delivery_error: deliveryError,
    },
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, delivery, delivery_error: deliveryError }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
