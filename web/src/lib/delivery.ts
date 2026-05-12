/**
 * Outbound delivery — Brevo (email) + Twilio (SMS).
 *
 * Each `sendX` helper returns a `DeliveryResult` rather than throwing,
 * so the API endpoint that called it can record the outcome without
 * derailing the rest of its work (recording the message, advancing
 * state, emitting the activity event). If credentials aren't set we
 * report `{ ok: false, kind: 'unconfigured' }` and the caller can
 * decide how to handle it (typically: keep the "marked sent" path so
 * the operator can still deliver manually).
 *
 * Brevo was picked over Resend because it allows a single verified
 * sender email (Gmail, etc.) on the free tier — no domain purchase.
 * 300 emails/day on free.
 */
import type { CloudflareEnv } from './supabase';

export type DeliveryFailureKind = 'unconfigured' | 'invalid_input' | 'provider_error';

export type DeliveryResult =
  | { ok: true; provider: 'brevo' | 'twilio'; id: string }
  | { ok: false; kind: DeliveryFailureKind; message: string };

interface EmailInput {
  to: string;
  reply_to?: string;
  subject: string;
  text: string;
  /** Optional HTML body. When set, Brevo delivers a multipart message
   * with both text and HTML and most clients render the HTML. Used by
   * /api/quote/send to ship a Call-To-Action button + tracking pixel. */
  html?: string;
}

export async function sendEmail(env: CloudflareEnv, input: EmailInput): Promise<DeliveryResult> {
  if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL) {
    return { ok: false, kind: 'unconfigured', message: 'Brevo not configured' };
  }
  if (!input.to.includes('@')) {
    return { ok: false, kind: 'invalid_input', message: `Invalid recipient: ${input.to}` };
  }

  const sender: Record<string, string> = { email: env.BREVO_FROM_EMAIL };
  if (env.BREVO_FROM_NAME) sender.name = env.BREVO_FROM_NAME;

  const payload: Record<string, unknown> = {
    sender,
    to: [{ email: input.to }],
    subject: input.subject,
    textContent: input.text,
  };
  if (input.html) payload.htmlContent = input.html;
  if (input.reply_to) {
    payload.replyTo = { email: input.reply_to };
  }

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, kind: 'provider_error', message: `Brevo ${resp.status}: ${body}` };
  }
  const data = (await resp.json()) as { messageId?: string };
  return { ok: true, provider: 'brevo', id: data.messageId ?? 'unknown' };
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
