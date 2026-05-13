/**
 * Context agent.
 *
 * Owns each shop's company profile: voice patterns, scope phrasings,
 * pricing rules, exclusions, service definitions, past-quote
 * summaries, and (Phase 2) template structures. Every downstream
 * agent reads from here — Intake routes on it, Offer cites it,
 * Composition writes in it, Win/Loss feeds back into it.
 *
 * Storage: company_profile_chunks (migration 007), pgvector embeddings.
 * Retrieval: hybrid (shop filter + optional chunk_type filter +
 * cosine similarity) via the search_company_profile() SQL function.
 * Synthesis: Workers AI Llama 3.3 prompted with the top-k chunks as
 * context, asked to answer in the company's voice.
 *
 * The agent never invents company facts. If retrieval returns
 * weakly-related chunks (best distance > 0.85), synthesize() declines
 * with `confident: false` and a "I don't have enough signal" answer.
 * Hallucination resistance is enforced at the protocol level —
 * citations always trace back to chunk IDs.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { generateText } from './ai';
import { embed, toPgVector } from './embeddings';
import type { CloudflareEnv } from './supabase';

export type ChunkType =
  | 'voice_sample'
  | 'scope_pattern'
  | 'pricing_rule'
  | 'exclusion'
  | 'service_definition'
  | 'past_quote_summary'
  | 'template_section';

export interface ProfileChunk {
  id: string;
  shop_id: string;
  chunk_type: ChunkType;
  source_ref: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChunkInput {
  chunk_type: ChunkType;
  source_ref: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedChunk {
  id: string;
  chunk_type: ChunkType;
  source_ref: string;
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
}

export interface SynthesisResult {
  answer: string;
  confident: boolean;
  citations: Array<{ chunk_id: string; source_ref: string; chunk_type: ChunkType; distance: number }>;
  retrieved_count: number;
}

const RELEVANCE_THRESHOLD = 0.85; // cosine distance — anything beyond is "weakly related"

/**
 * Embed one chunk and upsert it. Idempotent on (shop_id, chunk_type,
 * source_ref) so seed scripts can re-run without dups.
 */
export async function upsertChunk(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  input: ChunkInput,
): Promise<{ id: string; embedded: boolean } | null> {
  const vec = await embed(env, input.content);
  const row: Record<string, unknown> = {
    shop_id: shopId,
    chunk_type: input.chunk_type,
    source_ref: input.source_ref,
    content: input.content,
    metadata: {
      ...(input.metadata ?? {}),
      embedded_at: vec ? new Date().toISOString() : null,
      embedding_model: vec ? '@cf/baai/bge-large-en-v1.5' : null,
    },
  };
  if (vec) row.embedding = toPgVector(vec);

  const { data, error } = await svc
    .from('company_profile_chunks')
    .upsert(row, { onConflict: 'shop_id,chunk_type,source_ref' })
    .select('id')
    .single();

  if (error) {
    console.warn('[context] upsertChunk failed', input.source_ref, error.message);
    return null;
  }
  return { id: data.id, embedded: vec != null };
}

/** Batch upsert. Embeds in parallel, writes sequentially (small N). */
export async function upsertChunks(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  inputs: ChunkInput[],
): Promise<{ upserted: number; embedded: number; failed: number }> {
  let upserted = 0;
  let embedded = 0;
  let failed = 0;
  for (const input of inputs) {
    const r = await upsertChunk(env, svc, shopId, input);
    if (!r) {
      failed += 1;
      continue;
    }
    upserted += 1;
    if (r.embedded) embedded += 1;
  }
  return { upserted, embedded, failed };
}

/**
 * Hybrid retrieval. Pass a question, get the top-k most-similar chunks
 * for that shop. Optionally restrict to certain chunk types.
 */
