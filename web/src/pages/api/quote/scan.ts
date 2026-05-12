/**
 * POST /api/quote/scan
 *
 * Streams Claude tool-use over an uploaded scope (PDF text, pasted
 * scope, voice transcript) and emits line items progressively as SSE.
 *
 * SSE event types:
 *   data: {"type":"progress","percent":42}
 *   data: {"type":"line_item","payload":{position,description,qty,unit,unit_price,subtotal,category,confidence,source_excerpt}}
 *   data: {"type":"flag","payload":{kind:"warn"|"info",text}}
 *   data: {"type":"done","payload":{client_info?,scope_summary?,line_item_count}}
 *   data: {"type":"error","message":string}
 *
 * Per design/agent-port-notes.md → Intake. Replaces the legacy
 * /api/bids/generate one-shot prompt with progressive tool-use.
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const prerender = false;

const SYSTEM_PROMPT = `You read a construction-scope document and extract line items
for a contractor's bid. You emit ONE tool call per line item, plus tool calls
for any flags worth raising to the operator.

Line item rules:
- Pull from the scope text — do not invent items not implied by the source
- Each item is a discrete unit of work or material with a quantity
- Categories: labor | materials | subs | permits | equipment | other
- Confidence: high (explicit in source), med (inferred from context), low (guess)
- source_excerpt: quote 80 chars or less from the source supporting the item

Flag rules:
- "warn": something the operator should confirm before sending (mismatched dimensions,
  unusual terminology, scope ambiguity)
- "info": context that affects pricing (lots of access work, special finish, etc.)
Aim for 6-12 line items, 0-3 flags. Concise — operator will edit.

After tool calls, output a 1-2 sentence scope summary in plain text.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'record_line_item',
    description: 'Record one line item extracted from the scope. Call once per item.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        qty: { type: 'number' },
        unit: { type: 'string', enum: ['each', 'hr', 'sqft', 'lf', 'cy', 'day', 'lump_sum'] },
        unit_price: { type: 'number', description: 'Estimated cost per unit, USD' },
        category: { type: 'string', enum: ['labor', 'materials', 'subs', 'permits', 'equipment', 'other'] },
        confidence: { type: 'string', enum: ['high', 'med', 'low'] },
        source_excerpt: { type: 'string', description: 'Up to 80 chars from the source that supports this item' },
      },
      required: ['description', 'qty', 'unit', 'unit_price', 'category', 'confidence'],
    },
  },
  {
    name: 'record_flag',
    description: 'Record a flag for the operator to review before sending.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['warn', 'info'] },
        text: { type: 'string', description: 'Short, specific message under 200 chars.' },
      },
      required: ['kind', 'text'],
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

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const items: Array<Record<string, unknown>> = [];
      const flags: Array<Record<string, unknown>> = [];

      try {
        emit({ type: 'progress', percent: 5 });

        const model = env.DEFAULT_MODEL_SONNET ?? 'claude-sonnet-4-6';
        const userMsg =
          `Client: ${body.client_name ?? '(unknown)'}\n` +
          `Project: ${body.project_title ?? '(unknown)'}\n\n` +
          `Scope text:\n--- SCOPE ---\n${content.slice(0, 16000)}\n--- END SCOPE ---\n\n` +
          `Extract line items now — one tool call per item.`;

        const msg = client.messages.stream({
          model,
          max_tokens: 4000,
          temperature: 0.2,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          tool_choice: { type: 'auto' },
          messages: [{ role: 'user', content: userMsg }],
        });

        let percent = 5;
        msg.on('inputJson', () => {
          percent = Math.min(percent + 6, 92);
          emit({ type: 'progress', percent });
        });

        const final = await msg.finalMessage();

        let position = 1;
        for (const block of final.content) {
          if (block.type === 'tool_use') {
            if (block.name === 'record_line_item') {
              const input = block.input as Record<string, any>;
              const subtotal = round(Number(input.qty ?? 0) * Number(input.unit_price ?? 0), 2);
              const item = { ...input, position, subtotal };
              items.push(item);
              emit({ type: 'line_item', payload: item });
              position += 1;
            } else if (block.name === 'record_flag') {
              flags.push(block.input as Record<string, any>);
              emit({ type: 'flag', payload: block.input });
            }
          }
        }

        // Trailing prose = scope summary
        const scope_summary = final.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text.trim())
          .filter(Boolean)
          .join(' ');

        emit({ type: 'progress', percent: 100 });
        emit({
          type: 'done',
          payload: {
            line_item_count: items.length,
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

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
