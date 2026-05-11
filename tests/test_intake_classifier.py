"""Tests for the cheap heuristic in pdf_extraction.classify_document_hint."""
from __future__ import annotations

from tools.pdf_extraction import classify_document_hint


class TestFilenameHints:
    def test_rfp_in_filename(self):
        assert classify_document_hint("ABC-Project-RFP.pdf", "") == "rfp"

    def test_drawings_filename(self):
        assert classify_document_hint("A-201-Drawing.pdf", "") == "drawings"

    def test_change_filename(self):
        assert classify_document_hint("change-order-3.pdf", "") == "change_request"


class TestTextHints:
    def test_email_sample(self):
        text = "Subject: Stucco quote needed\nFrom: gc@example.com\n\nHey, can you bid this..."
        assert classify_document_hint("attachment.txt", text) == "scope_email"

    def test_past_quote_with_exclusions_and_warranty(self):
        text = "Scope of work...\nExcluded:\n- painting\n\nWarranty: 1 year."
        assert classify_document_hint("quote.txt", text) == "past_quote"
