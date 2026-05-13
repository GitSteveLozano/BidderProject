/**
 * POST /api/context/query
 *
 * Ask the Context agent a question about the shop. Used by downstream
 * agents and the UI inspector. Body: { question, chunk_types?, voiceMatched? }.
 * Returns synthesized answer + citations + retrieval metadata.
 */
import type { APIRoute } from 'astro';

import { synthesize, type ChunkType } from '@/lib/context';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const VALID_TYPES: ChunkType[] = [
  'voice_sample',
  'scope_pattern',
  'pricing_rule',
  'exclusion',
  'service_definition',
  'past_quote_summary',
  'template_section',
];

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: { question?: string; chunk_types?: string[]; voiceMatched?: boolean; limit?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.question || body.question.trim().length < 4) {
    return json({ error: 'question required' }, 400);
  }
  const types = Array.isArray(body.chunk_types)
    ? (body.chunk_types.filter((t): t is ChunkType => VALID_TYPES.includes(t as ChunkType)))
    : undefined;

  const svc = supabaseService(env, 'service');
  const result = await synthesize(env, svc, locals.membership.shop_id, body.question, {
    chunk_types: types,
    limit: typeof body.limit === 'number' ? body.limit : 8,
    voiceMatched: body.voiceMatched === true,
  });
  return json(result, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
