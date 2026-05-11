"""Intake agent tests.

Spec §5.2: Intake parses uploaded documents into structured JSON with a
confidence score. The agent's behavior contract:
- Output is always valid JSON (handled by complete_json + fallback)
- Below-threshold confidence flags for human review
- Document type hint flows through to the prompt
- All five document types (past_quote, rfp, drawings, scope_email,
  change_request) listed in the schema

These tests stub complete_json so they don't hit the API.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def captured_intake(monkeypatch):
    """Capture every call to complete_json and return what we configure.

    Also stubs `get_client` so the `messages.parse()` preferred path
    raises AttributeError (FakeMessages has no `.parse`) and the
    fallback to `complete_json` fires — exactly the older-SDK path.
    Otherwise the real Anthropic client tries to authenticate and
    fails with TypeError when no API key is set.
    """
    captured: list[dict] = []
    next_response: dict = {
        "document_classification": "past_quote",
        "client_info": {"client_name": "ACME", "client_address": None, "project_name": None},
        "service_line_hint": "STUCCO-CONVENTIONAL",
        "scope_items": [{"description": "stucco", "quantity": 2400, "unit": "sqft"}],
        "exclusions_mentioned": ["Rough grade..."],
        "inclusions_mentioned": [],
        "pricing_mentioned": {"total": 36400, "currency": "USD"},
        "deadline": None,
        "addenda_or_changes": [],
        "confidence_score": 0.85,
    }

    import core.anthropic_client as ac

    class _FakeMessages:
        # Intentionally no `.parse` — drives intake.run() to the fallback
        pass

    class _FakeClient:
        messages = _FakeMessages()

    monkeypatch.setattr(ac, "get_client", lambda: _FakeClient())

    def fake_complete_json(model, system, user, **kwargs):
        captured.append({"model": model, "system": system, "user": user})
        return dict(next_response)  # copy so tests can mutate

    monkeypatch.setattr(ac, "complete_json", fake_complete_json)
    return {"calls": captured, "next_response": next_response}


class TestIntakeBasics:
    def test_returns_structured_json_with_document_id(self, captured_intake):
        from agents import intake

        result = intake.run(
            document_id="doc-123",
            filename="quote.pdf",
            text="A past quote ...",
        )
        assert result["document_id"] == "doc-123"
        assert result["document_classification"] == "past_quote"
        assert result["confidence_score"] == 0.85

    def test_filename_and_text_passed_to_prompt(self, captured_intake):
        from agents import intake

        intake.run(
            document_id="doc-1",
            filename="ABC-EIFS-RFP.pdf",
            text="REQUEST FOR PROPOSAL — EIFS package — sample body",
        )
        user = captured_intake["calls"][0]["user"]
        assert "ABC-EIFS-RFP.pdf" in user
        assert "REQUEST FOR PROPOSAL" in user

    def test_text_truncated_to_8000_chars(self, captured_intake):
        from agents import intake

        sentinel = "Z" * 20000  # Z is not used elsewhere in the prompt template
        intake.run(document_id="d", filename="big.txt", text=sentinel)
        user = captured_intake["calls"][0]["user"]
        # Only the first 8000 Zs should survive truncation
        assert user.count("Z") == 8000

    def test_uses_haiku_model_by_default(self, captured_intake):
        from agents import intake

        intake.run(document_id="d", filename="f.pdf", text="t")
        # First call should be Haiku per spec §5.2
        assert "haiku" in captured_intake["calls"][0]["model"]


class TestDocumentTypeHint:
    def test_hint_passed_into_prompt(self, captured_intake):
        from agents import intake

        intake.run(
            document_id="d",
            filename="custom.pdf",
            text="...",
            document_type_hint="rfp",
        )
        user = captured_intake["calls"][0]["user"]
        assert "Document type hint" in user
        assert "rfp" in user

    def test_no_hint_falls_back_to_classifier(self, captured_intake):
        """When no hint, classify_document_hint is called on filename + text."""
        from agents import intake

        intake.run(
            document_id="d",
            filename="ABC-RFP.pdf",  # filename triggers 'rfp' classification
            text="",
        )
        user = captured_intake["calls"][0]["user"]
        assert "rfp" in user.lower()


class TestSystemPrompt:
    def test_system_mentions_all_document_types(self, captured_intake):
        from agents import intake

        intake.run(document_id="d", filename="f.pdf", text="t")
        system = captured_intake["calls"][0]["system"]
        for doc_type in ("past_quote", "rfp", "drawings", "scope_email", "change_request"):
            assert doc_type in system

    def test_system_mentions_construction_terminology(self, captured_intake):
        """The agent must recognize specialty-contractor terms per the
        spec §5.2 behavior contract."""
        from agents import intake

        intake.run(document_id="d", filename="f.pdf", text="t")
        system = captured_intake["calls"][0]["system"]
        assert "STUCCO" in system or "stucco" in system.lower()
        assert "EIFS" in system or "eifs" in system.lower()

    def test_system_requires_valid_json(self, captured_intake):
        from agents import intake

        intake.run(document_id="d", filename="f.pdf", text="t")
        system = captured_intake["calls"][0]["system"]
        assert "JSON" in system or "json" in system.lower()


class TestConfidenceThreshold:
    def test_high_confidence_does_not_flag_for_review(self, captured_intake):
        from agents import intake

        captured_intake["next_response"]["confidence_score"] = 0.9
        result = intake.run(document_id="d", filename="f.pdf", text="t")
        assert result.get("needs_human_review") is not True

    def test_low_confidence_flags_for_review(self, captured_intake):
        """Per spec §5.2: confidence < 0.7 → flag for human review."""
        from agents import intake

        captured_intake["next_response"]["confidence_score"] = 0.5
        result = intake.run(document_id="d", filename="f.pdf", text="t")
        assert result["needs_human_review"] is True

    def test_threshold_boundary_not_flagged(self, captured_intake):
        from agents import intake

        captured_intake["next_response"]["confidence_score"] = 0.7
        result = intake.run(document_id="d", filename="f.pdf", text="t")
        assert result.get("needs_human_review") is not True


class TestSonnetFallback:
    def test_json_decode_error_retries_with_sonnet(self, monkeypatch):
        """When Haiku returns malformed JSON, fall back to Sonnet."""
        import json

        import core.anthropic_client as ac

        calls = []

        def flaky_complete_json(model, system, user, **kwargs):
            calls.append(model)
            if len(calls) == 1:
                raise json.JSONDecodeError("bad json", "x", 0)
            return {
                "document_classification": "past_quote",
                "client_info": {}, "service_line_hint": None,
                "scope_items": [], "exclusions_mentioned": [],
                "inclusions_mentioned": [], "pricing_mentioned": {},
                "deadline": None, "addenda_or_changes": [],
                "confidence_score": 0.85,
            }

        monkeypatch.setattr(ac, "complete_json", flaky_complete_json)
        from agents import intake

        result = intake.run(document_id="d", filename="f.pdf", text="t")
        assert len(calls) == 2
        assert "haiku" in calls[0]
        assert "sonnet" in calls[1]
        assert result["confidence_score"] == 0.85
