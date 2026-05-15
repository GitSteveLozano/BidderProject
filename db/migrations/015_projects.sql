-- 015_projects.sql
--
-- Phase 2 of the multi-doc-intake refactor. Introduces projects as
-- the pre-win container. Existing model:
--
--   intake_documents → quotes → (mark won) → jobs
--
-- New model:
--
--   intake_documents ─┐
--                     ├─ projects ─ (operator drafts) ─ quotes ─ jobs
--   (other docs) ─────┘
--
-- A project groups everything related to one address / client / scope
-- of work: plans, selections, vendor invoices, the scoping email
-- thread, plus eventually the operator's quotes + (after win) the job.
--
-- Status state machine — coarse for now; refined as phases ship:
--   intake      → operator has uploaded docs, nothing scoped yet
--   scoped      → Brief has read + classified all docs
--   quoted      → at least one outbound quote exists
--   won / lost  → terminal pre-job
--   in_progress → after mark-won, a job has been spawned
--   done        → job closed
--
-- Embedding column powers auto-grouping at upload time. We embed
-- (name + address + first 600 chars of any attached doc); a new
-- doc's embedding compared via pgvector cosine surfaces likely
-- project matches (Phase 2 multi-upload UI).
--
-- Run once in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,

  name            text NOT NULL,
  address         text,
  description     text,

  status          text NOT NULL DEFAULT 'intake'
      CHECK (status IN ('intake','scoped','quoted','won','lost','in_progress','done')),

  -- Used by auto-group: a new upload's embedding compared to these
  -- via cosine. Embedding text = name + address + scope_summary +
  -- first ~600 chars of the strongest doc.
  embedding       vector(1024),

  -- Sidecar — operator notes, derived hints, anything we don't want
  -- to mint a column for yet.
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_shop_recency_idx
  ON projects (shop_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS projects_shop_status_idx
  ON projects (shop_id, status);
CREATE INDEX IF NOT EXISTS projects_embedding_idx
  ON projects USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_tenant_all ON projects;
CREATE POLICY projects_tenant_all ON projects
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

DROP TRIGGER IF EXISTS projects_touch_updated_at ON projects;
CREATE TRIGGER projects_touch_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- Tie-ins. intake_documents + quotes both get a nullable project_id.
-- A null means "not yet associated" — pre-Phase-2 quotes (and any
-- standalone uploads that happen later) work fine without one.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE intake_documents
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS intake_documents_project_idx
  ON intake_documents (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotes_project_idx
  ON quotes (project_id) WHERE project_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────
-- Embedding-similarity helper for auto-grouping.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_projects(
  p_shop_id   uuid,
  p_query     vector(1024),
  p_limit     int DEFAULT 5
) RETURNS TABLE (
  id          uuid,
  name        text,
  address     text,
  status      text,
  distance    float
) LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.name,
    p.address,
    p.status,
    (p.embedding <=> p_query)::float AS distance
  FROM projects p
  WHERE p.shop_id = p_shop_id
    AND p.embedding IS NOT NULL
  ORDER BY p.embedding <=> p_query
  LIMIT p_limit;
$$;
