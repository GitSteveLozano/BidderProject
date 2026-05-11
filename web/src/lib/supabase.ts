/**
 * Supabase client + read helpers.
 *
 * Public reads (companies list, service lines, recent bids) use the
 * anon key from server-rendered pages — Postgres RLS should permit
 * those rows. Writes go through the service-role key inside a
 * Cloudflare Function (never expose service_role to the client).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface CloudflareEnv {
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_KEY?: string;
  DEFAULT_MODEL_HAIKU?: string;
  DEFAULT_MODEL_SONNET?: string;
}

export function client(env: CloudflareEnv | undefined, role: 'anon' | 'service' = 'anon'): SupabaseClient {
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
    const sb = client(env, 'anon');
    const { data, error } = await sb
      .from('companies')
      .select('id, name, segment, onboarded_at')
      .order('name');
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    // During build (no env yet) or when Supabase isn't configured,
    // return a fallback so the page still renders.
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
    const sb = client(env, 'anon');
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
