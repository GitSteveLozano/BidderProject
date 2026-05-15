/**
 * Cost records — line items extracted from inbound vendor invoices.
 *
 * Phase 3 of the multi-doc-intake refactor. When the Intake agent
 * classifies a document as `vendor_invoice`, this module persists its
 * line_items into the cost_records table, embeds each row, and
 * provides lookup helpers for the Offer agent.
 *
 * Margin-aware pricing comes from:
 *   • `searchSimilarCosts(query)`         — "what have I paid for X"
 *   • `projectCostSummary(project_id)`    — aggregate by category for
 *     the project detail surface + Offer agent context.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { embed, toPgVector } from './embeddings';
import type { CloudflareEnv } from './supabase';

export type CostCategory =
  | 'drywall'
  | 'paint'
  | 'tile'
  | 'lumber'
  | 'hardware'
  | 'roofing'
  | 'plumbing'
  | 'electrical'
  | 'flooring'
  | 'fixtures'
  | 'labor'
  | 'rental'
  | 'other';

export interface CostRecord {
  id: string;
  shop_id: string;
  project_id: string | null;
  source_document_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  sku: string | null;
  description: string;
  category: CostCategory | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  total_cost: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CostRecordCandidate {
  description: string;
  sku?: string | null;
  category?: CostCategory | null;
  quantity?: number | null;
  unit?: string | null;
  unit_cost?: number | null;
  total_cost: number;
}

/** Keyword buckets used to infer category when the Intake agent didn't
 * tag the line item. Cheap heuristic — good enough to surface a
 * category pill, the operator can correct later. */
const CATEGORY_KEYWORDS: Record<CostCategory, string[]> = {
  drywall: ['drywall', 'gypsum', 'gyproc', 'mud', 'sheetrock', 'joint compound', 'corner bead', 'tape '],
  paint: ['paint', 'primer', 'enamel', 'lacquer', 'stain', 'roller', 'brush'],
  tile: ['tile', 'grout', 'thinset', 'mortar', 'porcelain', 'ceramic', 'mosaic'],
  lumber: ['lumber', '2x4', '2x6', '2x8', '2x10', 'osb', 'plywood', 'stud', 'joist', 'rafter', 'beam', 'spruce', 'pine', 'fir'],
  hardware: ['screw', 'nail', 'bolt', 'anchor', 'fastener', 'bracket', 'hinge', 'lock', 'handle'],
  roofing: ['shingle', 'underlayment', 'flashing', 'ridge', 'soffit', 'fascia', 'gutter', 'downspout', 'roof'],
  plumbing: ['pipe', 'fitting', 'pex', 'copper pipe', 'abs ', 'pvc ', 'valve', 'faucet', 'toilet', 'sink', 'drain'],
  electrical: ['wire', 'romex', 'breaker', 'outlet', 'switch', 'gfci', 'panel', 'conduit', 'junction box'],
  flooring: ['hardwood', 'laminate', 'lvp', 'vinyl plank', 'carpet', 'underpad', 'transition strip', 'floor'],
  fixtures: ['light fixture', 'pendant', 'chandelier', 'vanity', 'cabinet', 'countertop', 'mirror', 'shower door'],
  labor: ['labor', 'hours', 'install', 'service call', 'callout'],
  rental: ['rental', 'rent', 'lift', 'scissor', 'boom', 'compressor'],
  other: [],
};

export function inferCategory(description: string): CostCategory | null {
  const haystack = description.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS) as Array<[CostCategory, string[]]>) {
    if (cat === 'other') continue;
    for (const kw of kws) {
      if (haystack.includes(kw)) return cat;
    }
  }
  return null;
}

