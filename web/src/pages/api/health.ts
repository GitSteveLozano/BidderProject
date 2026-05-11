/**
 * GET /api/health
 *
 * Diagnostic endpoint — surfaces runtime state without leaking secrets.
 * Reports:
 *   - env var presence (set / missing)
 *   - which Supabase project is being hit (the URL's project ref)
 *   - reachability + companies_count
 *   - which bidintel tables exist
 *   - first 3 company rows (for cross-checking)
 *   - nodejs_compat status
 */

import type { APIRoute } from 'astro';

import { client as supabaseClient } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env ?? ({} as Record<string, string | undefined>);

  const envStatus = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? 'set' : 'missing',
    SUPABASE_URL: env.SUPABASE_URL ? 'set' : 'missing',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ? 'set' : 'missing',
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY ? 'set' : 'missing',
  };

  // Extract project ref from the URL — so you can sanity-check against
  // your Supabase dashboard URL (https://supabase.com/dashboard/project/<ref>).
  // Reveals just the ref, not the API key.
  const projectRef = env.SUPABASE_URL
    ? new URL(env.SUPABASE_URL).hostname.split('.')[0]
    : null;

  const hasBuffer = typeof (globalThis as any).Buffer !== 'undefined';
  const hasProcess = typeof (globalThis as any).process !== 'undefined';
  const nodeCompat: 'yes' | 'no' = hasBuffer && hasProcess ? 'yes' : 'no';

  const supabase: {
    ok: boolean;
    project_ref?: string | null;
    companies_count?: number;
    tables_seen?: string[];
    company_samples?: Array<{ id: string; name: string }>;
    error?: string;
  } = { ok: false, project_ref: projectRef };

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const sb = supabaseClient(env, 'service');

      const { count, error: countErr } = await sb
        .from('companies')
        .select('*', { count: 'exact', head: true });
      if (countErr) {
        supabase.error = `companies count: ${countErr.message} (code=${countErr.code})`;
      } else {
        supabase.companies_count = count ?? 0;
      }

      // Sample the first 3 companies so you can cross-check against the
      // Supabase Table Editor — confirms which project is actually being hit.
      const { data: companies } = await sb
        .from('companies')
        .select('id, name')
        .order('name')
        .limit(3);
      supabase.company_samples = companies ?? [];

      // List the bidintel tables we expect to find. Using information_schema
      // would be cleaner but PostgREST doesn't expose it by default — we
      // probe each table individually with a head-only count to see what
      // responds.
      const expectedTables = [
        'companies', 'service_lines', 'employees', 'burden_components',
        'bids', 'job_cost_reconciliation', 'voice_patterns', 'pricing_logic',
        'schedule_allocations', 'intelligence_insights',
      ];
      const seen: string[] = [];
      await Promise.all(
        expectedTables.map(async (t) => {
          const { error } = await sb.from(t).select('*', { count: 'exact', head: true });
          if (!error) seen.push(t);
        }),
      );
      supabase.tables_seen = seen;
      supabase.ok =
        countErr == null && supabase.companies_count != null;
    } catch (e) {
      supabase.error = e instanceof Error ? e.message : String(e);
    }
  } else {
    supabase.error = 'env vars not set';
  }

  const ok =
    envStatus.SUPABASE_URL === 'set' &&
    envStatus.SUPABASE_ANON_KEY === 'set' &&
    envStatus.SUPABASE_SERVICE_KEY === 'set' &&
    envStatus.ANTHROPIC_API_KEY === 'set' &&
    supabase.ok &&
    (supabase.companies_count ?? 0) > 0 &&
    nodeCompat === 'yes';

  return new Response(
    JSON.stringify(
      { ok, env: envStatus, supabase, runtime: { node_compat: nodeCompat } },
      null,
      2,
    ),
    {
      status: ok ? 200 : 503,
      headers: { 'content-type': 'application/json' },
    },
  );
};
