/**
 * GET    /api/client/:id/contacts — list contacts for a client
 * POST   /api/client/:id/contacts — create a new contact
 *
 * PATCH/DELETE for individual contacts live in
 * /api/client/[id]/contacts/[contact_id].ts.
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface NewContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  is_primary?: boolean;
  always_notify?: boolean;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  const svc = supabaseService(env, 'service');
  const { data, error } = await svc
    .from('client_contacts')
    .select('*, clients!inner(id, shop_id)')
    .eq('client_id', id)
    .eq('clients.shop_id', locals.membership.shop_id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) return json({ error: error.message }, 500);
  return json(data ?? [], 200);
};

export const POST: APIRoute = async ({ request, params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (locals.membership.role === 'member') return json({ error: 'Members cannot edit clients' }, 403);
  const id = params.id;
  if (!id) return json({ error: 'id required' }, 400);

  let body: NewContact;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.name && !body.email && !body.phone) {
    return json({ error: 'At least one of name / email / phone required' }, 400);
  }

  const svc = supabaseService(env, 'service');
  // Verify the parent client belongs to this shop.
  const { data: client } = await svc
    .from('clients')
    .select('id')
    .eq('id', id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!client) return json({ error: 'Client not found' }, 404);

  // If is_primary is being set, demote any existing primary for this
  // client so the invariant "≤ 1 primary" holds.
  if (body.is_primary) {
    await svc
      .from('client_contacts')
      .update({ is_primary: false })
      .eq('client_id', id)
      .eq('is_primary', true);
  }

  const { data, error } = await svc
    .from('client_contacts')
    .insert({
      client_id: id,
      name: body.name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      title: body.title ?? null,
      is_primary: !!body.is_primary,
      always_notify: body.always_notify ?? true,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  return json(data, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
