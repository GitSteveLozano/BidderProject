/**
 * PATCH /api/client/[id] — limited edits to a client row.
 *
 * Used today only by the notes editor on /clients/[id]. The allow-list
 * stays narrow on purpose; adding more editable fields means lining up
 * the rollups + RLS implications first.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const EDITABLE: ReadonlyArray<string> = [
  'notes',
  'primary_contact_name',
  'primary_contact_email',
  'primary_contact_phone',
  'address_line',
  'city',
  'state_code',
];

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') {
    return json({ error: 'Members cannot edit clients' }, 403);
  }
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

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
  const { data, error } = await svc
    .from('clients')
    .update(patch)
    .eq('id', id)
    .eq('shop_id', locals.membership.shop_id)
    .select('id, notes')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Client not found' }, 404);
  return json(data, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
