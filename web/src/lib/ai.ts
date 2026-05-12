/**
 * Thin AI helper over Cloudflare Workers AI. All Brief endpoints that
 * used to call Anthropic now route through here. Free under the
 * Workers AI 10k-neurons/day allowance; same SSE-shaped streaming the
 * client islands already consume.
 *
 * Default model is Llama 3.3 70B FP8 fast — strong general-purpose
 * choice for builder-to-builder email drafting. Override per call via
 * `model`, or globally via env.DEFAULT_WORKERS_AI_MODEL.
 *
 * The /api/quote/scan endpoint still uses Anthropic tool-use streaming
 * because Workers AI's tool support is more limited; revisiting that
 * one is a follow-up.
 */
import type { CloudflareEnv } from './supabase';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function modelFor(env: CloudflareEnv, override?: string): string {
  return override ?? env.DEFAULT_WORKERS_AI_MODEL ?? DEFAULT_MODEL;
}

/** Yields delta text chunks from Workers AI streaming. Caller
 * concatenates to build the full response. Each Workers AI stream
 * event looks like `data: {"response":"..."}` followed by a final
 * `data: [DONE]`. We parse and yield only the `response` field. */
export async function* streamText(
  env: CloudflareEnv,
  opts: StreamOptions,
): AsyncGenerator<string> {
  if (!env.AI) throw new Error('Workers AI binding not configured');
  const stream = (await env.AI.run(modelFor(env, opts.model), {
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 700,
    temperature: opts.temperature ?? 0.5,
    stream: true,
  })) as ReadableStream<Uint8Array>;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() ?? '';
    for (const block of events) {
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]' || !payload) return;
      try {
        const parsed = JSON.parse(payload);
        if (typeof parsed.response === 'string' && parsed.response.length > 0) {
          yield parsed.response;
        }
      } catch {
        // Skip parse errors — Workers AI occasionally emits partial
        // chunks that recover on the next event.
      }
    }
  }
}

/** One-shot generation. Returns the full text. */
export async function generateText(
  env: CloudflareEnv,
  opts: StreamOptions,
): Promise<string> {
  if (!env.AI) throw new Error('Workers AI binding not configured');
  const result = (await env.AI.run(modelFor(env, opts.model), {
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 1500,
    temperature: opts.temperature ?? 0.2,
  })) as { response?: string };
  return (result.response ?? '').trim();
}
