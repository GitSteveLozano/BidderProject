-- 007_context_chunks.sql
--
-- Context agent v1: the load-bearing one. Every downstream agent
-- (Intake, Offer, Composition, Win/Loss, Follow-up, Intelligence)
-- reads from here.
--
-- A "company profile" is a collection of typed text chunks owned by
-- a shop, each embedded for semantic retrieval. The chunk_type field
-- partitions the profile into orthogonal axes — voice, scope phrasing,
-- pricing rules, exclusions, past-quote summaries, template structure
-- (the last one is a Phase-2 concern for templated proposals; the
-- column accepts it now so we don't need a follow-up migration).
--
-- Embedding model: @cf/baai/bge-large-en-v1.5 (1024 dim, cosine).
-- Switching models means a re-embed pass — write the new vectors to a
-- second column and swap indexes; don't try to upgrade in place.
--
-- Retrieval is hybrid: (shop_id, chunk_type) filter + ivfflat cosine
-- on `embedding`. ivfflat with 100 lists is fine up through ~10k
-- chunks per shop (we'll hit that around 500 quotes); revisit when a
-- shop's chunk count crosses 25k.
--
-- Run this once in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS company_profile_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  -- Taxonomy. Open to new values via migration; the seven below cover
  -- everything Context v1 produces from Cavy's corpus.
  chunk_type    text NOT NULL CHECK (chunk_type IN (
    'voice_sample',        -- raw phrases the operator writes ("scratch coat")
    'scope_pattern',       -- per-service-line phrasings, grouped by category
    'pricing_rule',        -- default markup/margin/overhead and per-line drift
    'exclusion',           -- standard exclusions on this shop's quotes
    'service_definition',  -- what services this shop performs + descriptions
    'past_quote_summary',  -- 1-paragraph synopsis of an accepted/rejected quote
    'template_section'     -- (Phase 2) template-level patterns for non-itemized
                           --           proposals (Hardie-style "Why X?" intro etc.)
  )),

  -- Natural identifier so the seed can be idempotent without chasing
  -- UUIDs. Examples:
  --   'past_quote/Q-2026-0184'
  --   'voice/boilerplate_intro'
  --   'scope_pattern/stucco_conventional'
  -- Combined with (shop_id, chunk_type) for uniqueness.
  source_ref    text NOT NULL,

  content       text NOT NULL,
  embedding     vector(1024),

  -- Free-form sidecar: model, embedded_at, source quote/job ids,
  -- confidence scores, anything Context wants to inspect later
  -- without re-embedding.
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (shop_id, chunk_type, source_ref)
);

CREATE INDEX IF NOT EXISTS company_profile_chunks_shop_type_idx
  ON company_profile_chunks (shop_id, chunk_type);

CREATE INDEX IF NOT EXISTS company_profile_chunks_shop_recency_idx
  ON company_profile_chunks (shop_id, updated_at DESC);

-- Cosine distance index. The ivfflat operator class needs the column
-- to have at least one row before the index becomes useful; that's
-- fine — Postgres builds it empty and the planner uses it as soon as
-- rows arrive.
CREATE INDEX IF NOT EXISTS company_profile_chunks_embedding_idx
  ON company_profile_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS — tenant scoping via current_shop_id() helper from 001.
ALTER TABLE company_profile_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_profile_chunks_tenant_all ON company_profile_chunks
  FOR ALL
  USING (shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

CREATE TRIGGER company_profile_chunks_touch_updated_at
  BEFORE UPDATE ON company_profile_chunks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- Retrieval helper. Hybrid query in one SQL call: shop filter +
-- optional chunk_type filter + cosine distance + limit.
--
-- Caller passes the question embedding; this function does the math
-- and returns top-k chunks with their distance score so the caller
-- can decide whether to use them (distance < 0.6 is "relevant",
-- > 0.85 is "weakly related — probably skip").
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_company_profile(
  p_shop_id      uuid,
  p_query_embed  vector(1024),
  p_chunk_types  text[] DEFAULT NULL,
  p_limit        int    DEFAULT 8
) RETURNS TABLE (
  id          uuid,
  chunk_type  text,
  source_ref  text,
  content     text,
  metadata    jsonb,
  distance    float
) LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.chunk_type,
    c.source_ref,
    c.content,
    c.metadata,
    (c.embedding <=> p_query_embed)::float AS distance
  FROM company_profile_chunks c
  WHERE c.shop_id = p_shop_id
    AND c.embedding IS NOT NULL
    AND (p_chunk_types IS NULL OR c.chunk_type = ANY(p_chunk_types))
  ORDER BY c.embedding <=> p_query_embed
  LIMIT p_limit;
$$;
