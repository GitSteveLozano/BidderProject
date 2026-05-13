/**
 * Workers AI embeddings.
 *
 * Wraps env.AI.run() for the BGE-large model so callers don't need to
 * remember the model id, the input shape (`{ text: string | string[] }`),
 * or the response shape (`{ data: number[][] }`). Used by lib/context.ts
 * to embed chunks at write time and queries at read time.
 *
 * Model: @cf/baai/bge-large-en-v1.5 — 1024 dim, English-only, top of the
 * leaderboard for retrieval at this size class. The DB column is
 * vector(1024); switching to a different dim means re-embedding the
 * whole profile.
 */
import type { CloudflareEnv } from './supabase';

export const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
export const EMBEDDING_DIM = 1024;

interface BgeResponse {
  data?: number[][];
  shape?: number[];
}

/** Embed a single string. Returns null on failure (binding missing,
 * AI error, malformed response) so callers can decide whether to
 * skip the chunk or surface the failure. */
export async function embed(env: CloudflareEnv, text: string): Promise<number[] | null> {
  if (!env.AI) return null;
  const clean = text.trim();
  if (!clean) return null;
  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, { text: clean })) as BgeResponse;
    const vec = result?.data?.[0];
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null;
    return vec;
  } catch (e) {
    console.warn('[embeddings] embed failed', e);
    return null;
  }
}

/** Embed many strings in one call. Workers AI accepts batched input
 * and returns one row per input. Returns parallel array of vectors;
 * null entries for any that failed dimension check. */
export async function embedMany(
  env: CloudflareEnv,
  texts: string[],
): Promise<Array<number[] | null>> {
  if (!env.AI || texts.length === 0) return texts.map(() => null);
  const cleaned = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return texts.map(() => null);
  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, { text: cleaned })) as BgeResponse;
    const rows = result?.data ?? [];
    let i = 0;
    return texts.map((t) => {
      if (!t.trim()) return null;
      const vec = rows[i++];
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null;
      return vec;
    });
  } catch (e) {
    console.warn('[embeddings] embedMany failed', e);
    return texts.map(() => null);
  }
}

/** Postgres' pgvector format wants `[a,b,c]` literal text, not a JS
 * array. Supabase's PostgREST sends arrays as JSON which pgvector
 * rejects with "malformed array literal"; format it as the vector
 * literal explicitly. */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
