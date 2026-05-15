/**
 * POST /api/project/intake
 *
 * Per-file intake within the multi-doc upload flow. Accepts either:
 *   - a PDF (multipart/form-data, `file`), OR
 *   - already-extracted text (JSON, `text`)
 *
 * Pipeline:
 *   1. Extract text (unpdf) if file given.
 *   2. Run intake classifier (lib/intake-agent.classifyAndExtract).
 *   3. Persist as an intake_documents row (no project yet).
 *   4. Try to match against existing projects via embedding.
 *   5. Return { document, classification, matches, suggested_project }.
 *      The client UI clusters across multiple calls + lets the
 *      operator confirm groupings before persisting project_id.
 *
 * Why per-file instead of one endpoint that takes all the files at
 * once: streaming progress, per-file failures don't kill the batch,
 * the operator sees results as they arrive.
 */
import type { APIRoute } from 'astro';
import { extractText, getDocumentProxy } from 'unpdf';

import { classifyAndExtract } from '@/lib/intake-agent';
import { findMatchingProjects, projectSignalText } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const MAX_BYTES = 25 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'AI binding not configured' }, 500);

  const contentType = request.headers.get('content-type') ?? '';
  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  let text = '';
  let filename: string | null = null;
  let sourceKind: 'pdf_upload' | 'pasted_text' | 'voice_transcript' | 'email_body' = 'pdf_upload';
  let pageCount: number | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: 'Expected multipart/form-data' }, 400);
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'file field required' }, 400);
    if (file.size > MAX_BYTES) return json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, 413);
    filename = file.name;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      pageCount = pdf.numPages;
      const result = await extractText(pdf, { mergePages: true });
      text =
        typeof result.text === 'string'
          ? result.text
          : (result.text as string[]).join('\n\n');
    } catch (e) {
      return json(
        { error: `PDF parse failed: ${e instanceof Error ? e.message : String(e)}` },
        500,
      );
    }
  } else {
    let body: { text?: string; filename?: string; source_kind?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (!body.text || body.text.trim().length < 30) {
      return json({ error: 'text too short' }, 400);
    }
    text = body.text;
    filename = body.filename ?? null;
    if (body.source_kind === 'pasted_text' || body.source_kind === 'voice_transcript' || body.source_kind === 'email_body') {
      sourceKind = body.source_kind;
    }
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return json({ error: 'No text content (PDF may be image-only)', empty_text: true }, 200);
  }

  // Classify + extract.
  const extract = await classifyAndExtract(env, trimmed);

  // Persist as a free-floating intake_documents row (project_id null).
  // The client UI gathers all uploads, lets the operator confirm
  // groupings, then PATCHes project_id via /api/project/[id]/attach.
  const { data: stored, error: insertErr } = await svc
    .from('intake_documents')
    .insert({
      shop_id: shopId,
      source_kind: sourceKind,
      source_filename: filename,
      raw_text: trimmed.slice(0, 50000),
      classification: extract.classification,
      direction: extract.direction,
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

  // Auto-match against existing projects.
  const signal = projectSignalText({
    name: extract.client_hints.client_name ?? extract.client_hints.project_title,
    address: extract.client_hints.project_address,
    description: extract.scope_summary,
    doc_sample: trimmed,
  });
  const matches = await findMatchingProjects(env, svc, shopId, signal, { limit: 3 });

  // If nothing matched, propose what a new project would look like.
  const suggestedProject = matches.length === 0
    ? {
        name:
          extract.client_hints.project_title?.trim() ||
          extract.client_hints.project_address?.trim() ||
          extract.client_hints.client_name?.trim() ||
          filename?.replace(/\.pdf$/i, '') ||
          'Untitled project',
        address: extract.client_hints.project_address,
        client_name_hint: extract.client_hints.client_name,
      }
    : null;

  return json(
    {
      document_id: stored?.id ?? null,
      classification: extract.classification,
      direction: extract.direction,
      confidence: extract.confidence,
      filename,
      page_count: pageCount,
      extracted: {
        scope_summary: extract.scope_summary,
        client_hints: extract.client_hints,
        flags: extract.flags,
        line_items_count: extract.line_items.length,
      },
      matches,
      suggested_project: suggestedProject,
      persist_error: insertErr?.message ?? null,
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
