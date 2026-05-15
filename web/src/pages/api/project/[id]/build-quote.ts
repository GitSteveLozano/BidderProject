/**
 * POST /api/project/[id]/build-quote
 *
 * Phase 4 of the multi-doc-intake refactor. Synthesizes a draft quote
 * from everything attached to the project — takeoffs, selections,
 * specs, plans, vendor invoices, scoping threads.
 *
 * The drafted quote lands in DRAFT state with project_id set; the
 * operator opens the editor and refines. Brief never sends without
 * the operator's review.
 *
 * Aggregation rules:
 *   - scope_summary  ← project.description + concatenated doc
 *                      scope_summaries
 *   - line_items     ← all itemized rows from any 'takeoff' or
 *                      'selections_list' doc, deduped by description
 *   - client_hints   ← first non-null hint across all attached docs
 *   - total          ← sum of line item subtotals (operator-editable)
 */
import type { APIRoute } from 'astro';

import { projectCostSummary } from '@/lib/cost-records';
import { getProject, recomputeProjectStatus } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface LineItem {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  category?: string | null;
  confidence?: string | null;
  source_excerpt?: string | null;
}

export const POST: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!params.id) return json({ error: 'id required' }, 400);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  const project = await getProject(svc, shopId, params.id);
  if (!project) return json({ error: 'Project not found' }, 404);

  // Pull all attached docs. We need extracted blobs to mine line items
  // and scope summaries.
  const { data: docs } = await svc
    .from('intake_documents')
    .select('id, classification, direction, source_filename, extracted')
    .eq('project_id', project.id)
    .eq('shop_id', shopId);

  const attached = docs ?? [];
  if (attached.length === 0) {
    return json({ error: 'No documents attached — drop files first.' }, 400);
  }

  // First non-null client hint wins.
  const firstHint = <K extends string>(key: K): string | null => {
    for (const d of attached) {
      const v = (d.extracted?.client_hints as any)?.[key];
      if (v) return v as string;
    }
    return null;
  };

  const clientName =
    firstHint('client_name') || 'Unnamed client';
  const projectTitle =
    firstHint('project_title') || project.name;
  const projectAddress =
    firstHint('project_address') || project.address;
  const clientContactName = firstHint('contact_name');
  const clientContactEmail = firstHint('contact_email');
  const clientContactPhone = firstHint('contact_phone');

  // Synthesize scope: project.description (if set) plus each doc's
  // scope_summary, prefixed with classification so the editor reads
  // it cleanly.
  const scopeParts: string[] = [];
  if (project.description) scopeParts.push(project.description.trim());
  for (const d of attached) {
    const summary = (d.extracted?.scope_summary ?? '').toString().trim();
    if (summary) {
      scopeParts.push(`[${d.classification}] ${summary}`);
    }
  }
  const scopeSummary = scopeParts.join('\n\n').slice(0, 4000);

  // Collect line items from quote-style sources: takeoffs and
  // selections lists carry per-unit data. Spec templates often only
  // have category-level allowances — not enough to mint a line item
  // automatically.
  const QUOTE_SOURCE_KINDS = new Set([
    'takeoff',
    'selections_list',
    'project_quote', // a prior outbound quote can seed the new one
  ]);

  const lineItems: LineItem[] = [];
  const seenDescriptions = new Set<string>();
  for (const d of attached) {
    if (!QUOTE_SOURCE_KINDS.has(d.classification)) continue;
    const items: any[] = Array.isArray(d.extracted?.line_items)
      ? d.extracted.line_items
      : [];
    for (const li of items) {
      if (!li?.description) continue;
      const key = li.description.toLowerCase().trim();
      if (seenDescriptions.has(key)) continue;
      seenDescriptions.add(key);
      const qty = Number(li.qty ?? 0);
      const unitPrice = Number(li.unit_price ?? 0);
      lineItems.push({
        description: li.description,
        qty,
        unit: li.unit ?? 'each',
        unit_price: unitPrice,
        subtotal: qty * unitPrice,
        category: li.category ?? null,
        confidence: li.confidence ?? null,
        source_excerpt: li.source_excerpt
          ? `${d.source_filename ?? d.classification}: ${li.source_excerpt}`
          : (d.source_filename ?? null),
      });
    }
  }

  // If no quote-style docs gave us line items but we have a cost
  // basis, seed category-level placeholder rows so the operator has
  // something to edit. Cost rows are flagged with confidence=low so
  // the editor highlights them for review.
  if (lineItems.length === 0) {
    const summary = await projectCostSummary(svc, project.id);
    for (const row of summary) {
      const subtotal = Number(row.subtotal) || 0;
      if (subtotal <= 0) continue;
      lineItems.push({
        description: `${row.category} (from ${row.line_count} vendor line${row.line_count === 1 ? '' : 's'})`,
        qty: 1,
        unit: 'lump_sum',
        unit_price: subtotal,
        subtotal,
        category: row.category,
        confidence: 'low',
        source_excerpt: 'derived from cost basis — review and apply markup',
      });
    }
  }

  const total = lineItems.reduce((sum, li) => sum + li.subtotal, 0);

  // Resolve or create the client.
  let clientId: string | null = null;
  if (clientName && clientName !== 'Unnamed client') {
    const { data: existing } = await svc
      .from('clients')
      .select('id')
      .eq('shop_id', shopId)
      .ilike('name', clientName)
      .maybeSingle();
    if (existing) {
      clientId = existing.id;
    } else {
      const { data: created } = await svc
        .from('clients')
        .insert({
          shop_id: shopId,
          name: clientName,
          primary_contact_name: clientContactName ?? null,
          primary_contact_email: clientContactEmail ?? null,
          primary_contact_phone: clientContactPhone ?? null,
        })
        .select('id')
        .single();
      clientId = created?.id ?? null;
    }
  }

  // Compute next ref. Same pattern as /api/quote/save — retry on
  // unique-violation up to 5 times.
  const year = new Date().getUTCFullYear();
  const yearStart = `${year}-01-01T00:00:00Z`;
  const computeNextRef = async (offset: number): Promise<string> => {
    const { count } = await svc
      .from('quotes')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .gte('created_at', yearStart);
    const n = (count ?? 0) + 1 + offset;
    return `Q-${year}-${String(n).padStart(4, '0')}`;
  };

  let inserted: { id: string; ref: string } | null = null;
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
    const ref = await computeNextRef(attempt);
    const { data, error } = await svc
      .from('quotes')
      .insert({
        shop_id: shopId,
        project_id: project.id,
        client_id: clientId,
        client_name: clientName,
        client_contact_name: clientContactName,
        client_contact_email: clientContactEmail,
        client_contact_phone: clientContactPhone,
        project_title: projectTitle,
        project_address: projectAddress,
        scope_summary: scopeSummary,
        source: 'project_synthesis',
        total,
        state: 'DRAFT',
        ref,
        proposal_style: 'project_quote',
      })
      .select('id, ref')
      .single();
    if (!error && data) {
      inserted = data;
      break;
    }
    lastErr = error?.message ?? null;
    const isDup =
      (error as any)?.code === '23505' ||
      /duplicate key|unique constraint/i.test(error?.message ?? '');
    if (!isDup) break;
  }

  if (!inserted) {
    return json({ error: lastErr ?? 'Quote insert failed' }, 500);
  }

  // Persist line items.
  if (lineItems.length > 0) {
    const rows = lineItems.map((li, idx) => ({
      quote_id: inserted!.id,
      position: idx + 1,
      description: li.description,
      qty: li.qty,
      unit: li.unit,
      unit_price: li.unit_price,
      subtotal: li.subtotal,
      category: li.category,
      confidence: li.confidence,
      source_excerpt: li.source_excerpt,
    }));
    const { error: liErr } = await svc.from('quote_line_items').insert(rows);
    if (liErr) {
      console.warn('[build-quote] line items insert failed', liErr.message);
    }
  }

  await recomputeProjectStatus(svc, project.id);

  return json(
    {
      quote_id: inserted.id,
      ref: inserted.ref,
      line_items_count: lineItems.length,
      docs_considered: attached.length,
      next_url: `/quotes/${inserted.id}`,
    },
    200,
  );
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
