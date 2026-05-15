-- 017_image_upload_source.sql
--
-- Phase 6: vision pilot. Adds 'image_upload' to the intake_documents
-- source_kind CHECK constraint so the Llama 3.2 Vision pipeline can
-- persist its results alongside text-extracted PDFs.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE intake_documents
  DROP CONSTRAINT IF EXISTS intake_documents_source_kind_check;

ALTER TABLE intake_documents
  ADD CONSTRAINT intake_documents_source_kind_check
  CHECK (source_kind IN (
    'pdf_upload',
    'pasted_text',
    'voice_transcript',
    'email_body',
    'manual_entry',
    'image_upload'
  ));
