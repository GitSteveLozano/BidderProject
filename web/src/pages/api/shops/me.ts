/**
 * GET /api/shops/me   — return the current user's shop.
 * PATCH /api/shops/me — update fields the user is allowed to set.
 *
 * Auth required. Owner/admin can edit; members can read-only.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { seedFromShop } from '@/lib/context';

export const prerender = false;

const EDITABLE: ReadonlyArray<string> = [
  'legal_name',
  'trade_name',
  'owner_name',
  'business_noun',
  'license_number',
  'license_jurisdiction',
  'license_classification',
  'license_expires_at',
  'default_markup_pct',
  'default_labor_rate',
  'default_overhead_pct',
  'default_margin_range_low',
  'default_margin_range_high',
  'google_calendar_connected',
  'google_calendar_scope',
  'voice_sample_url',
  'voice_profile',
  'onboarding_completed_at',
];

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const svc = supabaseService(env, 'service');
  const { data, error } = await svc
    .from('shops')
    .select('*')
    .eq('id', locals.membership.shop_id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Shop not found' }, 404);
  return json(data, 200);
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') {
    return json({ error: 'Members cannot edit shop' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable fields in body' }, 400);
  }

  const svc = supabaseService(env, 'service');

  // Detect first-time onboarding completion — pre-patch row's
  // onboarding_completed_at is null but the patch sets it. Used below
  // to kick off the Context seed in the background.
  const settingOnboardingComplete =
    'onboarding_completed_at' in patch && patch.onboarding_completed_at != null;
  let wasOnboardingNull = false;
  if (settingOnboardingComplete) {
    const { data: prior } = await svc
      .from('shops')
      .select('onboarding_completed_at')
      .eq('id', locals.membership.shop_id)
      .maybeSingle();
    wasOnboardingNull = !prior?.onboarding_completed_at;
  }

  const { data, error } = await svc
    .from('shops')
    .update(patch)
    .eq('id', locals.membership.shop_id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  // Fire-and-forget: seed Context from the data we now have. The seed
  // is idempotent (upserts) so this is safe even if it races with a
  // later manual call.
  if (env.AI && wasOnboardingNull) {
    seedFromShop(env, svc, locals.membership.shop_id).catch((e) => {
      console.warn('[shops.me] background seed failed', e);
    });
  }

  return json(data, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
