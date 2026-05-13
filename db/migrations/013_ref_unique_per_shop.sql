-- 013_ref_unique_per_shop.sql
--
-- Bug: quotes.ref / jobs.ref / change_orders.ref are all globally
-- UNIQUE. The wizard generates refs like "Q-2026-0001" with a
-- per-shop counter (`count + 1` filtered by shop_id), so two
-- different shops both creating their first 2026 quote both try to
-- insert "Q-2026-0001" — the second one fails with
-- "duplicate key value violates unique constraint quotes_ref_key".
--
-- Same bug for jobs (mark-won flow) and change_orders.
--
-- Fix: drop the global UNIQUE constraint; replace with a composite
-- UNIQUE (shop_id, ref). The ref string then only has to be unique
-- within a single shop, which matches how the counter generates it.
-- Across shops, "Q-2026-0001" collisions are fine.
--
-- The application also retries the insert on conflict (see
-- /api/quote/save.ts), which handles the remaining within-shop race
-- where two simultaneous saves both compute the same count.
--
-- Run this once in the Supabase SQL editor.

-- ── quotes ────────────────────────────────────────────────────────
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_ref_key;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_shop_ref_key;
ALTER TABLE quotes ADD CONSTRAINT quotes_shop_ref_key UNIQUE (shop_id, ref);

-- ── jobs ──────────────────────────────────────────────────────────
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_ref_key;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_shop_ref_key;
ALTER TABLE jobs ADD CONSTRAINT jobs_shop_ref_key UNIQUE (shop_id, ref);

-- ── change_orders ─────────────────────────────────────────────────
ALTER TABLE change_orders DROP CONSTRAINT IF EXISTS change_orders_ref_key;
ALTER TABLE change_orders DROP CONSTRAINT IF EXISTS change_orders_shop_ref_key;
ALTER TABLE change_orders ADD CONSTRAINT change_orders_shop_ref_key UNIQUE (shop_id, ref);
