/**
 * POST /api/intake/transcribe
 *
 * Accepts an audio recording (multipart/form-data, field name `file`)
 * and runs it through Cloudflare Workers AI Whisper. The transcript
 * flows back into the existing scope-text intake path so we don't
 * fork the scan endpoint.
 *
 * Uses the AI binding (`env.AI.run`) — no API key needed; the binding
 * has to be enabled on the Pages project ("AI" in the bindings list).
 *
 * Whisper-large-v3-turbo returns empty strings on some webm/opus
 * inputs (the format MediaRecorder defaults to in Chrome/Firefox).
 * If the primary model returns no text, we retry once with the older
 * whisper model, which is more permissive on container formats.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const PRIMARY_MODEL = '@cf/openai/whisper-large-v3-turbo';
const FALLBACK_MODEL = '@cf/openai/whisper';

interface WhisperResult {
  text?: string;
  transcription_info?: { duration?: number };
  word_count?: number;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Not authenticated' }, 401);
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!env.AI) {
    return json(
      { error: 'AI binding not configured — enable Workers AI on the Pages project' },
      500,
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'Expected multipart/form-data' }, 400);
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'file field required' }, 400);
  if (file.size > MAX_BYTES) {
    return json({ error: `Audio too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, 413);
  }
  if (file.size < 1024) {
    return json({ error: 'Audio file too small — recording may have failed before any data was captured' }, 400);
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const audio = Array.from(buf);

  const tried: Array<{ model: string; ok: boolean; chars: number; error?: string }> = [];

  let primary: WhisperResult | null = null;
  try {
    primary = (await env.AI.run(PRIMARY_MODEL, { audio })) as WhisperResult;
    tried.push({ model: PRIMARY_MODEL, ok: true, chars: (primary.text ?? '').length });
  } catch (err) {
    tried.push({
      model: PRIMARY_MODEL,
      ok: false,
      chars: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let chosen: WhisperResult | null = primary;
  if (!primary?.text?.trim()) {
    // Primary returned empty — most often a format issue with
    // webm/opus. Retry with the older whisper model.
    try {
      chosen = (await env.AI.run(FALLBACK_MODEL, { audio })) as WhisperResult;
      tried.push({
        model: FALLBACK_MODEL,
        ok: true,
        chars: (chosen.text ?? '').length,
      });
    } catch (err) {
      tried.push({
        model: FALLBACK_MODEL,
        ok: false,
        chars: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const text = (chosen?.text ?? '').trim();
  return json(
    {
      text,
      duration_seconds: chosen?.transcription_info?.duration ?? null,
      filename: file.name,
      file_size: file.size,
      file_type: file.type,
      empty_text: text.length === 0,
      tried,
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
