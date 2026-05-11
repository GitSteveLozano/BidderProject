"""Anthropic Batch API helper tests.

Verify the batch wrapper:
  - submits a batch with the right request shape
  - polls to completion (or short-circuits on poll=False)
  - parses succeeded vs errored results correctly
  - the intelligence-specific helper maps custom_ids correctly
"""
from __future__ import annotations

import pytest


@pytest.fixture
def fake_batches(monkeypatch):
    state = {
        "submitted_requests": [],
        "status_sequence": ["in_progress", "ended"],
        "results": [],
        "retrieves": 0,
        "results_calls": 0,
    }

    class FakeBatch:
        def __init__(self, batch_id, status):
            self.id = batch_id
            self.processing_status = status

    class FakeResult:
        def __init__(self, custom_id, type_, text=None):
            self.custom_id = custom_id
            self.result = type(
                "Inner", (),
                {"type": type_,
                 "message": type(
                     "Msg", (),
                     {"content": [type("Block", (),
                                         {"type": "text", "text": text})]
                                 if text is not None else []})()},
            )

    class FakeBatches:
        def create(self, requests):
            state["submitted_requests"].extend(requests)
            return FakeBatch("batch_abc123", state["status_sequence"][0])

        def retrieve(self, batch_id):
            state["retrieves"] += 1
            # Advance status on each retrieve call
            if state["retrieves"] < len(state["status_sequence"]):
                return FakeBatch(batch_id, state["status_sequence"][state["retrieves"]])
            return FakeBatch(batch_id, state["status_sequence"][-1])

        def results(self, batch_id):
            state["results_calls"] += 1
            return iter(state["results"])

    class FakeMessages:
        batches = FakeBatches()

    class FakeClient:
        messages = FakeMessages()

    import core.anthropic_client as ac

    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())

    # Speed up the poll loop in tests
    import core.batch as batch_mod

    monkeypatch.setattr(batch_mod, "time", type("T", (), {
        "monotonic": lambda: 0,
        "sleep": lambda s: None,
    }))
    return state


class TestSubmitBatch:
    def test_no_poll_returns_immediately(self, fake_batches):
        from core.batch import submit_batch

        result = submit_batch(
            [{"custom_id": "r1", "system": "sys", "user": "u1"}],
            poll=False,
        )
        assert result["batch_id"] == "batch_abc123"
        assert "results" not in result
        # Submitted one request
        assert len(fake_batches["submitted_requests"]) == 1

    def test_polls_until_ended(self, fake_batches):
        from core.batch import submit_batch

        fake_batches["results"] = [
            type("R", (), {
                "custom_id": "r1",
                "result": type("Inner", (), {
                    "type": "succeeded",
                    "message": type("M", (), {
                        "content": [type("B", (), {"type": "text", "text": "ok"})],
                    })(),
                })(),
            })()
        ]
        result = submit_batch(
            [{"custom_id": "r1", "system": "sys", "user": "u1"}],
            poll=True, poll_interval_s=0, max_wait_s=10,
        )
        assert result["status"] == "ended"
        assert result["results"] == {"r1": "ok"}
        # Retrieve was called twice — first "in_progress" then "ended"
        assert fake_batches["retrieves"] >= 1

    def test_succeeded_and_errored_results_distinguished(self, fake_batches):
        from core.batch import submit_batch

        fake_batches["status_sequence"] = ["ended"]
        fake_batches["results"] = [
            type("R", (), {
                "custom_id": "win",
                "result": type("I", (), {
                    "type": "succeeded",
                    "message": type("M", (), {
                        "content": [type("B", (), {"type": "text", "text": "result-win"})],
                    })(),
                })(),
            })(),
            type("R", (), {
                "custom_id": "fail",
                "result": type("I", (), {"type": "errored", "message": None})(),
            })(),
        ]
        result = submit_batch(
            [
                {"custom_id": "win", "system": "s", "user": "u"},
                {"custom_id": "fail", "system": "s", "user": "u"},
            ],
            poll=True, poll_interval_s=0,
        )
        assert result["results"] == {"win": "result-win", "fail": None}
        assert result["succeeded"] == 1
        assert result["errored"] == 1

    def test_request_params_passed_through(self, fake_batches):
        from core.batch import submit_batch

        submit_batch(
            [{
                "custom_id": "r1",
                "system": "sys-prompt",
                "user": "user-msg",
                "model": "claude-haiku-4-5",
                "max_tokens": 256,
                "temperature": 0.0,
            }],
            poll=False,
        )
        req = fake_batches["submitted_requests"][0]
        # SDK Request type — inspect params
        params = req["params"]
        assert params["model"] == "claude-haiku-4-5"
        assert params["max_tokens"] == 256
        assert params["temperature"] == 0.0
        assert params["system"] == "sys-prompt"


class TestBatchIntelligenceHelper:
    def test_maps_company_id_and_category_to_custom_id(self, fake_batches):
        from core.batch import batch_intelligence_narratives

        fake_batches["status_sequence"] = ["ended"]
        fake_batches["results"] = [
            type("R", (), {
                "custom_id": "company-1:capacity",
                "result": type("I", (), {
                    "type": "succeeded",
                    "message": type("M", (), {
                        "content": [type("B", (), {"type": "text",
                                                    "text": "stub capacity narrative"})],
                    })(),
                })(),
            })(),
            type("R", (), {
                "custom_id": "company-2:margin",
                "result": type("I", (), {
                    "type": "succeeded",
                    "message": type("M", (), {
                        "content": [type("B", (), {"type": "text",
                                                    "text": "stub margin narrative"})],
                    })(),
                })(),
            })(),
        ]
        out = batch_intelligence_narratives(
            companies_with_facts=[
                {"company_id": "company-1", "category": "capacity",
                 "facts": {"avg": 0.8}, "guidance": "x"},
                {"company_id": "company-2", "category": "margin",
                 "facts": {"drift": -5}, "guidance": "y"},
            ],
            system_prompt="You write insights.",
            poll=True,
        )
        assert out == {
            "company-1:capacity": "stub capacity narrative",
            "company-2:margin": "stub margin narrative",
        }

    def test_facts_are_sorted_json(self, fake_batches):
        """Caching invariant: facts must be deterministic so multiple
        runs with the same input produce identical cache keys."""
        import json

        from core.batch import batch_intelligence_narratives

        fake_batches["status_sequence"] = ["ended"]
        batch_intelligence_narratives(
            companies_with_facts=[
                {"company_id": "c1", "category": "x",
                 "facts": {"b": 2, "a": 1}, "guidance": "g"},
            ],
            system_prompt="s",
            poll=False,
        )
        params = fake_batches["submitted_requests"][0]["params"]
        user_msg = params["messages"][0]["content"]
        # The facts JSON should be sort_keys ordered → "a" before "b"
        assert json.dumps({"a": 1, "b": 2}, sort_keys=True) in user_msg
