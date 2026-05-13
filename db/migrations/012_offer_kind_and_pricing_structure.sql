-- 012_offer_kind_and_pricing_structure.sql
--
-- Renames the wizard's "Pricing" step to "Offer" in concept (the
-- old column names stay for backward compat — quote.margin_pct etc).
-- Adds three new axes the wizard now reasons about:
--
--   offer_kind         — Quote | Bid | Proposal | Contract
--                        Affects PDF header + email subject framing.
--                        ('contract' accepted but renders same as
--                        proposal in the v1 PDF — signature block
--                        deferred.)
--   pricing_structure  — fixed_price | itemized | phase_priced |
--                        time_and_materials | rebate_program
--                        Drives which editor renders on the Offer
--                        step + which section the PDF emits.
--
-- T&M pricing has its own input shape that doesn't fit line_items or
-- phases: rate cards + an hour estimate band + materials/
-- reimbursable estimate. Stored as two jsonb columns so we don't
-- need a separate table.
--
-- Auto-detect: the scan endpoint now classifies these alongside
-- proposal_style. Operator can override on the Offer step.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS offer_kind         text,
  ADD COLUMN IF NOT EXISTS pricing_structure  text,
  ADD COLUMN IF NOT EXISTS tm_rates           jsonb,
  ADD COLUMN IF NOT EXISTS tm_estimate        jsonb;

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_offer_kind_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_offer_kind_check
  CHECK (
    offer_kind IS NULL OR offer_kind IN ('quote','bid','proposal','contract')
  );

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_pricing_structure_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_pricing_structure_check
  CHECK (
    pricing_structure IS NULL OR pricing_structure IN (
      'fixed_price','itemized','phase_priced','time_and_materials','rebate_program'
    )
  );

-- Backfill defaults so existing rows show sensible labels.
-- Project-style proposals default to Quote + Itemized (Cavy seed),
-- partnerships → Proposal + Rebate program, etc.
UPDATE quotes
   SET offer_kind = CASE
         WHEN proposal_style = 'partnership'   THEN 'proposal'
         WHEN proposal_style = 'consulting'    THEN 'proposal'
         WHEN proposal_style = 'rfi_received'  THEN 'bid'
         WHEN proposal_style = 'novel'         THEN 'proposal'
         ELSE 'quote'
       END
 WHERE offer_kind IS NULL;

UPDATE quotes
   SET pricing_structure = CASE
         WHEN proposal_style = 'partnership'   THEN 'rebate_program'
         WHEN proposal_style = 'consulting'    THEN 'phase_priced'
         WHEN proposal_style = 'rfi_received'  THEN 'fixed_price'
         WHEN proposal_style = 'novel'         THEN 'fixed_price'
         ELSE 'itemized'
       END
 WHERE pricing_structure IS NULL;