function costSignalText(c: {
  vendor_name?: string | null;
  description: string;
  category?: CostCategory | null;
  sku?: string | null;
}): string {
  return [
    c.vendor_name && `Vendor: ${c.vendor_name}`,
    c.category && `Category: ${c.category}`,
    c.sku && `SKU: ${c.sku}`,
    c.description,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Persist a batch of cost_records derived from one vendor_invoice
 * intake_document. Each row gets an embedding for downstream cosine
 * lookup. */
export async function persistCostRecords(
  env: CloudflareEnv,
  svc: SupabaseClient,
  args: {
    shop_id: string;
    project_id?: string | null;
    source_document_id?: string | null;
    vendor_name?: string | null;
    invoice_number?: string | null;
    invoice_date?: string | null;
    items: CostRecordCandidate[];
  },
): Promise<{ inserted: number }> {
  if (args.items.length === 0) return { inserted: 0 };

  const rows = await Promise.all(
    args.items.map(async (item) => {
      const category =
        item.category ?? inferCategory(item.description) ?? null;
      const signal = costSignalText({
        vendor_name: args.vendor_name,
        description: item.description,
        category,
        sku: item.sku,
      });
      const vec = await embed(env, signal);
      return {
        shop_id: args.shop_id,
        project_id: args.project_id ?? null,
        source_document_id: args.source_document_id ?? null,
        vendor_name: args.vendor_name ?? null,
        invoice_number: args.invoice_number ?? null,
        invoice_date: args.invoice_date ?? null,
        sku: item.sku ?? null,
        description: item.description,
        category,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        unit_cost: item.unit_cost ?? null,
        total_cost: item.total_cost,
        embedding: vec ? toPgVector(vec) : null,
      };
    }),
  );

  const { error } = await svc.from('cost_records').insert(rows);
  if (error) {
    console.warn('[cost-records] insert failed', error);
    return { inserted: 0 };
  }
  return { inserted: rows.length };
}

/** Cosine lookup for the Offer agent: "what have I paid for items
 * like X recently". Returns the closest N matches inside the shop,
 * optionally filtered to a category. */
export async function searchSimilarCosts(
  env: CloudflareEnv,
  svc: SupabaseClient,
  args: {
    shop_id: string;
    query_text: string;
    category?: CostCategory | null;
    limit?: number;
  },
): Promise<Array<{
  id: string;
  description: string;
  category: string | null;
  vendor_name: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  total_cost: number;
  invoice_date: string | null;
  distance: number;
}>> {
  const vec = await embed(env, args.query_text);
  if (!vec) return [];
  const { data, error } = await svc.rpc('search_cost_records', {
    p_shop_id: args.shop_id,
    p_query: toPgVector(vec),
    p_category: args.category ?? null,
    p_limit: args.limit ?? 10,
  });
  if (error) {
    console.warn('[cost-records] search failed', error);
    return [];
  }
  return (data ?? []) as any;
}

export interface CostSummaryRow {
  category: string;
  line_count: number;
  subtotal: number;
}

/** Per-project category roll-up. Surfaces on /projects/[id] and is fed
 * to the Offer agent so it sees "you've already spent $X on tile" when
 * drafting the quote. */
export async function projectCostSummary(
  svc: SupabaseClient,
  project_id: string,
): Promise<CostSummaryRow[]> {
  const { data, error } = await svc.rpc('project_cost_summary', {
    p_project_id: project_id,
  });
  if (error) {
    console.warn('[cost-records] project_cost_summary failed', error);
    return [];
  }
  return (data ?? []) as CostSummaryRow[];
}

/** Map IntakeExtract.line_items (the Intake agent's generic line-item
 * shape) into cost record candidates. Used when the document was
 * classified as `vendor_invoice`. */
export function lineItemsToCostCandidates(
  line_items: Array<{
    description: string;
    qty?: number;
    unit?: string;
    unit_price?: number;
    category?: string;
  }>,
): CostRecordCandidate[] {
  return line_items
    .filter((li) => li && li.description && (li.unit_price ?? 0) >= 0)
    .map((li) => {
      const qty = typeof li.qty === 'number' ? li.qty : null;
      const unit_cost =
        typeof li.unit_price === 'number' ? li.unit_price : null;
      const total =
        qty != null && unit_cost != null ? qty * unit_cost : (unit_cost ?? 0);
      const cat = li.category ? (li.category.toLowerCase() as CostCategory) : null;
      const validCat = cat && cat in CATEGORY_KEYWORDS ? cat : null;
      return {
        description: li.description,
        category: validCat,
        quantity: qty,
        unit: li.unit ?? null,
        unit_cost,
        total_cost: total,
      };
    });
}
