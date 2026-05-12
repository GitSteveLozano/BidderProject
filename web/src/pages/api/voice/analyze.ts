/**
 * POST /api/voice/analyze
 *
 * Streams Claude tool-use over an uploaded document (PDF, TXT, MD,
 * email) and emits voice signals (tone, preferred terms, boilerplate
 * snippets) as SSE events.
 *
 * Per design/agent-port-notes.md → Intake — this is the real Claude
 * integration, no stub. Input: { content: string } (the text Claude
 * should read; client pre-extracts from upload). Output:
 *   data: {"type":"progress","percent":42}
 *   data: {"type":"signal","payload":{kind:"tone"|"preferred_terms"|"boilerplate_intro"|...,value:any,evidence:string}}
 *   data: {"type":"done","payload":{summary:{...}}}
 *   data: {"type":"error","message":string}
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const SYSTEM_PROMPT = `You analyze a contractor's writing sample (a past quote,
email, or proposal) and extract voice patterns. You emit one tool call per
finding so the UI can render results progressively.

Findings you should look for:
  - tone: the overall register (direct, formal, warm, terse, conversational...)
  - preferred_terms: domain vocabulary the contractor uses repeatedly
  - avoided_terms: marketing-speak or jargon they conspicuously don't use
  - sentence_length: typical sentence length (short, medium, long)
  - boilerplate_intro: their standard greeting/intro paragraph (verbatim if used 2+ times)
  - boilerplate_closing: their standard sign-off
  - boilerplate_warranty: warranty/terms language
  - boilerplate_terms: payment/terms language

Quote evidence from the source whenever possible.

Do NOT invent findings — if the sample doesn't contain a signal for a category,
skip it. Aim for 4-8 findings total. After your final tool call, conclude
with a brief 2-3 sentence summary in plain text.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'record_signal',
    description:
      'Record a single voice/tone signal extracted from the source document. ' +
      'Call once per finding.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'tone',
            'preferred_terms',
            'avoided_terms',
            'sentence_length',
            'boilerplate_intro',
            'boilerplate_closing',
            'boilerplate_warranty',
            'boilerplate_terms',
          ],
        },
        value: {
          type: 'string',
          description: 'The signal value. For lists (preferred_terms, avoided_terms), use a comma-separated string.',
        },
        evidence: {
          type: 'string',
          description: 'A short quoted excerpt (<= 120 chars) from the source that supports this signal.',
        },
      },
      required: ['kind', 'value'],
    },
  },
];

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) {
    return new Response('Not authenticated', { status: 401 });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 500 });
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
  const content = body.content.slice(0, 12000); // bound the input

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const signals: Array<{ kind: string; value: string; evidence?: string }> = [];

      const emit = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        emit({ type: 'progress', percent: 5 });

        const model = env.DEFAULT_MODEL_SONNET ?? 'claude-sonnet-4-6';
        const msg = client.messages.stream({
          model,
          max_tokens: 2000,
          temperature: 0.3,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          tool_choice: { type: 'auto' },
          messages: [
            {
              role: 'user',
              content:
                `Analyze this writing sample and emit one tool call per voice signal you find.\n\n--- SAMPLE ---\n${content}\n--- END SAMPLE ---`,
            },
          ],
        });

        let lastPercent = 5;
        msg.on('inputJson', () => {
          // Bump progress as tool calls arrive
          lastPercent = Math.min(lastPercent + 8, 90);
          emit({ type: 'progress', percent: lastPercent });
        });

        const final = await msg.finalMessage();

        for (const block of final.content) {
          if (block.type === 'tool_use' && block.name === 'record_signal') {
            const input = block.input as { kind: string; value: string; evidence?: string };
            signals.push(input);
            emit({ type: 'signal', payload: input });
          }
        }

        // Distill into a voice profile to persist
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
      'connection': 'keep-alive',
    },
  });
};

function buildProfile(signals: Array<{ kind: string; value: string; evidence?: string }>) {
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
