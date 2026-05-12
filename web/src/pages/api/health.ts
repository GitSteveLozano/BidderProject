/**
 * GET /api/health
 *
 * Diagnostic endpoint — surfaces runtime state without leaking secrets.
 * Reports:
 *   - env var presence (set / missing)
 *   - which Supabase project is being hit (the URL's project ref)
 *   - reachability + shops_count
 *   - which Brief tables exist
 *   - first 3 shop rows (for cross-checking which DB you're pointed at)
 *   - nodejs_compat status
 *
 * Kept as a permanent regression probe — the cf-cache-status / shape of
 * this response is referenced from incident postmortems. Don't break it.
 */

import type { APIRoute } from 'astro';

import { client as supabaseClient } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env ?? ({} as Record<string, string | undefined>);

  const envStatus = {
    AI_binding: env.AI ? 'bound' : 'missing',
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
    shops_count?: number;
    tables_seen?: string[];
    shop_samples?: Array<{ id: string; legal_name: string; data_state: string }>;
    error?: string;
  } = { ok: false, project_ref: projectRef };

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const sb = supabaseClient(env, 'service');

      const { count, error: countErr } = await sb
        .from('shops')
        .select('*', { count: 'exact', head: true });
      if (countErr) {
        supabase.error = `shops count: ${countErr.message} (code=${countErr.code})`;
      } else {
        supabase.shops_count = count ?? 0;
      }

      // Sample first 3 shops so you can cross-check against the Supabase
      // Table Editor — confirms which project is actually being hit.
      const { data: shops } = await sb
        .from('shops')
        .select('id, legal_name, data_state')
        .order('legal_name')
        .limit(3);
      supabase.shop_samples = shops ?? [];

      // Probe the Brief tables. PostgREST doesn't expose information_schema
      // by default, so we hit each table with a head-only count to see
      // what responds.
      const expectedTables = [
        'shops', 'memberships', 'invites',
        'clients', 'quotes', 'quote_line_items', 'quote_messages',
        'jobs', 'job_cost_lines', 'events',
      ];
      const seen: string[] = [];
      await Promise.all(
        expectedTables.map(async (t) => {
          const { error } = await sb.from(t).select('*', { count: 'exact', head: true });
          if (!error) seen.push(t);
        }),
      );
      supabase.tables_seen = seen;
      supabase.ok = countErr == null && supabase.shops_count != null;
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
    envStatus.AI_binding === 'bound' &&
    supabase.ok &&
    (supabase.shops_count ?? 0) > 0 &&
    nodeCompat === 'yes';

  return new Response(
    JSON.stringify(
      { ok, env: envStatus, supabase, runtime: { node_compat: nodeCompat } },
      null,
      2,
    ),
    {
      status: ok ? 200 : 503,
      headers: {
        'content-type': 'application/json',
        // Diagnostic endpoint — never serve from edge cache or
        // browser cache. Cloudflare aggressively caches successful
        // JSON responses by default, which has masked debugging in
        // the past.
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        'cdn-cache-control': 'no-store',
      },
    },
  );
};
