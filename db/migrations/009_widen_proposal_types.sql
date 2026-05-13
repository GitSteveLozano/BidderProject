-- 009_widen_proposal_types.sql
--
-- Widen the schema so Brief handles proposal styles beyond Cavy's
-- itemized contractor quotes. The five reference samples we've
-- analyzed (Cavy itemized, Hardie/Deveraux/Matix partnership pitches,
-- Paras GTM consulting, uOttawa inbound RFI) all need to flow through
-- the same intake → review → send pipeline without their structure
-- getting truncated to fit the construction shape.
--
-- Three families of change:
--
-- (1) Widen quote_line_items.unit + .category CHECK constraints.
--     The construction-coded set (each/hr/sqft/lf/cy/day/lump_sum and
--     labor/materials/subs/permits/equipment/other) doesn't cover
--     rebates, monthly retainers, consulting phases, training, etc.
--
-- (2) Same widening on change_order_line_items so mid-job adds match.
--
-- (3) New columns on quotes for proposal-level shape that doesn't
--     belong in line items:
--       proposal_style — project_quote | partnership | consulting |
--                        rfi_received | unknown
--       program_type   — one_off | recurring | rebate
--       term_months    — for multi-period agreements (rebates, retainers)
--       phases         — jsonb [{ name, deliverables[], duration }]
--                        for consulting + partnership narratives that
--                        don't decompose to line items
--
-- (4) Re-align intake_documents.classification to the same vocabulary
--     so /api/intake/classify and /api/quote/scan agree.
--
-- Run once in the Supabase SQL editor.

-- ───────────────────────────────────────────────────────────────────
-- (1) quote_line_items — widened units + categories
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE quote_line_items DROP CONSTRAINT IF EXISTS quote_line_items_unit_check;
ALTER TABLE quote_line_items ADD CONSTRAINT quote_line_items_unit_check
  CHECK (
    unit IS NULL OR unit IN (
      -- construction
      'each','hr','sqft','lf','cy','day','lump_sum',
      -- supplier / wholesale
      'msf','per_home','pct',
      -- services / consulting
      'month','phase','project','package','retainer'
    )
  );

ALTER TABLE quote_line_items DROP CONSTRAINT IF EXISTS quote_line_items_category_check;
ALTER TABLE quote_line_items ADD CONSTRAINT quote_line_items_category_check
  CHECK (
    category IS NULL OR category IN (
      -- construction
      'labor','materials','subs','permits','equipment',
      -- services / agency
      'services','strategy','production',
      -- supplier programs
      'rebate','marketing_support','training','discount',
      -- recurring
      'subscription',
      'other'
    )
  );

-- ───────────────────────────────────────────────────────────────────
-- (2) change_order_line_items — same widening
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE change_order_line_items DROP CONSTRAINT IF EXISTS change_order_line_items_unit_check;
ALTER TABLE change_order_line_items ADD CONSTRAINT change_order_line_items_unit_check
  CHECK (
    unit IS NULL OR unit IN (
      'each','hr','sqft','lf','cy','day','lump_sum',
      'msf','per_home','pct',
      'month','phase','project','package','retainer'
    )
  );

ALTER TABLE change_order_line_items DROP CONSTRAINT IF EXISTS change_order_line_items_category_check;
ALTER TABLE change_order_line_items ADD CONSTRAINT change_order_line_items_category_check
  CHECK (
    category IS NULL OR category IN (
      'labor','materials','subs','permits','equipment',
      'services','strategy','production',
      'rebate','marketing_support','training','discount',
      'subscription',
      'other'
    )
  );

-- ───────────────────────────────────────────────────────────────────
-- (3) quotes — proposal-level columns
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS proposal_style text,
  ADD COLUMN IF NOT EXISTS program_type   text,
  ADD COLUMN IF NOT EXISTS term_months    integer,
  ADD COLUMN IF NOT EXISTS phases         jsonb;

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_proposal_style_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_proposal_style_check
  CHECK (
    proposal_style IS NULL OR proposal_style IN (
      'project_quote','partnership','consulting','rfi_received','unknown'
    )
  );

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_program_type_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_program_type_check
  CHECK (
    program_type IS NULL OR program_type IN ('one_off','recurring','rebate')
  );

-- Default existing rows to 'project_quote' since the seed + every
-- pre-009 quote is contractor-itemized.
UPDATE quotes
   SET proposal_style = 'project_quote',
       program_type   = 'one_off'
 WHERE proposal_style IS NULL;

-- ───────────────────────────────────────────────────────────────────
-- (4) intake_documents — re-align classification to the canonical
--     vocabulary the scan endpoint emits.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE intake_documents DROP CONSTRAINT IF EXISTS intake_documents_classification_check;
ALTER TABLE intake_documents ADD CONSTRAINT intake_documents_classification_check
  CHECK (classification IN (
    'project_quote',
    'partnership',
    'consulting',
    'rfi_received',
    'change_request',
    'unknown'
  ));

-- Existing rows used the longer names — translate.
UPDATE intake_documents
   SET classification = CASE classification
     WHEN 'itemized_project_quote'        THEN 'project_quote'
     WHEN 'templated_partnership_pitch'   THEN 'partnership'
     WHEN 'narrative_consulting_proposal' THEN 'consulting'
     WHEN 'inbound_rfi'                   THEN 'rfi_received'
     ELSE classification
   END;
