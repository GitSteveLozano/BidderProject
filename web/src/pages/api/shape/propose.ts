/**
 * POST /api/shape/propose
 *
 * The 5th-path entry point. Given some doc text, returns either:
 *   - a saved shape from the shop's library if one matches closely
 *     enough (embedding similarity)
 *   - a freshly proposed shape from the LLM otherwise
 *
 * The returned payload always includes `prefilled` — the sections
 * with content lifted from the source so the operator's editor
 * isn't empty.
 *
 * Body: { text, client_name?, project_title? }
 * Returns: {
 *   source: 'matched' | 'proposed',
 *   shape_id?: string,        // when matched
 *   shape: Shape,             // the bare shape (name, description, sections, total_required)
 *   prefilled: Shape,         // same shape with sections content populated
 *   match_distance?: number,
 * }
 */
import type { APIRoute } from 'astro';

import { proposeShape, prefillShape } from '@/lib/shape-proposer';
import { findClosestShape } from '@/lib/shape-matcher';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: { text?: string; client_name?: string; project_title?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.text || body.text.trim().length < 40) {
    return json({ error: 'text too short to propose a shape' }, 400);
  }

  const svc = supabaseService(env, 'service');

  // 1. Match against the shop's saved shapes first.
  const matched = await findClosestShape(env, svc, locals.membership.shop_id, body.text);

  let chosen = matched?.shape;
  let source: 'matched' | 'proposed' = matched ? 'matched' : 'proposed';

  // 2. Fall through to LLM-proposed shape.
  if (!chosen) {
    chosen = (await proposeShape(env, body.text, {
      client_name: body.client_name,
      project_title: body.project_title,
    })) ?? undefined;
    source = 'proposed';
  }
  if (!chosen) return json({ error: 'Could not propose a shape' }, 502);

  // 3. Prefill the sections from the source doc.
  const prefilled = await prefillShape(env, chosen, body.text);

  return json(
    {
      source,
      shape_id: matched?.id,
      shape: chosen,
      prefilled,
      match_distance: matched?.distance,
    },
    200,
  );
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
