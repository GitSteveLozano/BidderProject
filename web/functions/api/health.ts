/**
 * GET /api/health
 *
 * Surfaces the runtime state of the deployed Function so we can debug
 * misconfiguration without guessing. Returns:
 *
 *   {
 *     ok: boolean,                  // true iff env + Supabase are both healthy
 *     env: {
 *       ANTHROPIC_API_KEY:  "set" | "missing",
 *       SUPABASE_URL:       "set" | "missing",
 *       SUPABASE_ANON_KEY:  "set" | "missing",
 *       SUPABASE_SERVICE_KEY: "set" | "missing",
 *     },
 *     supabase: { ok, companies_count, error },
 *     runtime: { node_compat: "yes" | "no" },
 *   }
 *
 * No secrets are leaked — we only report presence, never values.
 */

import { client as supabaseClient, type CloudflareEnv } from '../../src/lib/supabase';

export const onRequestGet: PagesFunction<CloudflareEnv> = async (ctx) => {
  const env = ctx.env;

  const envStatus = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? 'set' : 'missing',
    SUPABASE_URL: env.SUPABASE_URL ? 'set' : 'missing',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ? 'set' : 'missing',
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY ? 'set' : 'missing',
  };

  // Probe nodejs_compat: importing `node:buffer` only works when the
  // compat flag is set. We caught the import error if it throws.
  let nodeCompat: 'yes' | 'no' | 'unknown' = 'unknown';
  try {
    await import('node:buffer');
    nodeCompat = 'yes';
  } catch {
    nodeCompat = 'no';
  }

  // Probe Supabase. Count companies — the cheapest possible query.
  let supabase: { ok: boolean; companies_count?: number; error?: string } = {
    ok: false,
  };
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    try {
      const sb = supabaseClient(env, 'anon');
      const { count, error } = await sb
        .from('companies')
        .select('*', { count: 'exact', head: true });
      if (error) {
        supabase = { ok: false, error: error.message };
      } else {
        supabase = { ok: true, companies_count: count ?? 0 };
      }
    } catch (e) {
      supabase = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    supabase = { ok: false, error: 'env vars not set' };
  }

  const ok =
    envStatus.SUPABASE_URL === 'set' &&
    envStatus.SUPABASE_ANON_KEY === 'set' &&
    envStatus.SUPABASE_SERVICE_KEY === 'set' &&
    envStatus.ANTHROPIC_API_KEY === 'set' &&
    supabase.ok &&
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
