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
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — covers ~25 min of mp3 at 128 kbps
const MODEL = '@cf/openai/whisper-large-v3-turbo';

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

  const buf = new Uint8Array(await file.arrayBuffer());

  try {
    // Workers AI Whisper accepts the audio as an array of bytes.
    const result = (await env.AI.run(MODEL, {
      audio: Array.from(buf),
    })) as { text?: string; transcription_info?: { duration?: number } };

    return json(
      {
        text: (result.text ?? '').trim(),
        duration_seconds: result.transcription_info?.duration ?? null,
        filename: file.name,
        empty_text: !result.text || result.text.trim().length === 0,
      },
      200,
    );
  } catch (err) {
    return json(
      { error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
