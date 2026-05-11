/**
 * GET /api/health
 *
 * Diagnostic endpoint — surfaces runtime state without leaking secrets.
 *
 * Lives in src/pages/api/ rather than functions/api/ because Astro's
 * Cloudflare adapter generates a _worker.js that intercepts every
 * route, so standalone Pages Functions in `functions/` never run.
 * Astro API routes get the same env via `locals.runtime.env`.
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

  // Probe nodejs_compat: when the flag is on, the Cloudflare runtime
  // polyfills Node globals like `Buffer` and `process`. When off, both
  // are undefined. Use globalThis access so vite doesn't try to
  // statically resolve `node:buffer` at build time.
  const hasBuffer = typeof (globalThis as any).Buffer !== 'undefined';
  const hasProcess = typeof (globalThis as any).process !== 'undefined';
  const nodeCompat: 'yes' | 'no' = hasBuffer && hasProcess ? 'yes' : 'no';

  // Probe Supabase reachability — cheapest possible query, head-only.
  let supabase: { ok: boolean; companies_count?: number; error?: string };
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    try {
      const sb = supabaseClient(env, 'anon');
      const { count, error } = await sb
        .from('companies')
        .select('*', { count: 'exact', head: true });
      if (error) supabase = { ok: false, error: error.message };
      else supabase = { ok: true, companies_count: count ?? 0 };
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
