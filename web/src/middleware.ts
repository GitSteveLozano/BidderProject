/**
 * Astro middleware — runs on every server-rendered request.
 *
 * Currently does one thing: stamp every dynamic response with
 * cache-control: no-store. The SPA's SSR pages and /api/* routes are
 * personalized (they query Supabase by URL params) and edge-caching
 * them serves stale data to other visitors. Without this,
 * `/bids?company_id=X` for one client's view can leak into another's,
 * and /api/health caches "DB empty" responses long after the DB has
 * been seeded.
 *
 * Static assets (/_astro/*, /favicon.svg) are pre-rendered and not
 * routed through this middleware — they remain cacheable.
 */
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const url = new URL(context.request.url);

  // Skip static assets — Astro doesn't route prerendered pages
  // through middleware, but be defensive anyway.
  if (url.pathname.startsWith('/_astro/')) {
    return response;
  }

  response.headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('cdn-cache-control', 'no-store');
  return response;
});
