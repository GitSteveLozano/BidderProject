/**
 * POST /api/composition/draft
 *
 * Body: { quote_id, kind, scope_summary?, ...overrides }
 *
 * Composition agent generates a voice-matched draft. Persists a
 * composition_drafts row with auto-incremented revision. Returns the
 * generated text + the chunks used.
 */
import type { APIRoute } from 'astro';

import { compose, saveDraft, type DraftKind } from '@/lib/composition-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const VALID_KINDS: DraftKind[] = [
  'cover_note',
  'scope_narrative',
  'exclusions',
  'terms',
  'closing',
  'full_proposal',
];

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: {
    quote_id?: string;
    kind?: string;
    scope_summary?: string;
    client_name?: string;
    contact_name?: string;
    project_title?: string;
    line_items?: Array<{ description: string; qty: number; unit?: string; subtotal: number }>;
    total?: number;
    classification?: string;
    offer_rationale?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!VALID_KINDS.includes(body.kind as DraftKind)) {
    return json({ error: 'kind must be one of: ' + VALID_KINDS.join(', ') }, 400);
  }
  const kind = body.kind as DraftKind;

  const svc = supabaseService(env, 'service');

  // Two modes:
  //   (a) post-save: caller passes quote_id, we pull everything from the DB
  //       and persist the draft to composition_drafts with revision tracking.
  //   (b) pre-save (Review step in the wizard): caller passes the
  //       quote fields inline. We compose but don't persist — no parent
  //       quote row exists yet.
  let scope = body.scope_summary ?? '';
  let clientName = body.client_name ?? '';
  let contactName = body.contact_name ?? '';
  let projectTitle = body.project_title ?? '';
  let items = body.line_items;
  let total = body.total ?? 0;

  if (body.quote_id) {
    const { data: q } = await svc
      .from('quotes')
      .select('client_name, client_contact_name, project_title, scope_summary, total')
      .eq('id', body.quote_id)
      .eq('shop_id', locals.membership.shop_id)
      .maybeSingle();
    if (!q) return json({ error: 'quote not found' }, 404);
    scope = scope || q.scope_summary || '';
    clientName = clientName || q.client_name || '';
    contactName = contactName || q.client_contact_name || '';
    projectTitle = projectTitle || q.project_title || '';
    total = total || Number(q.total ?? 0);
    if (!items) {
      const { data: li } = await svc
        .from('quote_line_items')
        .select('description, qty, unit, subtotal')
        .eq('quote_id', body.quote_id);
      items = (li ?? []).map((r) => ({
        description: r.description,
        qty: Number(r.qty),
        unit: r.unit ?? 'lump_sum',
        subtotal: Number(r.subtotal ?? 0),
      }));
    }
  } else if (!projectTitle || !clientName) {
    return json({ error: 'either quote_id or (client_name + project_title) required' }, 400);
  }

  const draft = await compose(env, svc, {
    shop_id: locals.membership.shop_id,
    quote_id: body.quote_id ?? '00000000-0000-0000-0000-000000000000',
    kind,
    scope_summary: scope,
    client_name: clientName,
    contact_first_name: contactName.split(' ')[0],
    project_title: projectTitle,
    line_items: items?.map((r) => ({
      description: r.description,
      qty: r.qty,
      unit: r.unit ?? 'lump_sum',
      subtotal: r.subtotal,
    })),
    total,
    offer_rationale: body.offer_rationale,
    classification: body.classification,
  });

  let saved: { id: string; revision: number } | null = null;
  if (body.quote_id) {
    saved = await saveDraft(svc, locals.membership.shop_id, body.quote_id, draft, {
      requested_by: locals.user.id ?? null,
    });
  }

  return json({ ...draft, saved }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
