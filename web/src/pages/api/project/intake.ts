/**
 * POST /api/project/intake
 *
 * Per-file intake within the multi-doc upload flow. Accepts:
 *   - a PDF (multipart/form-data, `file`), OR
 *   - an image PNG/JPG/WEBP (multipart/form-data, `file`) — routed
 *     through the Llama 3.2 Vision agent, OR
 *   - already-extracted text (JSON, `text`)
 *
 * Pipeline:
 *   1. Extract text (unpdf) or run vision agent on image.
 *   2. Run intake classifier on text path; vision path produces its
 *      own classification.
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

import { lineItemsToCostCandidates, persistCostRecords } from '@/lib/cost-records';
import { parseEmailThread } from '@/lib/email-thread-parser';
import { classifyAndExtract } from '@/lib/intake-agent';
import { findMatchingProjects, projectSignalText } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';
import { normalizeTakeoffItems } from '@/lib/takeoff-parser';
import { analyzeImage, visionKindToClassification, type VisionExtract } from '@/lib/vision-agent';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

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
  let sourceKind: 'pdf_upload' | 'pasted_text' | 'voice_transcript' | 'email_body' | 'image_upload' = 'pdf_upload';
  let pageCount: number | null = null;
  let visionExtract: VisionExtract | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: 'Expected multipart/form-data' }, 400);
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'file field required' }, 400);
    if (file.size > MAX_BYTES) return json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, 413);
    filename = file.name;

    const isImage = IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);

    if (isImage) {
      sourceKind = 'image_upload';
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        visionExtract = await analyzeImage(env, buf);
        // Use the vision text_observed as the raw_text proxy so the
        // project-embedding signal has something to chew on.
        text = [
          visionExtract.scope_summary,
          ...visionExtract.text_observed,
          ...visionExtract.material_callouts.map(
            (m) => `${m.material}${m.color ? ` — ${m.color}` : ''}${m.location ? ` (${m.location})` : ''}`,
          ),
          ...visionExtract.rooms.map(
            (r) => `${r.name}${r.dimensions ? ` ${r.dimensions}` : ''}`,
          ),
        ]
          .filter(Boolean)
          .join('\n');
      } catch (e) {
        return json(
          { error: `Vision analysis failed: ${e instanceof Error ? e.message : String(e)}` },
          500,
        );
      }
    } else {
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

  // Vision path: skip the text classifier entirely — the vision agent
  // already classified the image. Text path: run classifyAndExtract.
  let classification: string;
  let direction: 'outbound' | 'inbound' | 'operator_own';
  let confidence: number;
  let scopeSummary: string;
  let clientHints: Record<string, string | null>;
  let extractedPayload: Record<string, unknown>;
  let lineItemsCount = 0;

  if (visionExtract) {
    classification = visionKindToClassification(visionExtract.doc_kind);
    direction = 'inbound';
    confidence = visionExtract.confidence;
    scopeSummary = visionExtract.scope_summary;
    clientHints = {
      client_name: null,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      project_title: null,
      project_address: null,
    };
    extractedPayload = {
      scope_summary: visionExtract.scope_summary,
      client_hints: clientHints,
      line_items: [],
      vision: {
        doc_kind: visionExtract.doc_kind,
        material_callouts: visionExtract.material_callouts,
        rooms: visionExtract.rooms,
        text_observed: visionExtract.text_observed,
      },
      flags: [],
    };
  } else {
    const extract = await classifyAndExtract(env, trimmed);

    // Takeoff post-processing: unit aliases, dimension → area, section
    // header detection. Cheap pure-text math, runs only when the doc is
    // classified as `takeoff`.
    if (extract.classification === 'takeoff' && extract.line_items.length > 0) {
      extract.line_items = normalizeTakeoffItems(extract.line_items);
    }

    classification = extract.classification;
    direction = extract.direction;
    confidence = extract.confidence;
    scopeSummary = extract.scope_summary;
    clientHints = extract.client_hints as Record<string, string | null>;
    lineItemsCount = extract.line_items.length;
    extractedPayload = {
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
    };

    // Email thread structural parse — splits into per-message blocks
    // so the project surface can show "N messages from M people" and
    // the Offer agent can read who-said-what. Pure-text regex pass,
    // no LLM call. Only runs when the LLM classified the doc as a
    // thread; safe to attach the result even if parse yields zero
    // messages (degraded copy/paste).
    if (extract.classification === 'email_thread') {
      const thread = parseEmailThread(trimmed);
      extractedPayload.thread = thread;
    }
  }

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
      classification,
      direction,
      classification_confidence: confidence,
      extracted: extractedPayload,
    })
    .select('id')
    .single();

  // If this is a vendor invoice, extract cost records from its line
  // items. Cost records start project-less (project_id null); the
  // /api/project/[id]/attach endpoint backfills project_id when the
  // operator confirms the grouping. Vision-only docs (no line_items)
  // are skipped automatically.
  let costRecordsInserted = 0;
  if (
    classification === 'vendor_invoice' &&
    stored?.id &&
    !visionExtract &&
    Array.isArray(extractedPayload.line_items) &&
    (extractedPayload.line_items as unknown[]).length > 0
  ) {
    const result = await persistCostRecords(env, svc, {
      shop_id: shopId,
      source_document_id: stored.id,
      vendor_name: clientHints.client_name,
      items: lineItemsToCostCandidates(extractedPayload.line_items as any),
    });
    costRecordsInserted = result.inserted;
  }

  // Auto-match against existing projects.
  const signal = projectSignalText({
    name: clientHints.client_name ?? clientHints.project_title,
    address: clientHints.project_address,
    description: scopeSummary,
    doc_sample: trimmed,
  });
  const matches = await findMatchingProjects(env, svc, shopId, signal, { limit: 3 });

  // If nothing matched, propose what a new project would look like.
  const suggestedProject = matches.length === 0
    ? {
        name:
          clientHints.project_title?.trim() ||
          clientHints.project_address?.trim() ||
          clientHints.client_name?.trim() ||
          filename?.replace(/\.(pdf|png|jpe?g|webp)$/i, '') ||
          'Untitled project',
        address: clientHints.project_address,
        client_name_hint: clientHints.client_name,
      }
    : null;

  return json(
    {
      document_id: stored?.id ?? null,
      classification,
      direction,
      confidence,
      filename,
      page_count: pageCount,
      source_kind: sourceKind,
      extracted: {
        scope_summary: scopeSummary,
        client_hints: clientHints,
        flags: (extractedPayload.flags as unknown[]) ?? [],
        line_items_count: lineItemsCount,
        vision: visionExtract
          ? {
              doc_kind: visionExtract.doc_kind,
              material_callouts_count: visionExtract.material_callouts.length,
              rooms_count: visionExtract.rooms.length,
            }
          : null,
      },
      matches,
      suggested_project: suggestedProject,
      cost_records_inserted: costRecordsInserted,
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
