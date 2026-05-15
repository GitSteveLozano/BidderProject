-- 016_cost_records.sql
--
-- Phase 3 of the multi-doc-intake refactor. Cost basis from vendor
-- invoices.
--
-- When an inbound document is classified as `vendor_invoice`, the
-- Intake agent extracts line items into cost_records. The Offer agent
-- then has historical cost data when pricing new quotes — margin-
-- aware suggestions instead of operator-typed estimates.
--
-- A cost_record may be:
--   • job-attached (project_id NOT NULL) — material/labor for one job
--   • shop-general (project_id NULL)    — a routine vendor receipt the
--     operator wants tracked but didn't attach to a project
--
-- Run once in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS cost_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  project_id            uuid REFERENCES projects(id) ON DELETE SET NULL,
  source_document_id    uuid REFERENCES intake_documents(id) ON DELETE SET NULL,

  vendor_name           text,
  invoice_number        text,
  invoice_date          date,

  -- Line item details
  sku                   text,
  description           text NOT NULL,
  category              text, -- 'drywall' | 'paint' | 'tile' | 'lumber' | 'hardware' | 'roofing' | 'plumbing' | 'electrical' | 'flooring' | 'fixtures' | 'labor' | 'rental' | 'other'

  quantity              numeric(14,4),
  unit                  text, -- 'ea', 'sf', 'lf', 'sy', 'cy', 'hr', 'box', 'roll', 'pallet', etc.
  unit_cost             numeric(14,4),
  total_cost            numeric(14,2) NOT NULL,

  -- Embedding of (vendor + description + category) — lets the Offer
  -- agent find "similar materials I've bought before" via cosine.
  embedding             vector(1024),

  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_records_shop_recency_idx
  ON cost_records (shop_id, invoice_date DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS cost_records_project_idx
  ON cost_records (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cost_records_source_doc_idx
  ON cost_records (source_document_id) WHERE source_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cost_records_shop_category_idx
  ON cost_records (shop_id, category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS cost_records_embedding_idx
  ON cost_records USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE cost_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_records_tenant_all ON cost_records;
CREATE POLICY cost_records_tenant_all ON cost_records
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

DROP TRIGGER IF EXISTS cost_records_touch_updated_at ON cost_records;
CREATE TRIGGER cost_records_touch_updated_at
  BEFORE UPDATE ON cost_records
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- Cost-similarity lookup for the Offer agent.
-- "What have I paid for items like this?" — top N by cosine within
-- the shop, optionally filtered to a category. Returns recent costs
-- so the Offer agent can estimate margin against current pricing.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_cost_records(
  p_shop_id   uuid,
  p_query     vector(1024),
  p_category  text DEFAULT NULL,
  p_limit     int  DEFAULT 10
) RETURNS TABLE (
  id            uuid,
  description   text,
  category      text,
  vendor_name   text,
  quantity      numeric,
  unit          text,
  unit_cost     numeric,
  total_cost    numeric,
  invoice_date  date,
  distance      float
) LANGUAGE sql STABLE AS $$
  SELECT
    c.id, c.description, c.category, c.vendor_name,
    c.quantity, c.unit, c.unit_cost, c.total_cost, c.invoice_date,
    (c.embedding <=> p_query)::float AS distance
  FROM cost_records c
  WHERE c.shop_id = p_shop_id
    AND c.embedding IS NOT NULL
    AND (p_category IS NULL OR c.category = p_category)
  ORDER BY c.embedding <=> p_query
  LIMIT p_limit;
$$;

-- ───────────────────────────────────────────────────────────────────
-- Aggregate by category for a project — powers the "vendor costs to
-- date" surface on the project detail page + Offer agent context.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_cost_summary(p_project_id uuid)
RETURNS TABLE (
  category    text,
  line_count  int,
  subtotal    numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(c.category, 'uncategorized') AS category,
    COUNT(*)::int AS line_count,
    SUM(c.total_cost)::numeric AS subtotal
  FROM cost_records c
  WHERE c.project_id = p_project_id
  GROUP BY 1
  ORDER BY subtotal DESC NULLS LAST;
$$;
