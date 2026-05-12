-- 003_business_noun.sql
--
-- Brief was originally contractor-coded (the docstrings literally say
-- "specialty contractor") so "Shop" was wired in as the section
-- header + body-copy noun everywhere. Adding business_noun as a
-- per-shop override so agency / studio / practice / firm operators
-- see their own word. Default stays 'shop' so contractor users see
-- no change.
--
-- Run this once in the Supabase SQL editor.

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS business_noun text NOT NULL DEFAULT 'shop';
