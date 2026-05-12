/**
 * Outbound delivery — Resend (email) + Twilio (SMS).
 *
 * Each `sendX` helper returns a `DeliveryResult` rather than throwing,
 * so the API endpoint that called it can record the outcome without
 * derailing the rest of its work (recording the message, advancing
 * state, emitting the activity event). If credentials aren't set we
 * report `{ ok: false, kind: 'unconfigured' }` and the caller can
 * decide how to handle it (typically: keep the "marked sent" path so
 * the operator can still deliver manually).
 */
import type { CloudflareEnv } from './supabase';

export type DeliveryFailureKind = 'unconfigured' | 'invalid_input' | 'provider_error';

export type DeliveryResult =
  | { ok: true; provider: 'resend' | 'twilio'; id: string }
  | { ok: false; kind: DeliveryFailureKind; message: string };

interface EmailInput {
  to: string;
  reply_to?: string;
  subject: string;
  text: string;
}

export async function sendEmail(env: CloudflareEnv, input: EmailInput): Promise<DeliveryResult> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_ADDRESS) {
    return { ok: false, kind: 'unconfigured', message: 'Resend not configured' };
  }
  if (!input.to.includes('@')) {
    return { ok: false, kind: 'invalid_input', message: `Invalid recipient: ${input.to}` };
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_ADDRESS,
      to: input.to,
      reply_to: input.reply_to,
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, kind: 'provider_error', message: `Resend ${resp.status}: ${body}` };
  }
  const data = (await resp.json()) as { id?: string };
  return { ok: true, provider: 'resend', id: data.id ?? 'unknown' };
}

interface SmsInput {
  to: string;
  body: string;
}

export async function sendSms(env: CloudflareEnv, input: SmsInput): Promise<DeliveryResult> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    return { ok: false, kind: 'unconfigured', message: 'Twilio not configured' };
  }
  const to = normalizePhone(input.to);
  if (!to) {
    return { ok: false, kind: 'invalid_input', message: `Invalid phone: ${input.to}` };
  }
  if (input.body.length === 0) {
    return { ok: false, kind: 'invalid_input', message: 'Empty body' };
  }
  // Twilio caps body at 1600 chars; truncate rather than 4xx.
  const trimmed = input.body.length > 1500 ? input.body.slice(0, 1500) + '…' : input.body;

  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', env.TWILIO_FROM_NUMBER);
  form.set('Body', trimmed);

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, kind: 'provider_error', message: `Twilio ${resp.status}: ${body}` };
  }
  const data = (await resp.json()) as { sid?: string };
  return { ok: true, provider: 'twilio', id: data.sid ?? 'unknown' };
}

function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/[^\d+]/g, '');
  if (!stripped) return null;
  if (stripped.startsWith('+')) return stripped;
  if (stripped.length === 10) return `+1${stripped}`;
  if (stripped.length === 11 && stripped.startsWith('1')) return `+${stripped}`;
  return null;
}
