/**
 * POST /api/onboarding/public-lookup
 *
 * Best-effort fetch-and-extract for what we can learn about a shop
 * from public sources: their website (og-tags + JSON-LD Organization
 * + footer license/address patterns) and per-state contractor-license
 * boards (CSLB, Hawaii DCCA today).
 *
 * No API keys required. The endpoint returns whatever it found,
 * empty array if nothing matched. The UI lets the operator review +
 * accept before any of it is written to shops.
 */
import type { APIRoute } from 'astro';
import { publicRecordLookup } from '@/lib/public-record';

export const prerender = false;

interface Body {
  business_name?: string;
  state?: string;
  website_url?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Not authenticated' }, 401);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.business_name && !body.website_url) {
    return json({ error: 'business_name or website_url required' }, 400);
  }

  const matches = await publicRecordLookup({
    business_name: body.business_name,
    state: body.state,
    website_url: body.website_url,
  });

  return json({ matches }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
