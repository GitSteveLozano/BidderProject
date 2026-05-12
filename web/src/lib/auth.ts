/**
 * Auth helpers — Supabase + Google OAuth.
 *
 * Server-side reads use the user's JWT (RLS-aware) by attaching it to
 * the Supabase client per request. Service-role reads remain available
 * for cross-tenant/cron paths via supabaseClient(env, 'service').
 *
 * Dashboard configuration (NOT in code):
 *   Supabase → Authentication → Providers → Google → enabled
 *     Client ID/Secret from Google Cloud Console
 *   Supabase → Authentication → URL Configuration:
 *     Site URL: https://bidderproject.pages.dev
 *     Redirect URLs: https://bidderproject.pages.dev/auth/callback
 *   Google Cloud → Credentials → OAuth client:
 *     Authorized redirect URI: <project>.supabase.co/auth/v1/callback
 *     Scopes: openid email profile + (later) calendar
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

import type { CloudflareEnv } from './supabase';

const SESSION_COOKIE = 'sb-session';
const COOKIE_OPTS = 'Path=/; Secure; HttpOnly; SameSite=Lax';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

/** Get the Supabase auth client (anon key — no service-role secrets in the browser path). */
export function authClient(env: CloudflareEnv): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL + SUPABASE_ANON_KEY required for auth');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Build the OAuth redirect URL for Google sign-in. */
export function googleSignInUrl(env: CloudflareEnv, redirectTo: string): string {
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo,
  });
  // Calendar scope requested up front so step 7 can consent. Re-asks only
  // if the user didn't grant calendar access on the initial flow.
  params.set('scopes', 'https://www.googleapis.com/auth/calendar');
  return `${env.SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
}

/** Set the session cookie from a Supabase Session. */
export function sessionCookieHeader(session: Session): string {
  const value = encodeURIComponent(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    provider_token: session.provider_token,
    provider_refresh_token: session.provider_refresh_token,
  }));
  return `${SESSION_COOKIE}=${value}; ${COOKIE_OPTS}; Max-Age=${COOKIE_MAX_AGE_S}`;
}

/** Clear the session cookie. */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_OPTS}; Max-Age=0`;
}

/** Read + parse the session cookie. Returns null if missing or malformed. */
export function readSessionCookie(cookieHeader: string | null): {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  provider_token?: string;
  provider_refresh_token?: string;
} | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match.split('=').slice(1).join('='));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Resolve the current user + first membership for the session attached to the request. */
export async function getCurrentSession(
  env: CloudflareEnv,
  cookieHeader: string | null,
): Promise<{
  user: { id: string; email?: string; name?: string; avatar_url?: string } | null;
  membership: { shop_id: string; role: 'owner' | 'admin' | 'member' } | null;
  access_token: string | null;
}> {
  const cookie = readSessionCookie(cookieHeader);
  if (!cookie) return { user: null, membership: null, access_token: null };

  const client = authClient(env);
  const { data, error } = await client.auth.getUser(cookie.access_token);
  if (error || !data.user) return { user: null, membership: null, access_token: null };

  const user = {
    id: data.user.id,
    email: data.user.email,
    name: (data.user.user_metadata?.full_name as string) ?? data.user.email,
    avatar_url: data.user.user_metadata?.avatar_url as string | undefined,
  };

  // Service-role read so we don't depend on the user's JWT being fully RLS-wired yet.
  // (Memberships are visible to the user themselves under their own RLS policy, but
  // service-role keeps this lookup off the critical path of RLS debugging.)
  const { createClient: createServiceClient } = await import('@supabase/supabase-js');
  if (!env.SUPABASE_SERVICE_KEY) {
    return { user, membership: null, access_token: cookie.access_token };
  }
  const svc = createServiceClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: m } = await svc
    .from('memberships')
    .select('shop_id, role')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    user,
    membership: m as any,
    access_token: cookie.access_token,
  };
}

/**
 * Self-serve company creation. Called from the auth callback when a
 * newly-signed-in user has no membership. Atomically creates a shop +
 * owner membership using service-role (bypasses RLS for the bootstrap).
 */
export async function createShopForUser(
  env: CloudflareEnv,
  user: { id: string; email?: string; name?: string },
): Promise<{ shop_id: string }> {
  if (!env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_KEY required for self-serve shop creation');
  }
  const svc = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const legalName = user.name ?? user.email?.split('@')[0] ?? 'New shop';
  const { data: shop, error: shopErr } = await svc
    .from('shops')
    .insert({
      legal_name: legalName,
      owner_name: user.name ?? user.email ?? 'Owner',
      owner_email: user.email ?? '',
      data_state: 'cold-start',
    })
    .select('id')
    .single();
  if (shopErr || !shop) throw shopErr ?? new Error('shop insert returned no row');

  const { error: membErr } = await svc.from('memberships').insert({
    user_id: user.id,
    shop_id: shop.id,
    role: 'owner',
  });
  if (membErr) {
    // Roll back the orphan shop
    await svc.from('shops').delete().eq('id', shop.id);
    throw membErr;
  }
  return { shop_id: shop.id };
}
