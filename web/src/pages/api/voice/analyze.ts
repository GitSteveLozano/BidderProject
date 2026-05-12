/**
 * POST /api/voice/analyze
 *
 * Reads an uploaded writing sample (a past quote, email, or proposal)
 * and extracts voice patterns into a structured profile. SSE events:
 *   data: {"type":"progress","percent":N}
 *   data: {"type":"signal","payload":{kind,value,evidence?}}
 *   data: {"type":"done","payload":{profile,signal_count}}
 *   data: {"type":"error","message":string}
 *
 * Was previously Anthropic tool-use streaming (one tool call per
 * finding, progressive emit). Now runs on Cloudflare Workers AI with
 * a JSON-mode prompt — Workers AI's tool support is more limited, so
 * we ask for a single JSON array of signals and stream-then-parse.
 * Operator-perceived UX is unchanged (progress bar advances while
 * Brief reads; signals appear when the analysis lands).
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { streamText, extractJson } from '@/lib/ai';

export const prerender = false;

const SYSTEM_PROMPT = `You analyze a contractor's writing sample (a past quote,
email, or proposal) and extract voice patterns. Return ONLY a JSON object of
the exact shape below — no fences, no preamble, no closing remarks.

{
  "signals": [
    {
      "kind": "tone" | "preferred_terms" | "avoided_terms" | "sentence_length"
            | "boilerplate_intro" | "boilerplate_closing"
            | "boilerplate_warranty" | "boilerplate_terms",
      "value": "string — for preferred_terms / avoided_terms use a comma-separated string",
      "evidence": "string — a quoted excerpt ≤ 120 chars from the source (optional)"
    }
  ]
}

Guidelines:
- 4-8 signals total — quality over coverage.
- Only emit a signal when the source supports it; do NOT invent.
- For boilerplate signals, include the actual sentence the contractor used
  (verbatim if it appears 2+ times).
- Quote evidence from the source whenever possible.`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) {
    return new Response('Not authenticated', { status: 401 });
  }
  if (!env.AI) {
    return new Response('Workers AI binding not configured', { status: 500 });
  }

  let body: { content?: string; voice_sample_url?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.content || body.content.trim().length < 50) {
    return new Response('content too short (need ≥50 chars to analyze)', { status: 400 });
  }
  const content = body.content.slice(0, 12000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        emit({ type: 'progress', percent: 5 });

        // Stream the JSON response so the progress bar advances while
        // Brief reads. We accumulate the text + parse at the end.
        let full = '';
        let lastPercent = 5;
        for await (const chunk of streamText(env, {
          max_tokens: 2000,
          temperature: 0.3,
          json: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                `Analyze this writing sample and return the JSON.\n\n--- SAMPLE ---\n${content}\n--- END SAMPLE ---`,
            },
          ],
        })) {
          full += chunk;
          lastPercent = Math.min(lastPercent + 4, 90);
          emit({ type: 'progress', percent: lastPercent });
        }

        const signals = parseSignals(full);
        for (const s of signals) {
          emit({ type: 'signal', payload: s });
        }

        const profile = buildProfile(signals);
        const shopId = locals.membership!.shop_id;
        const svc = supabaseService(env, 'service');
        await svc
          .from('shops')
          .update({
            voice_profile: profile,
            voice_sample_url: body.voice_sample_url ?? null,
            voice_sample_processed_at: new Date().toISOString(),
          })
          .eq('id', shopId);

        emit({ type: 'progress', percent: 100 });
        emit({ type: 'done', payload: { profile, signal_count: signals.length } });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
    },
  });
};

interface Signal {
  kind: string;
  value: string;
  evidence?: string;
}

function parseSignals(text: string): Signal[] {
  const parsed = extractJson<{ signals?: Array<any> }>(text);
  const arr = Array.isArray(parsed?.signals) ? parsed!.signals : [];
  return arr
    .filter((s: any) => s && typeof s.kind === 'string' && typeof s.value === 'string')
    .map((s: any) => ({
      kind: s.kind,
      value: String(s.value),
      evidence: typeof s.evidence === 'string' ? s.evidence : undefined,
    }));
}

function buildProfile(signals: Signal[]) {
  const byKind: Record<string, string[]> = {};
  for (const s of signals) {
    (byKind[s.kind] ??= []).push(s.value);
  }
  return {
    tone: byKind.tone?.[0] ?? null,
    preferred_terms: byKind.preferred_terms ? byKind.preferred_terms.flatMap(splitCsv) : [],
    avoided_terms: byKind.avoided_terms ? byKind.avoided_terms.flatMap(splitCsv) : [],
    sentence_length: byKind.sentence_length?.[0] ?? null,
    boilerplate_intro: byKind.boilerplate_intro?.[0] ?? null,
    boilerplate_closing: byKind.boilerplate_closing?.[0] ?? null,
    boilerplate_warranty: byKind.boilerplate_warranty?.[0] ?? null,
    boilerplate_terms: byKind.boilerplate_terms?.[0] ?? null,
  };
}

function splitCsv(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}
