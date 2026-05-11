"""Tests for the Intake agent's messages.parse() path.

The agent now prefers `client.messages.parse(output_format=IntakeResult)`
for schema-validated outputs, falling back to the legacy complete_json
path on parse failures or missing SDK support. These tests:
  - verify the Pydantic schema accepts the spec's expected shape
  - verify the parse path is preferred when available
  - verify the fallback fires when .parse() raises
"""
from __future__ import annotations

import json

import pytest

from agents.intake_schema import (
    ClientInfo,
    IntakeResult,
    PricingMentioned,
    ScopeItem,
)


class TestSchema:
    def test_minimal_valid_payload(self):
        result = IntakeResult(
            document_classification="past_quote",
            confidence_score=0.85,
        )
        assert result.confidence_score == 0.85
        assert result.scope_items == []
        assert result.client_info == ClientInfo()

    def test_full_valid_payload(self):
        result = IntakeResult(
            document_classification="rfp",
            client_info=ClientInfo(client_name="ACME"),
            service_line_hint="EIFS",
            scope_items=[ScopeItem(description="x", quantity=100, unit="sqft")],
            exclusions_mentioned=["a", "b"],
            pricing_mentioned=PricingMentioned(total=36400),
            confidence_score=0.92,
        )
        assert result.service_line_hint == "EIFS"
        assert result.scope_items[0].quantity == 100
        assert result.pricing_mentioned.total == 36400

    def test_invalid_document_classification_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            IntakeResult(
                document_classification="random_garbage",
                confidence_score=0.5,
            )

    def test_confidence_out_of_range_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            IntakeResult(
                document_classification="past_quote",
                confidence_score=1.5,  # > 1.0
            )

    def test_invalid_service_line_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            IntakeResult(
                document_classification="past_quote",
                service_line_hint="MADE_UP_LINE",
                confidence_score=0.8,
            )


class TestParsePath:
    def test_parse_path_used_when_sdk_supports_it(self, monkeypatch):
        """When client.messages.parse() works, Intake uses it instead
        of complete_json()."""
        captured = {"parse_called": False, "complete_json_called": False}

        class FakeParsedResponse:
            parsed_output = IntakeResult(
                document_classification="past_quote",
                client_info=ClientInfo(client_name="Parsed Client"),
                service_line_hint="EIFS",
                confidence_score=0.92,
            )

        class FakeMessages:
            def parse(self, **kwargs):
                captured["parse_called"] = True
                captured["parse_kwargs"] = kwargs
                return FakeParsedResponse()

        class FakeClient:
            messages = FakeMessages()

        import core.anthropic_client as ac

        monkeypatch.setattr(ac, "get_client", lambda: FakeClient())

        def fake_complete_json(**kwargs):
            captured["complete_json_called"] = True
            return {}

        monkeypatch.setattr(ac, "complete_json", fake_complete_json)

        from agents import intake

        result = intake.run(
            document_id="d", filename="quote.pdf", text="Past quote sample",
        )
        assert captured["parse_called"]
        assert not captured["complete_json_called"]
        assert result["client_info"]["client_name"] == "Parsed Client"
        assert result["service_line_hint"] == "EIFS"

    def test_falls_back_when_parse_raises_attribute_error(self, monkeypatch):
        """Older SDKs without .parse() — the fallback path runs."""
        captured = {"complete_json_called": False}

        class FakeMessages:
            # No .parse() method → AttributeError when intake tries it
            pass

        class FakeClient:
            messages = FakeMessages()

        import core.anthropic_client as ac

        monkeypatch.setattr(ac, "get_client", lambda: FakeClient())

        def fake_complete_json(**kwargs):
            captured["complete_json_called"] = True
            return {
                "document_classification": "past_quote",
                "client_info": {}, "service_line_hint": None,
                "scope_items": [], "exclusions_mentioned": [],
                "inclusions_mentioned": [], "pricing_mentioned": {},
                "deadline": None, "addenda_or_changes": [],
                "confidence_score": 0.85,
            }

        monkeypatch.setattr(ac, "complete_json", fake_complete_json)

        from agents import intake

        result = intake.run(document_id="d", filename="x.txt", text="y")
        assert captured["complete_json_called"]
        assert result["confidence_score"] == 0.85

    def test_falls_back_when_parse_returns_bad_json(self, monkeypatch):
        captured = {"complete_json_called": False}

        class FakeMessages:
            def parse(self, **kwargs):
                raise json.JSONDecodeError("bad json", "x", 0)

        class FakeClient:
            messages = FakeMessages()

        import core.anthropic_client as ac

        monkeypatch.setattr(ac, "get_client", lambda: FakeClient())

        def fake_complete_json(**kwargs):
            captured["complete_json_called"] = True
            return {
                "document_classification": "past_quote",
                "client_info": {}, "service_line_hint": None,
                "scope_items": [], "exclusions_mentioned": [],
                "inclusions_mentioned": [], "pricing_mentioned": {},
                "deadline": None, "addenda_or_changes": [],
                "confidence_score": 0.8,
            }

        monkeypatch.setattr(ac, "complete_json", fake_complete_json)

        from agents import intake

        intake.run(document_id="d", filename="x.txt", text="y")
        assert captured["complete_json_called"]
