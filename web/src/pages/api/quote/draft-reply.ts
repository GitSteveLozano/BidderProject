/**
 * POST /api/quote/draft-reply
 *
 * Stream a reply draft for a quote. Used by the Reply slide-over.
 * SSE events: { type: 'subject', text } once, then { type: 'token', text }
 * tokens, then { type: 'done' } | { type: 'error', message }.
 *
 * The first user keystroke in the drawer aborts the stream client-side.
 *
 * Runs on Cloudflare Workers AI (Llama 3.3 70B by default) — free
 * under the 10k-neurons/day allowance, no API key required beyond
 * the AI binding being enabled on the Pages project.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { streamText } from '@/lib/ai';

export const prerender = false;

const SYSTEM = `You draft a single-paragraph email reply from a contractor to
their client. The client recently responded to (or asked about) a quote; the
reply should answer them directly, be friendly without being saccharine,
reference the project specifics, and end with a single concrete next step.

Length: 3-6 sentences. No subject line in the body. No marketing language.
Sign off using the shop's boilerplate_closing if present, otherwise just the
owner's first name. Return only the body text — no preamble like "Here's the
reply:".`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) return new Response('Not authenticated', { status: 401 });
  if (!env.AI) return new Response('Workers AI binding not configured', { status: 500 });

  let body: { quote_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.quote_id) return new Response('quote_id required', { status: 400 });

  const svc = supabaseService(env, 'service');
  const { data: q } = await svc
    .from('quotes')
    .select('id, ref, client_name, client_contact_name, project_title, scope_summary, total, state, next_step')
    .eq('id', body.quote_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!q) return new Response('Quote not found', { status: 404 });

  const { data: shop } = await svc
    .from('shops')
    .select('owner_name, voice_profile')
    .eq('id', locals.membership.shop_id)
    .maybeSingle();
  const ownerFirst = (shop?.owner_name ?? '').split(' ')[0];
  const closing = shop?.voice_profile?.boilerplate_closing ?? '';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        emit({ type: 'subject', text: `Re: ${q.project_title}` });

        const userMsg =
          `Quote: ${q.ref}\n` +
          `Client: ${q.client_name}${q.client_contact_name ? ` (${q.client_contact_name})` : ''}\n` +
          `Project: ${q.project_title}\n` +
          `Total: $${Number(q.total).toLocaleString()}\n` +
          `State: ${q.state}\n` +
          (q.next_step ? `What the operator noted as next: ${q.next_step}\n` : '') +
          (q.scope_summary ? `Scope: ${q.scope_summary}\n` : '') +
          `Sign as: ${ownerFirst}\n` +
          (closing ? `Closing line to end with: ${closing}\n` : '') +
          `\nWrite the reply.`;

        for await (const chunk of streamText(env, {
          max_tokens: 600,
          temperature: 0.5,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userMsg },
          ],
        })) {
          emit({ type: 'token', text: chunk });
        }
        emit({ type: 'done' });
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