export async function retrieve(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  question: string,
  opts: { chunk_types?: ChunkType[]; limit?: number } = {},
): Promise<RetrievedChunk[]> {
  const vec = await embed(env, question);
  if (!vec) return [];
  const { data, error } = await svc.rpc('search_company_profile', {
    p_shop_id: shopId,
    p_query_embed: toPgVector(vec),
    p_chunk_types: opts.chunk_types ?? null,
    p_limit: opts.limit ?? 8,
  });
  if (error) {
    console.warn('[context] retrieve rpc failed', error.message);
    return [];
  }
  return (data ?? []) as RetrievedChunk[];
}

/**
 * Synthesize an answer to a question using the shop's profile.
 *
 * Strategy:
 *   1. Retrieve top-k chunks (default 8).
 *   2. If best distance > RELEVANCE_THRESHOLD, decline with confident=false.
 *   3. Otherwise build a prompt with chunks as numbered context, ask
 *      Llama for a concise answer that references chunks by number.
 *   4. Return synthesized text + citations array.
 */
export async function synthesize(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  question: string,
  opts: { chunk_types?: ChunkType[]; limit?: number; voiceMatched?: boolean } = {},
): Promise<SynthesisResult> {
  const chunks = await retrieve(env, svc, shopId, question, opts);
  if (chunks.length === 0) {
    return {
      answer: "I don't have enough company-profile signal to answer that yet. Seed Context first.",
      confident: false,
      citations: [],
      retrieved_count: 0,
    };
  }
  const best = chunks[0].distance;
  if (best > RELEVANCE_THRESHOLD) {
    return {
      answer:
        "I don't see anything in this shop's profile that directly answers that. Closest match was weakly related — better to leave this blank than guess.",
      confident: false,
      citations: chunks.map((c) => ({
        chunk_id: c.id,
        source_ref: c.source_ref,
        chunk_type: c.chunk_type,
        distance: c.distance,
      })),
      retrieved_count: chunks.length,
    };
  }

  const contextBlock = chunks
    .map(
      (c, i) =>
        `[${i + 1}] (${c.chunk_type}/${c.source_ref}) ${c.content}`,
    )
    .join('\n');

  const voiceLine = opts.voiceMatched
    ? 'Write in this shop\'s voice — match the tone you see in the voice_sample chunks (direct, operator-to-operator, no jargon).'
    : 'Write a concise, factual answer. No hedging beyond what the source supports.';

  const system = `You answer questions about a contractor's business using their
own profile chunks as the only source of truth. Rules:
- Only assert things supported by the chunks below. If a question goes
  beyond them, say so plainly.
- Reference chunks inline by number: "[1]", "[3]".
- Keep answers under 6 sentences unless the question requires more.
- ${voiceLine}`;

  const user = `Question: ${question}

Profile chunks:
${contextBlock}

Answer:`;

  const answer = await generateText(env, {
    max_tokens: 500,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  return {
    answer: answer.trim() || '(no answer generated)',
    confident: true,
    citations: chunks.map((c) => ({
      chunk_id: c.id,
      source_ref: c.source_ref,
      chunk_type: c.chunk_type,
      distance: c.distance,
    })),
    retrieved_count: chunks.length,
  };
}

/** Summary counts per chunk type for inspection UI. */
export async function profileSummary(
  svc: SupabaseClient,
  shopId: string,
): Promise<Array<{ chunk_type: ChunkType; count: number; last_updated: string | null }>> {
  const { data, error } = await svc
    .from('company_profile_chunks')
    .select('chunk_type, updated_at')
    .eq('shop_id', shopId);
  if (error || !data) return [];
  const byType = new Map<ChunkType, { count: number; last_updated: string | null }>();
  for (const row of data) {
    const ct = row.chunk_type as ChunkType;
    const existing = byType.get(ct) ?? { count: 0, last_updated: null };
    existing.count += 1;
    if (!existing.last_updated || row.updated_at > existing.last_updated) {
      existing.last_updated = row.updated_at as string;
    }
    byType.set(ct, existing);
  }
  return Array.from(byType.entries()).map(([chunk_type, v]) => ({
    chunk_type,
    count: v.count,
    last_updated: v.last_updated,
  }));
}
