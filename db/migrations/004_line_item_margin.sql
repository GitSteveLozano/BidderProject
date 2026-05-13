-- 004_line_item_margin.sql
--
-- Per-line margin overrides. Brief's pricing model used to apply one
-- shop-default markup to the whole quote. Operators wanted per-line
-- control (labor margin ≠ materials margin) without losing the
-- one-slider default for simple jobs.
--
-- `margin_pct` is nullable: NULL means "use the quote-level
-- quotes.margin_pct". A row only carries a number when the operator
-- explicitly overrides that line's margin in the Pricing step.
--
-- Run this once in the Supabase SQL editor.

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS margin_pct numeric(5,2);
