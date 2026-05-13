/**
 * POST /api/quote/mark-won
 *
 * Transitions a quote to WON and spawns a job from it. Job inherits
 * client_id, client_name, project_title, and estimated_total from the
 * quote. Optional scheduled_start / scheduled_end + crew_summary come
 * from the request body so the operator can pencil in dates at the
 * same moment they mark the win.
 *
 * Job ref is generated as J-YYYY-NNNN per shop+year, mirroring how
 * /api/quote/save mints quote refs.
 *
 * Body:
 *   { quote_id: string,
 *     scheduled_start?: 'YYYY-MM-DD',
 *     scheduled_end?:   'YYYY-MM-DD',
 *     crew_summary?:    string }
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';
import { captureOutcome } from '@/lib/winloss-agent';

export const prerender = false;

interface Body {
  quote_id?: string;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  crew_summary?: string | null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.quote_id) return json({ error: 'quote_id required' }, 400);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  const { data: quote } = await svc
    .from('quotes')
    .select('id, state, client_id, client_name, project_title, total')
    .eq('id', body.quote_id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);
  if (quote.state === 'WON') {
    // Idempotent — if the job already exists, return it.
    const { data: existing } = await svc
      .from('jobs')
      .select('id, ref')
      .eq('quote_id', quote.id)
      .maybeSingle();
    if (existing) return json({ quote_id: quote.id, job: existing, already_won: true }, 200);
  }
  if (quote.state === 'LOST') {
    return json({ error: 'Cannot mark a LOST quote as won' }, 409);
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const { count } = await svc
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .gte('created_at', `${year}-01-01T00:00:00Z`);
  const n = (count ?? 0) + 1;
  const jobRef = `J-${year}-${String(n).padStart(4, '0')}`;

  const jobState: 'SCHEDULED' | 'INPROGRESS' = body.scheduled_start
    ? new Date(body.scheduled_start) <= now
      ? 'INPROGRESS'
      : 'SCHEDULED'
    : 'SCHEDULED';

  const { data: job, error: jobErr } = await svc
    .from('jobs')
    .insert({
      shop_id: shopId,
      quote_id: quote.id,
      client_id: quote.client_id,
      ref: jobRef,
      client_name: quote.client_name,
      project_title: quote.project_title,
      state: jobState,
      scheduled_start: body.scheduled_start ?? null,
      scheduled_end: body.scheduled_end ?? null,
      crew_summary: body.crew_summary ?? null,
      estimated_total: quote.total,
    })
    .select('id, ref')
    .single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'job insert failed' }, 500);

  await svc
    .from('quotes')
    .update({ state: 'WON', outcome_captured_at: now.toISOString() })
    .eq('id', quote.id);

  await svc.from('events').insert({
    shop_id: shopId,
    quote_id: quote.id,
    job_id: job.id,
    type: 'quote.won',
    actor: locals.user.email ?? 'user',
    payload: { job_ref: job.ref, scheduled_start: body.scheduled_start ?? null },
  });

  // Win/Loss agent: snapshot the quote at decision time, infer factors,
  // write a past_quote_summary chunk back into Context so future
  // similar scopes retrieve this win. Best-effort.
  try {
    await captureOutcome(env, svc, shopId, quote.id, 'won', null);
  } catch (e) {
    console.warn('[mark-won] winloss capture failed', e);
  }

  return json({ quote_id: quote.id, job }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
