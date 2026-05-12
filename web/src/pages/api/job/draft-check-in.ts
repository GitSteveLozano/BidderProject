/**
 * POST /api/job/draft-check-in
 *
 * SSE-streamed check-in / scheduling note for a job. Used when the
 * operator wants to ping the client about an upcoming milestone —
 * site visit, color approval, sign-off — without a full status
 * update. Tone is softer and more coordination-oriented than
 * /api/job/draft-update. Runs on Cloudflare Workers AI.
 */
import type { APIRoute } from 'astro';

import { client as supabaseService } from '@/lib/supabase';
import { streamText } from '@/lib/ai';

export const prerender = false;

const SYSTEM = `You draft a short check-in email from a specialty contractor
to their client about an upcoming job milestone. You're not delivering a
status update; you're coordinating the next step. Be warm but specific:
reference the project, propose a concrete window for the next interaction,
and make it easy for the client to say yes.

Length: 3-5 sentences. No marketing language. No exclamation marks. Sign off
with the owner's first name. Return only the body text — no preamble like
"Here's the check-in:".`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) return new Response('Not authenticated', { status: 401 });
  if (!env.AI) return new Response('Workers AI binding not configured', { status: 500 });

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
    .select('id, ref, client_name, project_title, state, scheduled_start, scheduled_end, crew_summary')
    .eq('id', body.job_id)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!j) return new Response('Job not found', { status: 404 });

  const { data: shop } = await svc
    .from('shops')
    .select('owner_name')
    .eq('id', locals.membership.shop_id)
    .maybeSingle();
  const ownerFirst = (shop?.owner_name ?? '').split(' ')[0];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        emit({ type: 'subject', text: `Quick check-in — ${j.project_title}` });
        const userMsg =
          `Job: ${j.ref}\nClient: ${j.client_name}\nProject: ${j.project_title}\n` +
          `State: ${j.state}\n` +
          (j.scheduled_start ? `Scheduled start: ${j.scheduled_start}\n` : '') +
          (j.scheduled_end ? `Scheduled end: ${j.scheduled_end}\n` : '') +
          `Sign as: ${ownerFirst}\n\nWrite the check-in.`;

        for await (const chunk of streamText(env, {
          max_tokens: 500,
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
