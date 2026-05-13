-- 010_rfi_response_and_phase_fees.sql
--
-- Phase 2 of the multi-proposal-type widening. Migration 009 added
-- the proposal-style metadata; this one adds the columns + shapes
-- that the two new editor flows need:
--
-- (1) phases jsonb shape extended (no DDL — it's already jsonb).
--     The new accepted shape is:
--       [{ name, deliverables[], duration, fee }]
--     where `fee` is a number; phase fees sum to the quote total
--     when proposal_style is consulting/partnership and there are
--     no line items.
--
-- (2) rfi_response jsonb on quotes. Used when proposal_style =
--     rfi_received. Shape:
--       {
--         requirements_answered: [{ requirement, response }],
--         questions_answered:    [{ question, answer }],
--         narrative_sections:    [{ heading, body }],
--         cover_letter:          string,
--         submission_format:     string
--       }
--     All keys optional — operator fills what the RFI asks for.
--
-- (3) composition_drafts.kind widened to include 'rfi_section' so
--     the Composition agent can draft individual answers in voice.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS rfi_response jsonb;

ALTER TABLE composition_drafts DROP CONSTRAINT IF EXISTS composition_drafts_kind_check;
ALTER TABLE composition_drafts ADD CONSTRAINT composition_drafts_kind_check
  CHECK (kind IN (
    'cover_note','scope_narrative','exclusions','terms','closing','full_proposal',
    'rfi_section'
  ));
