/**
 * Astro middleware — runs on every server-rendered request.
 *
 * Responsibilities:
 *   1. Resolve the current Supabase session from the cookie and stamp
 *      user + membership on Astro.locals so SSR pages can read them.
 *   2. Redirect unauthenticated requests to /auth/signin for protected
 *      routes. Public routes (landing, /auth/*, /api/health) stay open.
 *   3. Stamp cache-control: no-store on every dynamic response so we
 *      don't leak personalized data through edge cache.
 *
 * Previously a middleware was reverted (`9efe16d`) for cloning the
 * Response in a way that broke SSR pages. This version does NOT touch
 * the body — only adds headers — which avoids the frozen-headers
 * issue that broke things last time.
 */
import { defineMiddleware } from 'astro:middleware';

import { getCurrentSession } from '@/lib/auth';

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/auth/signin',
  '/auth/callback',
  '/auth/signout',
  '/api/health',
  '/favicon.svg',
  '/404',
]);

const PUBLIC_PREFIXES = ['/_astro/', '/_image'];

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const env = context.locals.runtime?.env;

  // Resolve session early so pages can use it without re-reading the cookie.
  if (env) {
    try {
      const { user, membership } = await getCurrentSession(
        env,
        context.request.headers.get('cookie'),
      );
      context.locals.user = user;
      context.locals.membership = membership;
    } catch {
      context.locals.user = null;
      context.locals.membership = null;
    }
  }

  // Auth gate for protected paths. Diag probes (?diag=1) bypass auth on
  // any path so the SSR-regression tripwire stays reachable without a
  // session — this is the same probe that caught the [object Object]
  // failure mode (commit 1761de3). Public list covers landing + auth.
  const isPublic =
    PUBLIC_PATHS.has(url.pathname) ||
    PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
    url.searchParams.get('diag') === '1';

  if (!isPublic && !context.locals.user) {
    const next_url = url.pathname + url.search;
    return context.redirect(`/auth/signin?next=${encodeURIComponent(next_url)}`);
  }

  const response = await next();

  // Only stamp cache headers on dynamic responses. Static assets keep
  // their own cache headers. Per-route SSR pages already set these but
  // belt-and-suspenders.
  if (url.pathname.startsWith('/api/') || !PUBLIC_PATHS.has(url.pathname)) {
    if (!response.headers.has('cache-control')) {
      response.headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
      response.headers.set('cdn-cache-control', 'no-store');
    }
  }

  return response;
});
