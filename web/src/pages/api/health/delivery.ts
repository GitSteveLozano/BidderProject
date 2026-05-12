/**
 * GET /api/health/delivery
 *
 * One-shot diagnostic for the outbound providers. Hits the metadata
 * endpoint on each (Brevo /v3/account, Twilio /Accounts/{sid}.json) —
 * verifies the API key is valid + reachable without actually sending
 * a message. Also surfaces whether BREVO_FROM_EMAIL is among the
 * account's verified senders so a misconfigured "from" doesn't bite
 * us at send time.
 *
 * Gated to authenticated owners/admins so we don't leak provider
 * status publicly.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

interface ProviderReport {
  configured: boolean;
  ok: boolean;
  detail: string;
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user || !locals.membership) {
    return json({ error: 'Not authenticated' }, 401);
  }
  if (locals.membership.role !== 'owner' && locals.membership.role !== 'admin') {
    return json({ error: 'owner or admin only' }, 403);
  }
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);

  const [brevo, twilio] = await Promise.all([probeBrevo(env), probeTwilio(env)]);

  return json({ brevo, twilio }, 200);
};

async function probeBrevo(env: NonNullable<App.Locals['runtime']>['env']): Promise<ProviderReport> {
  if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL) {
    return { configured: false, ok: false, detail: 'BREVO_API_KEY or BREVO_FROM_EMAIL not set' };
  }
  // Account probe — validates the key is live and not revoked.
  let accountResp: Response;
  try {
    accountResp = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': env.BREVO_API_KEY, accept: 'application/json' },
    });
  } catch (err) {
    return { configured: true, ok: false, detail: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!accountResp.ok) {
    const body = (await accountResp.text()).slice(0, 200);
    return { configured: true, ok: false, detail: `Brevo /account ${accountResp.status}: ${body}` };
  }

  // Sender probe — verifies BREVO_FROM_EMAIL is on the verified-senders list.
  const sendersResp = await fetch('https://api.brevo.com/v3/senders', {
    headers: { 'api-key': env.BREVO_API_KEY, accept: 'application/json' },
  });
  if (!sendersResp.ok) {
    return {
      configured: true,
      ok: false,
      detail: `Brevo /senders ${sendersResp.status} — key valid but couldn't list senders`,
    };
  }
  const data = (await sendersResp.json()) as { senders?: Array<{ email: string; active: boolean }> };
  const match = (data.senders ?? []).find(
    (s) => s.email.toLowerCase() === env.BREVO_FROM_EMAIL!.toLowerCase(),
  );
  if (!match) {
    return {
      configured: true,
      ok: false,
      detail: `${env.BREVO_FROM_EMAIL} is not on Brevo's verified-senders list — add it at app.brevo.com/senders`,
    };
  }
  if (!match.active) {
    return {
      configured: true,
      ok: false,
      detail: `${env.BREVO_FROM_EMAIL} is on the list but not yet activated — check the confirmation email`,
    };
  }
  return {
    configured: true,
    ok: true,
    detail: `Brevo reachable; sender ${env.BREVO_FROM_EMAIL} is verified + active`,
  };
}

async function probeTwilio(env: NonNullable<App.Locals['runtime']>['env']): Promise<ProviderReport> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    return { configured: false, ok: false, detail: 'TWILIO_ACCOUNT_SID/_AUTH_TOKEN/_FROM_NUMBER not set' };
  }
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  let resp: Response;
  try {
    resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`,
      { headers: { authorization: `Basic ${auth}` } },
    );
  } catch (err) {
    return { configured: true, ok: false, detail: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 200);
    return { configured: true, ok: false, detail: `Twilio /Accounts ${resp.status}: ${body}` };
  }
  const data = (await resp.json()) as { status?: string; type?: string };
  return {
    configured: true,
    ok: true,
    detail: `Twilio account status=${data.status ?? '?'} type=${data.type ?? '?'}; from=${env.TWILIO_FROM_NUMBER}`,
  };
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
