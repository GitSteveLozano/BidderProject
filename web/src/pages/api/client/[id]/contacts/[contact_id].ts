/**
 * PATCH  /api/client/:id/contacts/:contact_id — edit a contact
 * DELETE /api/client/:id/contacts/:contact_id — remove a contact
 *
 * Demoting an existing primary while promoting another is handled
 * server-side so the "≤ 1 primary" invariant is preserved without the
 * client juggling two requests.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface PatchBody {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  is_primary?: boolean;
  always_notify?: boolean;
}

async function authedClientContact(svc: any, shopId: string, clientId: string, contactId: string) {
  const { data } = await svc
    .from('client_contacts')
    .select('*, clients!inner(id, shop_id)')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .eq('clients.shop_id', shopId)
    .maybeSingle();
  return data;
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit clients' }, 403);
  const { id, contact_id } = params;
  if (!id || !contact_id) return json({ error: 'id + contact_id required' }, 400);

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const svc = supabaseService(env, 'service');
  const existing = await authedClientContact(svc, locals.membership.shop_id, id, contact_id);
  if (!existing) return json({ error: 'Contact not found' }, 404);

  if (body.is_primary && !existing.is_primary) {
    await svc
      .from('client_contacts')
      .update({ is_primary: false })
      .eq('client_id', id)
      .eq('is_primary', true);
  }

  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'email', 'phone', 'title', 'is_primary', 'always_notify'] as const) {
    if (k in body) patch[k] = (body as any)[k];
  }
  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable fields in body' }, 400);
  }

  const { data, error } = await svc
    .from('client_contacts')
    .update(patch)
    .eq('id', contact_id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  return json(data, 200);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit clients' }, 403);
  const { id, contact_id } = params;
  if (!id || !contact_id) return json({ error: 'id + contact_id required' }, 400);

  const svc = supabaseService(env, 'service');
  const existing = await authedClientContact(svc, locals.membership.shop_id, id, contact_id);
  if (!existing) return json({ error: 'Contact not found' }, 404);

  const { error } = await svc.from('client_contacts').delete().eq('id', contact_id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
