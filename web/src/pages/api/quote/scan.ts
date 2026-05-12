/**
 * POST /api/quote/scan
 *
 * Reads an uploaded scope (PDF text, pasted scope, voice transcript)
 * and extracts line items + flags + scope summary. SSE shape:
 *   data: {"type":"progress","percent":N}
 *   data: {"type":"line_item","payload":{position,description,qty,unit,unit_price,subtotal,category,confidence,source_excerpt}}
 *   data: {"type":"flag","payload":{kind:"warn"|"info",text}}
 *   data: {"type":"done","payload":{client_info?,scope_summary?,line_item_count}}
 *   data: {"type":"error","message":string}
 *
 * Was previously Anthropic tool-use streaming (one tool call per
 * line item, emit-as-they-arrive). Now runs on Cloudflare Workers AI
 * with a JSON-mode prompt — Workers AI's tool support is more limited,
 * so we ask for a single structured JSON object, stream the text so
 * the progress bar advances, then parse + emit line items at the end.
 * Operator UX: the "Brief is reading" narrative still plays out via
 * progress events; line items land in one batch when the scan
 * finishes (was: one-by-one).
 */
import type { APIRoute } from 'astro';

import { streamText } from '@/lib/ai';

export const prerender = false;

const SYSTEM_PROMPT = `You read a construction-scope document and extract line
items for a contractor's bid. Return ONLY a JSON object of the exact shape
below — no fences, no preamble, no closing remarks.

{
  "line_items": [
    {
      "description": "string",
      "qty": number,
      "unit": "each" | "hr" | "sqft" | "lf" | "cy" | "day" | "lump_sum",
      "unit_price": number,
      "category": "labor" | "materials" | "subs" | "permits" | "equipment" | "other",
      "confidence": "high" | "med" | "low",
      "source_excerpt": "≤ 80 chars from the source supporting this item"
    }
  ],
  "flags": [
    { "kind": "warn" | "info", "text": "short, specific, under 200 chars" }
  ],
  "scope_summary": "1-2 sentence plain-English summary of the work"
}

Rules:
- Pull from the scope text — do not invent items not implied by the source
- Each item is a discrete unit of work or material with a quantity
- Confidence: high (explicit in source), med (inferred from context), low (guess)
- "warn" flags: things the operator should confirm (mismatched dimensions,
  unusual terminology, scope ambiguity)
- "info" flags: context that affects pricing (lots of access work, special
  finish, etc.)
- Aim for 6-12 line items, 0-3 flags. Concise — operator will edit.`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) {
    return new Response('Not authenticated', { status: 401 });
  }
  if (!env.AI) {
    return new Response('Workers AI binding not configured', { status: 500 });
  }

  let body: { content?: string; client_name?: string; project_title?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.content || body.content.trim().length < 30) {
    return new Response('content too short to scan', { status: 400 });
  }
  const content: string = body.content;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        emit({ type: 'progress', percent: 5 });

        const userMsg =
          `Client: ${body.client_name ?? '(unknown)'}\n` +
          `Project: ${body.project_title ?? '(unknown)'}\n\n` +
          `Scope text:\n--- SCOPE ---\n${content.slice(0, 16000)}\n--- END SCOPE ---\n\n` +
          `Extract line items now and return the JSON.`;

        let full = '';
        let percent = 5;
        for await (const chunk of streamText(env, {
          max_tokens: 4000,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
        })) {
          full += chunk;
          percent = Math.min(percent + 3, 92);
          emit({ type: 'progress', percent });
        }

        const { line_items, flags, scope_summary } = parseScan(full);

        for (let i = 0; i < line_items.length; i += 1) {
          const li = line_items[i];
          const subtotal = round(Number(li.qty ?? 0) * Number(li.unit_price ?? 0), 2);
          emit({ type: 'line_item', payload: { ...li, position: i + 1, subtotal } });
        }
        for (const f of flags) emit({ type: 'flag', payload: f });

        emit({ type: 'progress', percent: 100 });
        emit({
          type: 'done',
          payload: {
            line_item_count: line_items.length,
            flag_count: flags.length,
            scope_summary,
          },
        });
        controller.close();
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
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

interface ScanResult {
  line_items: Array<Record<string, any>>;
  flags: Array<{ kind: string; text: string }>;
  scope_summary: string;
}

function parseScan(text: string): ScanResult {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const payload = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    const parsed = JSON.parse(payload);
    return {
      line_items: Array.isArray(parsed.line_items) ? parsed.line_items : [],
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      scope_summary: typeof parsed.scope_summary === 'string' ? parsed.scope_summary : '',
    };
  } catch {
    return { line_items: [], flags: [], scope_summary: '' };
  }
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
