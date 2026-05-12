/**
 * POST /api/auth/exchange
 *
 * Receives Supabase OAuth tokens from the /auth/callback bootstrap
 * script. Sets HttpOnly session cookie. Self-serves a shop +
 * owner membership if the user has none yet, then redirects to
 * /onboarding (cold-start) or the user's intended `next` URL.
 */
import type { APIRoute } from 'astro';

import {
  authClient,
  createShopForUser,
  sessionCookieHeader,
} from '@/lib/auth';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });

  let body: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    provider_token?: string;
    provider_refresh_token?: string;
    next?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.access_token || !body.refresh_token) {
    return new Response('Missing tokens', { status: 400 });
  }

  // Validate token + extract user identity
  const client = authClient(env);
  const { data, error } = await client.auth.getUser(body.access_token);
  if (error || !data.user) {
    return new Response(error?.message ?? 'Token rejected', { status: 401 });
  }
  const user = {
    id: data.user.id,
    email: data.user.email,
    name: (data.user.user_metadata?.full_name as string) ?? data.user.email,
  };

  // Check if the user already has a membership
  const svc = supabaseService(env, 'service');
  const { data: existing } = await svc
    .from('memberships')
    .select('shop_id')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let shopId: string;
  let needsOnboarding = false;
  if (existing) {
    shopId = existing.shop_id;
    // Check onboarding state
    const { data: shop } = await svc
      .from('shops')
      .select('onboarding_completed_at')
      .eq('id', shopId)
      .maybeSingle();
    needsOnboarding = !shop?.onboarding_completed_at;
  } else {
    const created = await createShopForUser(env, user);
    shopId = created.shop_id;
    needsOnboarding = true;
  }

  // Persist provider tokens on the shop so future Calendar calls have
  // a refresh_token to use. Only update if we got one.
  if (body.provider_refresh_token) {
    await svc
      .from('shops')
      .update({
        google_refresh_token_encrypted: body.provider_refresh_token, // TODO: encrypt at rest
        google_calendar_connected: true,
        google_calendar_scope: 'read',
      })
      .eq('id', shopId);
  }

  const cookie = sessionCookieHeader({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
    provider_token: body.provider_token,
    provider_refresh_token: body.provider_refresh_token,
  } as any);

  const redirect = needsOnboarding ? '/onboarding' : (body.next || '/dashboard');

  return new Response(JSON.stringify({ redirect }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': cookie,
      'cache-control': 'no-store',
    },
  });
};
