/**
 * POST /api/intake/classify
 *
 * Body: { raw_text, source_kind, client_name?, project_title?, source_filename? }
 *
 * Classifies the document, extracts structured data, persists an
 * intake_documents row, and returns the routing decision. Confidence
 * < ROUTING_CONFIDENCE_THRESHOLD means the UI should prompt the
 * operator to confirm.
 */
import type { APIRoute } from 'astro';

import { classifyAndExtract, decideRoute } from '@/lib/intake-agent';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const VALID_SOURCES = ['pdf_upload', 'pasted_text', 'voice_transcript', 'email_body', 'manual_entry'] as const;
type SourceKind = typeof VALID_SOURCES[number];

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: {
    raw_text?: string;
    source_kind?: string;
    client_name?: string;
    project_title?: string;
    source_filename?: string;
    quote_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.raw_text || body.raw_text.trim().length < 30) {
    return json({ error: 'raw_text too short' }, 400);
  }
  const sourceKind: SourceKind = VALID_SOURCES.includes(body.source_kind as SourceKind)
    ? (body.source_kind as SourceKind)
    : 'pasted_text';

  const extract = await classifyAndExtract(env, body.raw_text, {
    client_name: body.client_name,
    project_title: body.project_title,
  });
  const route = decideRoute(extract);

  const svc = supabaseService(env, 'service');
  const { data: stored, error } = await svc
    .from('intake_documents')
    .insert({
      shop_id: locals.membership.shop_id,
      quote_id: body.quote_id ?? null,
      source_kind: sourceKind,
      source_filename: body.source_filename ?? null,
      raw_text: body.raw_text.slice(0, 50000),
      classification: extract.classification,
      classification_confidence: extract.confidence,
      extracted: {
        scope_summary: extract.scope_summary,
        client_hints: extract.client_hints,
        line_items: extract.line_items,
        phases: extract.phases,
        rebate_terms: extract.rebate_terms,
        term_months: extract.term_months,
        requirements: extract.requirements,
        questions: extract.questions,
        deadline: extract.deadline,
        flags: extract.flags,
      },
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[intake] persist failed', error.message);
  }

  return json(
    {
      intake_id: stored?.id,
      classification: extract.classification,
      confidence: extract.confidence,
      route: route.route,
      recommended_flow: route.recommended_flow,
      extract,
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
