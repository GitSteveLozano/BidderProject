"""Tests for the real Anthropic tool-use Pricing variant.

The tool-use variant gives Claude the actual `tools=[...]` parameter and
runs a loop where Claude decides which tools to call. These tests stub
the Anthropic SDK at the wire level — mocking `tool_use` blocks in the
response, intercepting tool dispatch, asserting the loop terminates
correctly.

Spec §1.5 / §5.4: pricing numbers must come from tool_result blocks,
not from model text. The loop's correctness is structural — these tests
verify it without needing a real API key.
"""
from __future__ import annotations

import json
from datetime import date

import pytest


def _text_block(text):
    return type("TextBlock", (), {"type": "text", "text": text})()


def _tool_use_block(tool_id, name, tool_input):
    return type("ToolUseBlock", (), {
        "type": "tool_use",
        "id": tool_id,
        "name": name,
        "input": tool_input,
    })()


def _fake_response(stop_reason, content):
    return type("Response", (), {
        "stop_reason": stop_reason,
        "content": content,
    })()


@pytest.fixture
def tool_use_loop(monkeypatch):
    """Stub Anthropic client + tool dispatchers.

    Configure `state["responses"]` as a list of fake responses the
    client returns in sequence. After exhausting them, the fixture
    raises (unexpected extra calls).

    `state["tool_results"]` is a dict keyed by tool name — overrides
    what the dispatcher returns.
    """
    state = {
        "responses": [],
        "tool_results": {},
        "create_calls": [],
        "dispatch_calls": [],
    }

    class FakeMessages:
        def create(self, **kwargs):
            state["create_calls"].append(kwargs)
            if not state["responses"]:
                raise RuntimeError(
                    f"unexpected extra create() call; got {len(state['create_calls'])}"
                )
            return state["responses"].pop(0)

    class FakeClient:
        messages = FakeMessages()

    import core.anthropic_client as ac

    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())

    # Stub tool dispatcher
    from agents import pricing_tool_use

    original_dispatch = pricing_tool_use._dispatch_tool

    def fake_dispatch(name, company_id, args):
        state["dispatch_calls"].append({"name": name, "args": args})
        if name in state["tool_results"]:
            return state["tool_results"][name]
        # Fallback: return realistic-shaped tool result
        return _stub_tool_result(name, args)

    monkeypatch.setattr(pricing_tool_use, "_dispatch_tool", fake_dispatch)
    return state


def _stub_tool_result(name, args):
    if name == "get_loaded_labor_cost":
        return {"trade": args["trade"], "hours": args["hours"],
                "avg_loaded_rate": 55.0, "labor_subtotal": args["hours"] * 55,
                "citation": f"stub {args['trade']}"}
    if name == "lookup_material_cost":
        return {"service_line": args["service_line"], "quantity": args["quantity"],
                "subtotal": args["quantity"] * 11.50, "citation": "stub material"}
    if name == "get_capacity_utilization":
        return {"avg_utilization": 0.82,
                "weeks": [{"week_start": args["start_date"], "utilization": 0.82}],
                "recommended_modifier": {"action": "hold_firm",
                                          "modifier_pct": 0.0,
                                          "rationale": "full"},
                "citation": "stub capacity"}
    if name == "get_win_rate_at_price":
        return {"win_rate": 0.72, "citation": "stub win rate"}
    return {}


def _final_pricing_json():
    return json.dumps({
        "labor": {"by_trade": [], "subtotal": 17050, "total_hours": 310},
        "materials": {"subtotal": 36800, "citation": "stub"},
        "overhead": {"pct": 18, "subtotal": 9693},
        "profit": {"subtotal": 22000, "target_margin_pct": 32},
        "target_price": 85543,
        "range_low": 80000,
        "range_high": 95000,
        "capacity_utilization_at_start": 0.82,
        "capacity_modifier": {"action": "hold_firm", "modifier_pct": 0,
                              "rationale": "schedule full"},
        "win_rate_estimate": {"win_rate": 0.72},
        "citations": ["stub eifs", "stub helper", "stub material", "stub capacity"],
        "narrative": "Target price reflects 32% margin at hold.",
    })


