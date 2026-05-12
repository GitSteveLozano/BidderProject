/**
 * POST /api/quote/draft-nudge
 *
 * Stream a nudge draft for a quote that's gone quiet. The tone scales
 * with `age_days`: under 48h is a soft check-in, 2-5d is direct,
 * 5-10d is final and escalating. See design/agent-port-notes.md for
 * the cadence rules.
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const SYSTEM = `You draft a single-paragraph follow-up email from a contractor
to their client. The contractor sent a quote some time ago and hasn't heard
back. Match the tone parameter exactly:
  - soft: warm, conversational, "just checking in" but specific to the project
  - direct: businesslike, references the timeline, asks for a concrete reply
  - final: respectful but firm; closes the loop ("if I don't hear back, I'll
    take this off my list and follow up in a few weeks")

Length: 3-6 sentences. Never pushy. Never marketing-speak. Never exclamation
marks. Reference the project specifically. Sign off with the owner's first
name.`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) return new Response('Not authenticated', { status: 401 });
  if (!env.ANTHROPIC_API_KEY) return new Response('ANTHROPIC_API_KEY not configured', { status: 500 });

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
    .select('id, ref, client_name, client_contact_name, project_title, total, sent_at, created_at')
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

  const sentAt = new Date(q.sent_at ?? q.created_at);
  const ageHours = (Date.now() - sentAt.getTime()) / (60 * 60 * 1000);
  const tone = ageHours < 48 * 2 ? 'soft' : ageHours < 24 * 7 ? 'direct' : 'final';

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        emit({ type: 'subject', text: `Following up — ${q.project_title}` });

        const userMsg =
          `Quote: ${q.ref}\nClient: ${q.client_name}\n` +
          `Project: ${q.project_title}\nTotal: $${Number(q.total).toLocaleString()}\n` +
          `Days since sent: ${Math.floor(ageHours / 24)}\n` +
          `Tone: ${tone}\nSign as: ${ownerFirst}\n\nWrite the follow-up.`;

        const msg = client.messages.stream({
          model: env.DEFAULT_MODEL_SONNET ?? 'claude-sonnet-4-6',
          max_tokens: 600,
          temperature: 0.5,
          system: SYSTEM,
          messages: [{ role: 'user', content: userMsg }],
        });
        msg.on('text', (text: string) => emit({ type: 'token', text }));
        await msg.finalMessage();
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
