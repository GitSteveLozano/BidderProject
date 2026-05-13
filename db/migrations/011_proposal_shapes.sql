-- 011_proposal_shapes.sql
--
-- The 5th proposal "shape" — novel / freeform. When Intake can't
-- match a doc to one of the four fast-path styles (project_quote,
-- partnership, consulting, rfi_received) with high confidence, the
-- system proposes a custom layout (sections) on the fly. The
-- operator confirms in one click; the wizard renders a generic
-- editor; the PDF renders from the same section descriptors.
--
-- Saved shapes accumulate per shop. Future docs that match a saved
-- shape (embedding similarity > threshold) skip the proposer and
-- jump straight to the matched layout. That's how the library grows
-- without engineering per new doc type.
--
-- Shape data model:
--   sections jsonb is an array of:
--     { kind: 'text',     key, label, body }
--     { kind: 'bullets',  key, label, items[] }
--     { kind: 'kv_table', key, label, headers[3], rows[{ ... }] }
--   total_required is a coarse gate hint — most novel shapes don't
--   require a money total.
--
-- shop_id NULL means "global / built-in" — reserved for shapes we
-- promote later. Today all shapes are shop-private.
--
-- Run once in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS proposal_shapes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid REFERENCES shops(id) ON DELETE CASCADE,

  name            text NOT NULL,                       -- 'rebate program proposal'
  description     text,                                -- 'supplier-to-customer pitch with rebate rates'

  -- Source: builtin (seeded), shop (operator-created), global (promoted)
  source          text NOT NULL DEFAULT 'shop'
      CHECK (source IN ('builtin','shop','global')),

  sections        jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_required  boolean NOT NULL DEFAULT false,

  -- Embedding for similarity matching at intake time. Embed the
  -- shape's name + description + section labels.
  embedding       vector(1024),

  usage_count     integer NOT NULL DEFAULT 0,
  created_by      uuid,                                -- auth.uid()
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_shapes_shop_idx
  ON proposal_shapes (shop_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS proposal_shapes_embedding_idx
  ON proposal_shapes
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

ALTER TABLE proposal_shapes ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposal_shapes_tenant_all ON proposal_shapes
  FOR ALL
  USING (shop_id IS NULL OR shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

CREATE TRIGGER proposal_shapes_touch_updated_at
  BEFORE UPDATE ON proposal_shapes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- Quote-level tie-in. shape_id points at the chosen shape (NULL when
-- the quote uses one of the four fast-path proposal_styles). The
-- sections_data column holds the operator-edited content of each
-- section so the PDF render can rebuild the proposal verbatim.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS shape_id      uuid REFERENCES proposal_shapes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sections_data jsonb;

-- Allow 'novel' as a proposal_style value alongside the four
-- existing ones, so the wizard can route on style alone.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_proposal_style_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_proposal_style_check
  CHECK (
    proposal_style IS NULL OR proposal_style IN (
      'project_quote','partnership','consulting','rfi_received','novel','unknown'
    )
  );

-- ───────────────────────────────────────────────────────────────────
-- Similarity helper: find shop's shapes closest to a query embedding.
-- Used by the matcher at intake time.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_proposal_shapes(
  p_shop_id   uuid,
  p_query     vector(1024),
  p_limit     int DEFAULT 5
) RETURNS TABLE (
  id          uuid,
  name        text,
  description text,
  sections    jsonb,
  total_required boolean,
  source      text,
  distance    float
) LANGUAGE sql STABLE AS $$
  SELECT
    s.id,
    s.name,
    s.description,
    s.sections,
    s.total_required,
    s.source,
    (s.embedding <=> p_query)::float AS distance
  FROM proposal_shapes s
  WHERE (s.shop_id = p_shop_id OR s.shop_id IS NULL)
    AND s.embedding IS NOT NULL
  ORDER BY s.embedding <=> p_query
  LIMIT p_limit;
$$;
