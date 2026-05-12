/**
 * POST /api/quote/save
 *
 * Persist a quote (creates if no id, updates if id). Auto-creates a
 * client row if none matches the client_name. Replaces all line items
 * in the same transaction.
 *
 * State machine: DRAFT only via save. Use /api/quote/send to transition
 * to SENT.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface SaveBody {
  id?: string;
  ref?: string;
  client_id?: string;
  client_name: string;
  client_contact_name?: string | null;
  project_title: string;
  project_address?: string | null;
  scope_summary?: string | null;
  source?: 'upload' | 'voice' | 'manual' | 'site_visit';
  total: number;
  margin_pct?: number | null;
  line_items: Array<{
    position?: number;
    description: string;
    qty: number;
    unit?: string;
    unit_price: number;
    subtotal: number;
    category?: string;
    confidence?: string;
    source_excerpt?: string;
  }>;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: SaveBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.client_name || !body.project_title) {
    return json({ error: 'client_name + project_title required' }, 400);
  }

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  // Resolve client_id (create if missing)
  let clientId = body.client_id;
  if (!clientId) {
    const { data: existing } = await svc
      .from('clients')
      .select('id')
      .eq('shop_id', shopId)
      .ilike('name', body.client_name)
      .maybeSingle();
    if (existing) {
      clientId = existing.id;
    } else {
      const { data: created, error: cErr } = await svc
        .from('clients')
        .insert({
          shop_id: shopId,
          name: body.client_name,
          primary_contact_name: body.client_contact_name ?? null,
        })
        .select('id')
        .single();
      if (cErr || !created) return json({ error: cErr?.message ?? 'client create failed' }, 500);
      clientId = created.id;
    }
  }

  // Ref: if not provided, derive one (Q-YYYY-NNNN by per-shop year sequence)
  let ref = body.ref;
  if (!ref) {
    const year = new Date().getUTCFullYear();
    const { count } = await svc
      .from('quotes')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .gte('created_at', `${year}-01-01T00:00:00Z`);
    const n = (count ?? 0) + 1;
    ref = `Q-${year}-${String(n).padStart(4, '0')}`;
  }

  const quoteRow = {
    shop_id: shopId,
    client_id: clientId,
    client_name: body.client_name,
    client_contact_name: body.client_contact_name ?? null,
    project_title: body.project_title,
    project_address: body.project_address ?? null,
    scope_summary: body.scope_summary ?? null,
    source: body.source ?? 'manual',
    total: body.total,
    margin_pct: body.margin_pct ?? null,
    state: 'DRAFT' as const,
    ref,
  };

  let quoteId: string;
  if (body.id) {
    const { data, error } = await svc
      .from('quotes')
      .update(quoteRow)
      .eq('id', body.id)
      .eq('shop_id', shopId)
      .select('id')
      .single();
    if (error) return json({ error: error.message }, 500);
    quoteId = data.id;
    await svc.from('quote_line_items').delete().eq('quote_id', quoteId);
  } else {
    const { data, error } = await svc
      .from('quotes')
      .insert(quoteRow)
      .select('id')
      .single();
    if (error) return json({ error: error.message }, 500);
    quoteId = data.id;
  }

  if (body.line_items.length) {
    const rows = body.line_items.map((li, idx) => ({
      quote_id: quoteId,
      position: li.position ?? idx + 1,
      description: li.description,
      qty: li.qty,
      unit: li.unit ?? null,
      unit_price: li.unit_price,
      subtotal: li.subtotal,
      category: li.category ?? null,
      confidence: li.confidence ?? null,
      source_excerpt: li.source_excerpt ?? null,
    }));
    const { error: liErr } = await svc.from('quote_line_items').insert(rows);
    if (liErr) return json({ error: liErr.message }, 500);
  }

  return json({ id: quoteId, ref }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
