/**
 * Supabase client + read helpers.
 *
 * All server-rendered reads use the **service_role** key. The Astro
 * Cloudflare worker runs server-side only; the service_role key never
 * crosses to the browser. This bypasses Postgres RLS, which matters
 * because the bidintel schema (db/schema.sql) doesn't ship RLS
 * policies — locking down by tenant happens at the application layer.
 *
 * The remaining `'anon'` role is kept for parity / forward
 * compatibility with a future Supabase Auth integration where browser
 * code holds an anon-signed JWT.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface CloudflareEnv {
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_KEY?: string;
  DEFAULT_MODEL_HAIKU?: string;
  DEFAULT_MODEL_SONNET?: string;
  // Default Workers AI model for drafting endpoints. Override to pick
  // a different model — e.g. `@cf/meta/llama-4-scout-17b-16e-instruct`
  // — without code changes.
  DEFAULT_WORKERS_AI_MODEL?: string;
  // Cloudflare Workers AI binding — used by /api/intake/transcribe
  // and /api/intake/extract-pdf. Bound in the Pages dashboard.
  AI?: {
    run: (model: string, input: unknown) => Promise<unknown>;
  };
  // Outbound delivery — Brevo (email) + Twilio (SMS). Optional;
  // endpoints fall back to "record intent only" when these aren't set.
  BREVO_API_KEY?: string;
  BREVO_FROM_EMAIL?: string;          // e.g. "you@gmail.com" (verified sender)
  BREVO_FROM_NAME?: string;           // e.g. "Brief"
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;        // e.g. "+18085551234"
  // Shared secret for the future inbound-email webhook path. When an
  // automated parser (Brevo, CF Email Routing) POSTs to
  // /api/inbound/email it passes this in `x-brief-webhook-secret`.
  INBOUND_WEBHOOK_SECRET?: string;
  // Shared secret for the scheduled-send cron worker. The external
  // cron (cron-job.org or CF Cron Triggers) hits /api/cron/* with
  // this in `x-brief-cron-secret`.
  CRON_SECRET?: string;
}

export function client(
  env: CloudflareEnv | undefined,
  role: 'anon' | 'service' = 'service',
): SupabaseClient {
  const url = env?.SUPABASE_URL;
  const key = role === 'service' ? env?.SUPABASE_SERVICE_KEY : env?.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      `Supabase credentials missing (role=${role}). Set SUPABASE_URL + ` +
        `SUPABASE_${role.toUpperCase()}_KEY in Cloudflare environment.`,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// ─── Reads ────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  segment: string;
  onboarded_at: string | null;
}

export async function getCompanies(env?: CloudflareEnv): Promise<Company[]> {
  try {
    const sb = client(env, 'service');
    const { data, error } = await sb
      .from('companies')
      .select('id, name, segment, onboarded_at')
      .order('name');
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.warn('getCompanies failed; returning fallback', e);
    return [
      { id: '00000000-0000-0000-0000-000000000001', name: 'Honolulu Stucco & Exteriors LLC (demo)', segment: 'repeat_customer', onboarded_at: null },
    ];
  }
}

export interface ServiceLine {
  line_name: string;
  standard_exclusions: string[];
  typical_margin_pct: number | null;
}

export async function getServiceLines(
  companyId: string,
  env?: CloudflareEnv,
): Promise<ServiceLine[]> {
  try {
    const sb = client(env, 'service');
    const { data, error } = await sb
      .from('service_lines')
      .select('line_name, standard_exclusions, typical_margin_pct')
      .eq('company_id', companyId)
      .order('line_name');
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.warn('getServiceLines failed; returning fallback', e);
    return [
      { line_name: 'EIFS', standard_exclusions: [], typical_margin_pct: 30 },
      { line_name: 'STUCCO-CONVENTIONAL', standard_exclusions: [], typical_margin_pct: 32 },
    ];
  }
}
