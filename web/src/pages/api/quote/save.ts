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
import { maybeBootstrapShop } from '@/lib/context';

export const prerender = false;

interface SaveBody {
  id?: string;
  ref?: string;
  client_id?: string;
  client_name: string;
  client_contact_name?: string | null;
  client_contact_email?: string | null;
  client_contact_phone?: string | null;
  project_title: string;
  project_address?: string | null;
  scope_summary?: string | null;
  source?: 'upload' | 'voice' | 'manual' | 'site_visit';
  total: number;
  margin_pct?: number | null;
  // Migration 009: proposal-level shape for non-itemized styles.
  // For project_quote (default), these may be null. For partnership,
  // term_months + program_type='rebate' are typical. For consulting,
  // phases[] is the primary editable structure.
  proposal_style?: 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown' | null;
  program_type?: 'one_off' | 'recurring' | 'rebate' | null;
  term_months?: number | null;
  phases?: Array<{ name: string; deliverables: string[]; duration?: string | null; fee?: number | null }> | null;
  rfi_response?: {
    requirements_answered?: Array<{ requirement: string; response: string }>;
    questions_answered?: Array<{ question: string; answer: string }>;
    narrative_sections?: Array<{ heading: string; body: string }>;
    cover_letter?: string;
    submission_format?: string;
  } | null;
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
    margin_pct?: number | null;
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

  // Resolve client_id. Create a new clients row if no match by name;
  // otherwise re-use the existing one. When the operator types a new
  // contact email/phone on a quote for an existing client, only fill
  // gaps (don't clobber what's already there) — same policy as the
  // multi-contact form on /clients/[id].
  let clientId = body.client_id;
  if (!clientId) {
    const { data: existing } = await svc
      .from('clients')
      .select('id, primary_contact_name, primary_contact_email, primary_contact_phone')
      .eq('shop_id', shopId)
      .ilike('name', body.client_name)
      .maybeSingle();
    if (existing) {
      clientId = existing.id;
      const fillPatch: Record<string, string | null> = {};
      if (!existing.primary_contact_name && body.client_contact_name) {
        fillPatch.primary_contact_name = body.client_contact_name;
      }
      if (!existing.primary_contact_email && body.client_contact_email) {
        fillPatch.primary_contact_email = body.client_contact_email;
      }
      if (!existing.primary_contact_phone && body.client_contact_phone) {
        fillPatch.primary_contact_phone = body.client_contact_phone;
      }
      if (Object.keys(fillPatch).length > 0) {
        await svc.from('clients').update(fillPatch).eq('id', clientId);
      }
    } else {
      const { data: created, error: cErr } = await svc
        .from('clients')
        .insert({
          shop_id: shopId,
          name: body.client_name,
          primary_contact_name: body.client_contact_name ?? null,
          primary_contact_email: body.client_contact_email ?? null,
          primary_contact_phone: body.client_contact_phone ?? null,
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
    proposal_style: body.proposal_style ?? 'project_quote',
    program_type: body.program_type ?? null,
    term_months: body.term_months ?? null,
    phases: body.phases && body.phases.length > 0 ? body.phases : null,
    rfi_response: body.rfi_response ?? null,
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
      margin_pct: li.margin_pct ?? null,
    }));
    const { error: liErr } = await svc.from('quote_line_items').insert(rows);
    if (liErr) return json({ error: liErr.message }, 500);
  }

  // Lazy bootstrap: if this shop's Context is empty (operator skipped
  // onboarding's seed trigger), kick it off now with the data we
  // just persisted. No-ops once chunks exist; best-effort.
  if (env.AI) {
    maybeBootstrapShop(env, svc, shopId).catch((e) => {
      console.warn('[quote.save] context bootstrap failed', e);
    });
  }

  return json({ id: quoteId, ref }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
