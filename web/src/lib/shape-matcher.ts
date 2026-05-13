/**
 * Shape matcher — embedding-based lookup of saved shapes.
 *
 * On novel-path intake, before asking the LLM to propose a fresh
 * shape, see if the shop already has a saved shape that matches.
 * Same-shape distance is usually < 0.4; > 0.6 means "different shape,
 * propose new."
 *
 * Embedding query text comes from the source doc (first ~600 chars
 * of the operator-typed scope or the extracted PDF text). The shape
 * registry stores embeddings of name + description + section labels
 * — close documents will land near similar shapes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { embed, toPgVector } from './embeddings';
import { normalizeShape, type Shape } from './shape';
import type { CloudflareEnv } from './supabase';

const SAME_SHAPE_THRESHOLD = 0.45;

export interface MatchedShape {
  id: string;
  shape: Shape;
  distance: number;
  source: 'builtin' | 'shop' | 'global';
}

/** Find the closest saved shape, if any. Returns null when no shape
 * is within SAME_SHAPE_THRESHOLD — caller should fall through to the
 * proposer. */
export async function findClosestShape(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  queryText: string,
): Promise<MatchedShape | null> {
  if (!env.AI) return null;
  const vec = await embed(env, queryText.slice(0, 1200));
  if (!vec) return null;

  const { data, error } = await svc.rpc('search_proposal_shapes', {
    p_shop_id: shopId,
    p_query: toPgVector(vec),
    p_limit: 3,
  });
  if (error || !data || data.length === 0) {
    if (error) console.warn('[shape-matcher] rpc failed', error.message);
    return null;
  }
  const best = (data as Array<{
    id: string;
    name: string;
    description: string | null;
    sections: unknown;
    total_required: boolean;
    source: 'builtin' | 'shop' | 'global';
    distance: number;
  }>)[0];

  if (best.distance > SAME_SHAPE_THRESHOLD) return null;

  const shape = normalizeShape({
    name: best.name,
    description: best.description ?? '',
    sections: best.sections,
    total_required: best.total_required,
  });
  if (!shape) return null;

  return { id: best.id, shape, distance: best.distance, source: best.source };
}