class TestToolUseLoop:
    def test_terminates_when_claude_returns_final_text(self, tool_use_loop):
        """Single round: Claude returns final JSON without calling any tool."""
        from agents import pricing_tool_use

        tool_use_loop["responses"] = [
            _fake_response("end_turn", [_text_block(_final_pricing_json())]),
        ]
        result = pricing_tool_use.compute_pricing_tool_use(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=3200,
            estimated_start_date=date(2026, 7, 13),
        )
        assert result["target_price"] == 85543
        assert tool_use_loop["dispatch_calls"] == []
        assert len(tool_use_loop["create_calls"]) == 1

    def test_dispatches_tool_call_and_continues(self, tool_use_loop):
        """Two rounds: Claude requests a labor lookup, then returns final."""
        from agents import pricing_tool_use

        tool_use_loop["responses"] = [
            _fake_response("tool_use", [
                _tool_use_block("toolu_1", "get_loaded_labor_cost",
                                {"trade": "eifs", "hours": 200}),
            ]),
            _fake_response("end_turn", [_text_block(_final_pricing_json())]),
        ]
        result = pricing_tool_use.compute_pricing_tool_use(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=3200,
            estimated_start_date=date.today(),
        )
        assert len(tool_use_loop["dispatch_calls"]) == 1
        assert tool_use_loop["dispatch_calls"][0]["name"] == "get_loaded_labor_cost"
        assert result["target_price"] == 85543

    def test_dispatches_multiple_tools_in_one_round(self, tool_use_loop):
        """Claude can request multiple tool calls in a single response."""
        from agents import pricing_tool_use

        tool_use_loop["responses"] = [
            _fake_response("tool_use", [
                _tool_use_block("toolu_1", "get_loaded_labor_cost",
                                {"trade": "eifs", "hours": 200}),
                _tool_use_block("toolu_2", "get_loaded_labor_cost",
                                {"trade": "helper", "hours": 80}),
                _tool_use_block("toolu_3", "lookup_material_cost",
                                {"service_line": "EIFS", "quantity": 3200}),
            ]),
            _fake_response("end_turn", [_text_block(_final_pricing_json())]),
        ]
        pricing_tool_use.compute_pricing_tool_use(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=3200,
            estimated_start_date=date.today(),
        )
        # All 3 tool calls should have been dispatched
        names = [c["name"] for c in tool_use_loop["dispatch_calls"]]
        assert names == [
            "get_loaded_labor_cost",
            "get_loaded_labor_cost",
            "lookup_material_cost",
        ]

    def test_tool_results_sent_back_in_next_request(self, tool_use_loop):
        from agents import pricing_tool_use

        tool_use_loop["responses"] = [
            _fake_response("tool_use", [
                _tool_use_block("toolu_x", "get_loaded_labor_cost",
                                {"trade": "eifs", "hours": 200}),
            ]),
            _fake_response("end_turn", [_text_block(_final_pricing_json())]),
        ]
        pricing_tool_use.compute_pricing_tool_use(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        # The second create() call should have the tool_result block in
        # its messages array
        second_call = tool_use_loop["create_calls"][1]
        last_msg = second_call["messages"][-1]
        assert last_msg["role"] == "user"
        assert any(
            block.get("type") == "tool_result" and block.get("tool_use_id") == "toolu_x"
            for block in last_msg["content"]
        )


class TestToolUseTrail:
    def test_trail_captures_every_tool_call(self, tool_use_loop):
        """The _tool_trail is what the UI renders to show "Claude reached
        for this tool to get this number" — must capture every dispatch."""
        from agents import pricing_tool_use

        tool_use_loop["responses"] = [
            _fake_response("tool_use", [
                _tool_use_block("t1", "get_loaded_labor_cost",
                                {"trade": "eifs", "hours": 200}),
                _tool_use_block("t2", "lookup_material_cost",
                                {"service_line": "EIFS", "quantity": 3200}),
            ]),
            _fake_response("end_turn", [_text_block(_final_pricing_json())]),
        ]
        result = pricing_tool_use.compute_pricing_tool_use(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=3200,
            estimated_start_date=date.today(),
        )
        trail = result["_tool_trail"]
        assert len(trail) == 2
        assert trail[0]["tool"] == "get_loaded_labor_cost"
        assert trail[0]["input"] == {"trade": "eifs", "hours": 200}
        # Each trail entry has a human-readable summary for the UI
        assert isinstance(trail[0]["result_summary"], str)
        assert len(trail[0]["result_summary"]) > 0


class TestMaxIterationsGuard:
    def test_returns_error_after_max_iterations(self, tool_use_loop):
        """If Claude keeps calling tools forever, the loop bails out."""
        from agents import pricing_tool_use

        # 12 rounds of tool_use, no final text — should hit cap at 10
        tool_use_loop["responses"] = [
            _fake_response("tool_use", [
                _tool_use_block(f"t{i}", "get_loaded_labor_cost",
                                {"trade": "eifs", "hours": 100}),
            ]) for i in range(12)
        ]
        result = pricing_tool_use.compute_pricing_tool_use(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 100}],
            material_quantity=1000,
            estimated_start_date=date.today(),
            max_iterations=10,
        )
        assert "error" in result
        assert "max iterations" in result["error"]
        assert len(tool_use_loop["create_calls"]) == 10


class TestToolDefinitions:
    def test_required_tools_declared(self):
        """Sanity: the TOOLS list must include the four hallucination-
        resistance tools required by spec §5.4."""
        from agents.pricing_tool_use import TOOLS

        names = {t["name"] for t in TOOLS}
        assert "get_loaded_labor_cost" in names
        assert "lookup_material_cost" in names
        assert "get_capacity_utilization" in names
        assert "get_win_rate_at_price" in names

    def test_system_prompt_forbids_text_generation_of_numbers(self):
        from agents.pricing_tool_use import SYSTEM_PROMPT

        assert "MUST NOT" in SYSTEM_PROMPT
        assert "tool" in SYSTEM_PROMPT.lower()
