/**
 * POST /api/shape/save
 *
 * Persist a shape to the shop's library so future similar docs
 * auto-route to it. Called from the wizard after a novel-path quote
 * sends successfully — the operator confirms "Save this layout as
 * 'X' for next time" and we land it here.
 *
 * Body: { name, description?, sections, total_required }
 * Returns: { id }
 *
 * Idempotency: upsert on (shop_id, name). Re-saving with the same
 * name updates the existing row + bumps usage_count.
 */
import type { APIRoute } from 'astro';

import { embed, toPgVector } from '@/lib/embeddings';
import { normalizeShape, shapeToEmbeddingText } from '@/lib/shape';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const shape = normalizeShape(body);
  if (!shape) return json({ error: 'Invalid shape payload' }, 400);

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  const vec = await embed(env, shapeToEmbeddingText(shape));
  const row: Record<string, unknown> = {
    shop_id: shopId,
    name: shape.name,
    description: shape.description,
    sections: shape.sections,
    total_required: shape.total_required,
    source: 'shop',
    created_by: locals.user.id ?? null,
  };
  if (vec) row.embedding = toPgVector(vec);

  // Upsert on (shop_id, name) — operator re-saving with same name
  // overwrites. Separate names = separate library entries.
  const { data: existing } = await svc
    .from('proposal_shapes')
    .select('id, usage_count')
    .eq('shop_id', shopId)
    .eq('name', shape.name)
    .maybeSingle();

  if (existing) {
    const { error } = await svc
      .from('proposal_shapes')
      .update({ ...row, usage_count: (existing.usage_count ?? 0) + 1 })
      .eq('id', existing.id);
    if (error) return json({ error: error.message }, 500);
    return json({ id: existing.id, updated: true }, 200);
  }

  const { data, error } = await svc
    .from('proposal_shapes')
    .insert({ ...row, usage_count: 1 })
    .select('id')
    .single();
  if (error || !data) return json({ error: error?.message ?? 'insert failed' }, 500);
  return json({ id: data.id, updated: false }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
