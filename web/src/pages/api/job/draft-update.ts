/**
 * POST /api/job/draft-update
 *
 * SSE-streamed status update from contractor → client for an
 * in-flight job. Pattern mirrors /api/quote/draft-reply and
 * /api/quote/draft-nudge — same SSE event types (subject, token,
 * done, error), same Brief-voice system prompt shape.
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const SYSTEM = `You draft a single-paragraph status update from a specialty
contractor to their client about an in-progress job. Cover what's been done,
what's coming next, and any decision point the client owns. Reference the
project specifics. End with one concrete next step (e.g. "I'll send photos
Friday" or "Confirm color by Tuesday").

Length: 4-7 sentences. Builder-to-builder tone — no marketing language, no
"reach out" / "circle back". Sign off with the owner's first name.`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) return new Response('Not authenticated', { status: 401 });
  if (!env.ANTHROPIC_API_KEY) return new Response('ANTHROPIC_API_KEY not configured', { status: 500 });

  let body: { job_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.job_id) return new Response('job_id required', { status: 400 });

  const svc = supabaseService(env, 'service');
  const { data: j } = await svc
    .from('jobs')
    .select('id, ref, client_name, project_title, state, scheduled_start, scheduled_end, actual_start, estimated_total, actual_total, variance_pct, crew_summary')
    .eq('id', body.job_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!j) return new Response('Job not found', { status: 404 });

  const { data: shop } = await svc
    .from('shops')
    .select('owner_name, voice_profile')
    .eq('id', locals.membership.shop_id)
    .maybeSingle();
  const ownerFirst = (shop?.owner_name ?? '').split(' ')[0];
  const closing = shop?.voice_profile?.boilerplate_closing ?? '';

  const variance = j.variance_pct == null ? null : Number(j.variance_pct);
  const aheadOrBehind =
    variance == null ? 'on track' : variance < -2 ? 'ahead of plan' : variance > 5 ? 'running long' : 'on track';

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        emit({ type: 'subject', text: `Update — ${j.project_title}` });
        const userMsg =
          `Job: ${j.ref}\nClient: ${j.client_name}\nProject: ${j.project_title}\n` +
          `State: ${j.state}\nStatus: ${aheadOrBehind}\n` +
          (j.scheduled_start ? `Scheduled start: ${j.scheduled_start}\n` : '') +
          (j.scheduled_end ? `Scheduled end: ${j.scheduled_end}\n` : '') +
          (j.crew_summary ? `Crew: ${j.crew_summary}\n` : '') +
          `Sign as: ${ownerFirst}\n` +
          (closing ? `Closing line to end with: ${closing}\n` : '') +
          `\nWrite the update.`;

        const model = env.DEFAULT_MODEL_SONNET ?? 'claude-sonnet-4-6';
        const msg = client.messages.stream({
          model,
          max_tokens: 700,
          temperature: 0.45,
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
