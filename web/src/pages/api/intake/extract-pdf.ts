/**
 * POST /api/intake/extract-pdf
 *
 * Accepts a PDF (multipart/form-data, field name `file`) and returns
 * plain text so the existing /api/quote/scan endpoint can read it
 * exactly like a pasted-text intake.
 *
 * Pure-JS extraction via unpdf — picked because it's built specifically
 * for Cloudflare Workers (no Node-only filesystem, no native bindings).
 * For scanned PDFs (image-only pages), unpdf returns empty text per
 * page; the caller can detect that and fall back to a vision-model
 * route, but most contractor RFPs come through as native-text PDFs.
 */
import type { APIRoute } from 'astro';
import { extractText, getDocumentProxy } from 'unpdf';

import { extractIntakeMetadata } from '@/lib/intake-metadata';

export const prerender = false;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — covers most spec PDFs

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Not authenticated' }, 401);

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'Expected multipart/form-data' }, 400);
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'file field required' }, 400);
  if (file.size > MAX_BYTES) {
    return json({ error: `PDF too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, 413);
  }
  if (file.type && !file.type.includes('pdf')) {
    return json({ error: `Expected PDF, got ${file.type}` }, 400);
  }

  const buf = new Uint8Array(await file.arrayBuffer());

  let text = '';
  let pageCount = 0;
  try {
    const pdf = await getDocumentProxy(buf);
    pageCount = pdf.numPages;
    const result = await extractText(pdf, { mergePages: true });
    text = typeof result.text === 'string' ? result.text : (result.text as string[]).join('\n\n');
  } catch (err) {
    return json(
      { error: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }

  const env = locals.runtime?.env;
  const trimmed = text.trim();
  const extract = env ? await extractIntakeMetadata(env, trimmed) : null;

  return json(
    {
      text: trimmed,
      page_count: pageCount,
      filename: file.name,
      // Most PDFs that come back empty are scanned images; surface that
      // honestly so the UI can suggest the voice / paste alternative.
      empty_text: trimmed.length === 0,
      metadata: extract?.metadata ?? null,
      // Inline diagnostic envelope — surfaces in DevTools so silent
      // extraction failures are debuggable from the browser.
      metadata_debug: extract?.debug ?? null,
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
