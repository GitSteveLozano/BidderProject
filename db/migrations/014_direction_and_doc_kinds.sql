-- 014_direction_and_doc_kinds.sql
--
-- Phase 1 of the multi-doc-intake refactor. Two changes:
--
-- 1. intake_documents.direction — every doc has a direction:
--      'outbound'      operator → client (today's 5 proposal styles)
--      'inbound'       client / GC / designer → operator (plans,
--                      selections, RFI received, designer email)
--      'operator_own'  operator's own records (vendor invoices,
--                      spec templates they reuse)
--    The wizard branches on this: outbound goes to the quote
--    editor; inbound + operator_own go to a project file (Phase 2).
--    Without this column, plan PDFs are silently mis-classified as
--    project_quotes with zero line items.
--
-- 2. intake_documents.classification widened. The original five
--    values (project_quote / partnership / consulting / rfi_received
--    / change_request / unknown) only cover outbound proposals. New
--    inbound + operator_own classes:
--      architectural_plan, elevation_drawing, engineer_sealed,
--      spec_template, takeoff, vendor_invoice, selections_list,
--      email_thread.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE intake_documents
  ADD COLUMN IF NOT EXISTS direction text;

ALTER TABLE intake_documents DROP CONSTRAINT IF EXISTS intake_documents_direction_check;
ALTER TABLE intake_documents ADD CONSTRAINT intake_documents_direction_check
  CHECK (direction IS NULL OR direction IN ('outbound','inbound','operator_own'));

-- Backfill direction for existing rows by mapping the existing
-- classification. Everything in the old taxonomy was an outbound
-- proposal except 'rfi_received' (inbound).
UPDATE intake_documents
   SET direction = CASE classification
     WHEN 'rfi_received' THEN 'inbound'
     ELSE 'outbound'
   END
 WHERE direction IS NULL;

-- Widen the classification CHECK to include the new doc kinds.
ALTER TABLE intake_documents DROP CONSTRAINT IF EXISTS intake_documents_classification_check;
ALTER TABLE intake_documents ADD CONSTRAINT intake_documents_classification_check
  CHECK (classification IN (
    -- outbound (operator-authored proposals)
    'project_quote',
    'partnership',
    'consulting',
    'rfi_received',      -- a buyer's RFI sitting in front of an operator (inbound)
    'change_request',
    -- inbound (sent to the operator)
    'architectural_plan',     -- structural / floor plans / full sets
    'elevation_drawing',      -- façade with material callouts
    'engineer_sealed',        -- stamped drawings, dimension-only
    'spec_template',          -- builder spec sheet with $ allowances
    'takeoff',                -- quantity survey
    'selections_list',        -- homeowner finishes
    'email_thread',           -- multi-message scoping conversation
    -- operator-own
    'vendor_invoice',         -- operator's cost records
    -- catch-all
    'unknown'
  ));
