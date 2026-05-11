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
 *
 * Implementation note: Cloudflare's Workers runtime sometimes returns
 * Response objects with frozen headers (e.g. for streamed responses
 * or responses constructed via ReadableStream). Calling `.set()` on
 * a frozen Headers throws "Cannot modify immutable headers", that
 * error propagates out of the worker, and Cloudflare returns a 500
 * with body that browsers render as `[object Object]`. So we
 * construct a fresh Response with cloned headers instead of
 * mutating in place.
 */
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const url = new URL(context.request.url);

  // Skip static assets — Astro doesn't route prerendered pages
  // through middleware in hybrid mode, but be defensive.
  if (url.pathname.startsWith('/_astro/') || url.pathname === '/favicon.svg') {
    return response;
  }

  // Clone-and-replace pattern: new Response() with the existing body +
  // status, then a fresh Headers built from the old one so .set() is
  // guaranteed to be mutable. Cheap — no body copy, just a stream
  // passthrough.
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('cdn-cache-control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
