"""Streamlit demo UI — spec §8.6 demo flow.

7 segments:
  1. Onboarding (upload past quotes, watch Context agent extract)
  2. Bid Generation (drawings + scope → bid)
  3. Exclusions Review (Composition agent catches missing)
  4. Send + Follow-up (segment-aware cadence)
  5. Job-Cost Reconciliation view
  6. Intelligence dashboard
  7. Architecture / agent trail
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import plotly.express as px
import streamlit as st

from agents import composition, follow_up, intelligence, orchestrator, pricing
from core.db import fetch_all, fetch_one
from core.settings import get_settings
from tools.capacity_lookup import get_capacity_utilization

st.set_page_config(
    page_title="ProService Bid Intelligence",
    page_icon="🛠️",
    layout="wide",
)

# ─── Sidebar — company picker + nav ────────────────────────────
st.sidebar.title("ProService Bid Intelligence")

companies = fetch_all("SELECT id, name, segment FROM companies ORDER BY name")
company_options = {f"{c['name']} ({c['segment']})": c["id"] for c in companies}
default_idx = 0
if not companies:
    st.sidebar.warning("No companies found. Run `python -m db.seed` first.")
    st.stop()

selected_label = st.sidebar.selectbox("Company", list(company_options.keys()), index=default_idx)
company_id = company_options[selected_label]

page = st.sidebar.radio(
    "View",
    [
        "Onboarding",
        "Bid Generation",
        "Active Bids",
        "Compare Bids",
        "Loss Postmortem",
        "Follow-ups",
        "Job-Cost Reconciliation",
        "Intelligence Dashboard",
        "Cross-archetype compare",
        "Agent Architecture",
    ],
)

st.sidebar.markdown("---")
st.sidebar.caption(
    f"**Models**\n\n"
    f"Haiku: `{get_settings().model_haiku}`\n"
    f"Sonnet: `{get_settings().model_sonnet}`"
)

# Audit log export — sidebar download button (filtered to current company)
with st.sidebar.expander("Audit log export"):
    from core.audit_export import export_csv

    audit_entity_type = st.selectbox(
        "Filter",
        [None, "bid", "reconciliation", "follow_up", "insight"],
        format_func=lambda v: "(any)" if v is None else v,
        key="audit_entity_filter",
    )
    if st.button("Generate CSV", key="audit_export_btn"):
        try:
            csv_body = export_csv(
                company_id=company_id,
                entity_type=audit_entity_type,
            )
            from datetime import datetime as _dt
            st.download_button(
                "⬇ Download",
                data=csv_body,
                file_name=f"audit-{_dt.utcnow():%Y%m%d-%H%M%S}.csv",
                mime="text/csv",
                key="audit_dl_btn",
            )
            st.caption(f"{len(csv_body.splitlines()) - 1} rows")
        except Exception as e:
            st.error(f"export failed: {e}")


# ─── Page: Onboarding ─────────────────────────────────────────
if page == "Onboarding":
    st.header("Layer 1 — Contextual Onboarding")
    st.caption("Spec §7.1. Past quotes → voice + service lines + pricing logic + exclusions.")

    profile = fetch_one(
        """
        SELECT c.*, vp.tone, vp.boilerplate_intro,
               (SELECT COUNT(*) FROM service_lines WHERE company_id = c.id) AS n_service_lines,
               (SELECT COUNT(*) FROM documents WHERE company_id = c.id AND type='past_quote') AS n_quotes
        FROM companies c LEFT JOIN voice_patterns vp ON vp.company_id = c.id
        WHERE c.id = %s
        """,
        (company_id,),
    )
    col1, col2, col3 = st.columns(3)
    col1.metric("Past quotes ingested", profile["n_quotes"])
    col2.metric("Service lines extracted", profile["n_service_lines"])
    col3.metric("Onboarded", "✅" if profile["onboarded_at"] else "—")

    if profile.get("tone"):
        st.subheader("Extracted voice")
        st.write(f"**Tone:** {profile['tone']}")
        with st.expander("Boilerplate intro"):
            st.text(profile.get("boilerplate_intro") or "—")

    st.subheader("Service lines + standard exclusions")
    service_lines = fetch_all(
        """
        SELECT line_name, typical_margin_pct, pricing_unit, standard_exclusions,
               manufacturers_referenced
        FROM service_lines WHERE company_id = %s ORDER BY line_name
        """,
        (company_id,),
    )
    for sl in service_lines:
        with st.expander(
            f"{sl['line_name']} • margin {sl.get('typical_margin_pct') or '—'}% • "
            f"{sl.get('pricing_unit') or '—'}"
        ):
            st.write("**Standard exclusions:**")
            for e in sl.get("standard_exclusions") or []:
                st.markdown(f"- {e}")
            if sl.get("manufacturers_referenced"):
                st.write(f"**Manufacturers:** {', '.join(sl['manufacturers_referenced'])}")


# ─── Page: Bid Generation ─────────────────────────────────────
elif page == "Bid Generation":
    st.header("Layer 2 — Bid Generation")
    st.caption("Spec §7.2. Scope → 4 agents fire (Intake, Context, Pricing, Composition).")

    service_lines = fetch_all(
        "SELECT line_name FROM service_lines WHERE company_id = %s ORDER BY line_name",
        (company_id,),
    )
    sl_names = [s["line_name"] for s in service_lines] or ["STUCCO-CONVENTIONAL"]

    with st.form("new_bid"):
        col_a, col_b = st.columns(2)
        with col_a:
            client_name = st.text_input("Client name", "Esprit Heights Phase 2 — McKenzie GC")
            service_line = st.selectbox("Service line", sl_names)
            scope_summary = st.text_area(
                "Scope (from RFP / scope email / drawings)",
                "EIFS exterior package, ~3,200 sqft, ADEX system spec. "
                "Per drawings package received 2026-05-08. Multi-unit residential.",
                height=120,
            )
        with col_b:
            client_segment = st.selectbox("Client segment", ["repeat", "new", "cold_lead"])
            start_date = st.date_input("Estimated start date", date.today() + timedelta(weeks=4))
            primary_trade = st.selectbox(
                "Primary labor trade",
                ["stucco_journeyman", "eifs", "siding", "stucco_lead"],
            )
            primary_hours = st.number_input("Primary trade hours", 40, 2000, 312, step=8)
            helper_hours = st.number_input("Helper / laborer hours", 0, 1000, 80, step=8)
            material_qty = st.number_input("Material quantity (sqft / lf)", 0.0, 50000.0, 3200.0)
            stream_bid = st.checkbox(
                "Stream the bid draft (Composition agent renders progressively)",
                value=True,
            )
        cost_estimate_col, submit_col = st.columns([1, 2])
        with cost_estimate_col:
            estimate_cost = st.form_submit_button("Estimate input cost")
        with submit_col:
            submitted = st.form_submit_button("Run all 4 generation agents")

    if estimate_cost:
        from core.cost import estimate_full_pipeline_cost

        with st.spinner("Counting tokens across all generation agents..."):
            est = estimate_full_pipeline_cost(
                company_id=company_id,
                service_line=service_line,
                scope_summary=scope_summary,
            )
        # Headline metrics
        tc1, tc2, tc3 = st.columns(3)
        tc1.metric("Total input tokens", f"{est['total_input_tokens']:,}")
        tc2.metric(
            "Total output (est.)",
            f"{est['total_output_tokens_estimated']:,}",
        )
        tc3.metric("Total est. cost", f"${est['total_cost_usd']:.4f}")

        # Per-agent breakdown
        with st.expander("Per-agent breakdown"):
            agent_rows = []
            for agent_name, data in est["by_agent"].items():
                agent_rows.append({
                    "Agent": agent_name,
                    "Model": data["model"],
                    "Input tokens": data["input_tokens"],
                    "Output tokens (est.)": data["output_tokens_estimated"],
                    "Cost (USD)": data["cost_usd"],
                })
            st.dataframe(pd.DataFrame(agent_rows), use_container_width=True)

        st.caption(est["notes"])

    if submitted:
        bid_id = orchestrator.create_bid(
            company_id=company_id,
            client_name=client_name,
            service_line=service_line,
            scope_summary=scope_summary,
            client_segment=client_segment,
            estimated_start_date=start_date,
        )
        st.session_state["last_bid_id"] = bid_id

        labor_plan = [
            {"trade": primary_trade, "hours": primary_hours},
            {"trade": "helper", "hours": helper_hours},
        ]

        if stream_bid:
            # Streaming path: render the bid draft progressively.
            with st.status("Pricing agent: querying loaded labor + capacity...",
                            expanded=True) as status:
                gen = orchestrator.run_assessment_streaming(
                    bid_id=bid_id,
                    labor_plan=labor_plan,
                    material_quantity=material_qty,
                )
                result = None
                stream_placeholder = None
                token_buffer: list[str] = []

                for kind, payload in gen:
                    if kind == "pricing":
                        status.update(
                            label="Composition agent: drafting in voice (streaming)...",
                            state="running",
                        )
                        st.subheader("Generated bid draft (streaming)")
                        stream_placeholder = st.empty()
                        # Stash for later sections
                        st.session_state["_stream_pricing"] = payload
                    elif kind == "token" and stream_placeholder is not None:
                        token_buffer.append(payload)
                        stream_placeholder.markdown("".join(token_buffer))
                    elif kind == "done":
                        result = payload
                        status.update(
                            label=f"Done. State = **{result['state']}**",
                            state="complete",
                        )
                # Defensive guard — shouldn't happen, but if the stream
                # short-circuits (e.g., API error), bail with a clear msg.
                if result is None:
                    st.error("Streaming assessment did not complete.")
                    st.stop()
        else:
            with st.status("Running assessment...", expanded=True) as status:
                st.write("→ Pricing agent: querying loaded labor costs + capacity")
                result = orchestrator.run_assessment(
                    bid_id=bid_id,
                    labor_plan=labor_plan,
                    material_quantity=material_qty,
                )
                st.write("→ Composition agent: drafting bid in company voice")
                st.write("→ Composition agent: verifying standard exclusions")
                status.update(label=f"Done. State = **{result['state']}**",
                              state="complete")

        st.subheader("Pricing breakdown")
        pb = result["pricing"]
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Target price", f"${pb['target_price']:,.0f}")
        m2.metric("Range low", f"${pb['range_low']:,.0f}")
        m3.metric("Range high", f"${pb['range_high']:,.0f}")
        m4.metric(
            "Capacity at start",
            f"{int(pb['capacity_utilization_at_start']*100)}%",
            pb["capacity_modifier"]["action"],
        )
        st.markdown("**Pricing rationale:** " + (pb.get("narrative") or "—"))

        # "What if" simulator — recompute the price as you drag sliders.
        # Pure math, no LLM, no DB write. Lets the contractor see the
        # margin impact of an alternate labor estimate before re-pricing.
        with st.expander("🎛  What-if simulator (no LLM call)"):
            from core.pricing_simulator import simulate, what_if_delta

            baseline_hours = pb["labor"]["total_hours"]
            baseline_labor_cost = pb["labor"]["subtotal"]
            avg_rate = (baseline_labor_cost / baseline_hours
                         if baseline_hours else 50.0)
            baseline_mat = pb["materials"].get("subtotal") or 0
            target_margin = pb["profit"]["target_margin_pct"]
            overhead_pct = pb["overhead"].get("pct", 18.0)

            wif_cols = st.columns(3)
            sim_hours = wif_cols[0].slider(
                "Labor hours",
                min_value=max(10, int(baseline_hours * 0.5)),
                max_value=int(baseline_hours * 2.0),
                value=int(baseline_hours),
                step=8,
                key="wif_hours",
            )
            sim_mat = wif_cols[1].slider(
                "Material cost",
                min_value=float(round(baseline_mat * 0.5, 2)) if baseline_mat else 0.0,
                max_value=float(round(baseline_mat * 2.0, 2)) if baseline_mat else 100000.0,
                value=float(baseline_mat),
                step=100.0,
                key="wif_mat",
            )
            sim_margin = wif_cols[2].slider(
                "Target margin %",
                min_value=15.0,
                max_value=50.0,
                value=float(target_margin),
                step=0.5,
                key="wif_margin",
            )

            baseline_sim = simulate(
                labor_hours=baseline_hours,
                avg_loaded_rate=avg_rate,
                material_subtotal=baseline_mat,
                overhead_pct=overhead_pct,
                target_margin_pct=target_margin,
            )
            scenario = simulate(
                labor_hours=sim_hours,
                avg_loaded_rate=avg_rate,
                material_subtotal=sim_mat,
                overhead_pct=overhead_pct,
                target_margin_pct=sim_margin,
            )
            delta = what_if_delta(baseline_sim, scenario)

            sc1, sc2, sc3, sc4 = st.columns(4)
            sc1.metric(
                "Scenario target price",
                f"${scenario['target_price']:,.0f}",
                delta=f"${delta['target_price_delta']:+,.0f} "
                       f"({delta['target_price_delta_pct']:+.1f}%)",
            )
            sc2.metric(
                "Scenario profit",
                f"${scenario['profit']:,.0f}",
                delta=f"${delta['profit_delta']:+,.0f}",
            )
            sc3.metric(
                "Scenario margin",
                f"{scenario['realized_margin_pct']:.1f}%",
                delta=f"{delta['margin_delta_pp']:+.1f}pp",
            )
            sc4.metric(
                "Labor subtotal",
                f"${scenario['labor_subtotal']:,.0f}",
            )
            st.caption(
                "Pure deterministic math (no LLM call, no DB write). "
                f"Avg loaded rate held constant at ${avg_rate:.2f}/h."
            )

        # If the tool-use Pricing variant ran, render the actual LLM tool
        # call sequence — strongest demo angle for "not a GPT wrapper".
        if pb.get("_tool_trail"):
            with st.expander("🔧 Claude tool-use trail (real anthropic.messages tools= loop)"):
                st.caption(
                    "Each row is a tool call Claude itself decided to make. "
                    "Numbers come from tool_result blocks, not from text."
                )
                for i, step in enumerate(pb["_tool_trail"], 1):
                    st.markdown(
                        f"**`{i}`** → `{step['tool']}`"
                        f"({', '.join(f'{k}={v}' for k, v in step['input'].items())})"
                    )
                    st.markdown(f"   ↳ {step['result_summary']}")

        with st.expander("🔍 Numeric citation trail (NOT A GPT WRAPPER)"):
            st.caption(
                "Every number above traces to a specific tool call. Pricing "
                "agent NEVER generates labor or material costs from text."
            )
            for c in pb.get("citations", []):
                if c:
                    st.markdown(f"- {c}")
            st.markdown("**Labor breakdown:**")
            for trade in pb.get("labor", {}).get("by_trade", []):
                st.markdown(
                    f"  • `{trade.get('trade')}`: "
                    f"{trade.get('hours')}h × ${trade.get('avg_loaded_rate')}/h "
                    f"(avg of {trade.get('n_employees')} workers) = "
                    f"${trade.get('labor_subtotal')}"
                )
            st.markdown("**Materials:**")
            st.markdown(f"  • {pb['materials'].get('citation') or 'n/a'}")
            st.markdown("**Capacity-aware modifier:**")
            modifier = pb.get("capacity_modifier", {})
            st.markdown(f"  • action: **{modifier.get('action')}** — {modifier.get('rationale')}")
        with st.expander("Full pricing JSON"):
            st.json(pb)

        comp = result["composition"]
        # If we already streamed the draft, don't re-render it as a
        # static markdown block — just show the exclusions verdict.
        if not stream_bid:
            st.subheader("Generated bid draft")
        if not comp["exclusions_verified"]:
            st.warning(
                f"⚠️  Composition flagged {len(comp['exclusions_missing'])} "
                f"missing exclusions. State: EXCLUSIONS_REVIEW."
            )
            st.markdown("**Decide for each:** (this is the spec §5.5 v2 behavior)")
            with st.form("exclusions_review"):
                decisions = {}
                for e in comp["exclusions_missing"]:
                    decisions[e] = st.radio(
                        e,
                        ["Add to quote", "Skip"],
                        key=f"excl_{hash(e)}",
                        horizontal=True,
                    )
                decided = st.form_submit_button("Apply decisions")
            if decided:
                accepted = [k for k, v in decisions.items() if v == "Add to quote"]
                skipped = [k for k, v in decisions.items() if v == "Skip"]
                orchestrator.accept_exclusions(bid_id, accepted, skipped)
                st.success(
                    f"Applied {len(accepted)} exclusions, skipped {len(skipped)}. "
                    "State → DRAFT_GENERATED."
                )
                st.rerun()
        else:
            st.success(f"✅  {comp['total_required']} standard exclusions verified present.")
        # Only render the static markdown if we didn't already stream it
        if not stream_bid:
            st.markdown(comp["draft_markdown"])

        # Send button
        if comp["exclusions_verified"]:
            if st.button("Send bid to client (transition to SENT)"):
                orchestrator.submit_for_human_review(bid_id)
                orchestrator.send_bid(bid_id)
                st.success("Sent. Follow-up agent scheduled segment-aware cadence.")


# ─── Page: Active Bids ─────────────────────────────────────────
elif page == "Active Bids":
    st.header("Active bids")
    bids = fetch_all(
        """
        SELECT id, state, client_name, service_line, estimated_value,
               estimated_start_date, outcome, delivered_margin_pct, created_at
        FROM bids WHERE company_id = %s ORDER BY created_at DESC LIMIT 50
        """,
        (company_id,),
    )
    if bids:
        df = pd.DataFrame(bids)
        st.dataframe(df, use_container_width=True)

        bid_id = st.selectbox("Select bid for detail", [b["id"] for b in bids])
        if bid_id:
            bid = fetch_one("SELECT * FROM bids WHERE id = %s", (bid_id,))
            history = orchestrator.get_state_history(bid_id)

            st.subheader(f"{bid['client_name']} — {bid['service_line']}")
            cols = st.columns(4)
            cols[0].metric("State", bid["state"])
            cols[1].metric("Estimated value", f"${float(bid['estimated_value'] or 0):,.0f}")
            cols[2].metric(
                "Delivered margin",
                f"{float(bid['delivered_margin_pct']):,.1f}%"
                if bid.get("delivered_margin_pct") is not None else "—",
            )
            cols[3].metric("Outcome", bid.get("outcome") or "—")

            st.subheader("Agent trail")
            if history:
                # Visual state-history timeline
                for i, h in enumerate(history):
                    arrow = "→" if h.get("from_state") else "○"
                    trigger_emoji = {"auto": "🤖", "human": "👤", "timer": "⏱", "seed": "🌱"}.get(
                        h.get("triggered_by"), "•"
                    )
                    st.markdown(
                        f"`{i+1:2d}` {trigger_emoji} "
                        f"`{h.get('from_state', 'START')}` {arrow} "
                        f"**`{h['to_state']}`** "
                        f"— *{h.get('notes', '')}* "
                        f"<small>({h['occurred_at']})</small>",
                        unsafe_allow_html=True,
                    )
            else:
                st.write("(no transitions recorded)")

            # Audit log
            audit_rows = fetch_all(
                """
                SELECT occurred_at, action, actor, diff, notes, request_id, agent_call_id
                FROM audit_log
                WHERE entity_type IN ('bid', 'reconciliation')
                  AND entity_id = %s
                ORDER BY occurred_at ASC
                """,
                (bid["id"],),
            )
            if audit_rows:
                with st.expander(f"Audit log ({len(audit_rows)} entries)"):
                    for r in audit_rows:
                        actor_emoji = {
                            "human": "👤", "auto": "🤖", "timer": "⏱",
                            "jcr_agent": "📊", "intelligence_agent": "🧠",
                        }.get(r.get("actor"), "•")
                        st.markdown(
                            f"`{r['occurred_at']:%H:%M:%S}` {actor_emoji} "
                            f"**{r['action']}** by `{r.get('actor')}`"
                            + (f" — _{r['notes']}_" if r.get("notes") else "")
                        )
                        if r.get("diff"):
                            st.json(r["diff"], expanded=False)

            # Exclusions audit
            if bid.get("exclusions_applied") or bid.get("exclusions_missing"):
                with st.expander("Exclusions audit"):
                    st.write(f"**Applied ({len(bid.get('exclusions_applied') or [])}):**")
                    for e in bid.get("exclusions_applied") or []:
                        st.markdown(f"  - ✓ {e}")
                    if bid.get("exclusions_missing"):
                        st.write(
                            f"**Skipped after review ({len(bid['exclusions_missing'])}):**"
                        )
                        for e in bid["exclusions_missing"]:
                            st.markdown(f"  - ✗ {e}")

            with st.expander("Pricing breakdown"):
                st.json(bid.get("pricing_breakdown"))

            # Lifecycle actions
            st.subheader("Actions")
            action_cols = st.columns(4)
            if bid["state"] in ("SENT", "FOLLOW_UP_1_SENT", "FOLLOW_UP_2_SENT",
                                "FOLLOW_UP_3_SENT", "STALLED"):
                if action_cols[0].button("Mark WON", key="won"):
                    orchestrator.capture_outcome(bid["id"], "WON")
                    st.rerun()
                if action_cols[1].button("Mark LOST", key="lost"):
                    orchestrator.capture_outcome(bid["id"], "LOST")
                    st.rerun()
            if bid["state"] == "WON":
                if action_cols[0].button("Start job", key="start"):
                    orchestrator.mark_job_started(bid["id"])
                    st.rerun()
            if bid["state"] == "JOB_IN_PROGRESS":
                if action_cols[0].button("Mark job complete → run JCR", key="complete"):
                    with st.spinner("Running JCR..."):
                        result = orchestrator.mark_job_complete(bid["id"])
                    st.success(
                        f"Reconciled. Delivered margin "
                        f"{result['reconciliation']['delivered_margin_pct']}%"
                    )
                    st.rerun()


# ─── Page: Compare Bids ────────────────────────────────────────
elif page == "Compare Bids":
    st.header("Compare two bids side-by-side")
    st.caption(
        "Useful for: same scope to two clients (price negotiation), "
        "same client across two service lines (cross-sell mix), or "
        "WON vs LOST on similar scope (loss postmortem)."
    )

    bids = fetch_all(
        """
        SELECT id, client_name, service_line, estimated_value,
               estimated_labor_hours, state, outcome,
               delivered_margin_pct, exclusions_applied,
               exclusions_missing, capacity_at_quote, created_at,
               pricing_breakdown
        FROM bids WHERE company_id = %s
        ORDER BY created_at DESC LIMIT 100
        """,
        (company_id,),
    )
    if len(bids) < 2:
        st.info("Need at least 2 bids to compare.")
    else:
        def _label(b):
            return (
                f"{b['client_name'][:30]} — {b['service_line']} "
                f"(${float(b['estimated_value'] or 0):,.0f}, {b['state']})"
            )

        labels = [_label(b) for b in bids]
        cl, cr = st.columns(2)
        with cl:
            left_idx = st.selectbox("Left bid", range(len(bids)),
                                     format_func=lambda i: labels[i], key="left_bid")
        with cr:
            right_idx = st.selectbox(
                "Right bid", range(len(bids)),
                format_func=lambda i: labels[i],
                index=1 if len(bids) > 1 else 0,
                key="right_bid",
            )
        a, b = bids[left_idx], bids[right_idx]

        def _money(x):
            try:
                return f"${float(x):,.0f}"
            except (TypeError, ValueError):
                return "—"

        def _pct(x):
            try:
                return f"{float(x):.1f}%"
            except (TypeError, ValueError):
                return "—"

        # Key metrics side-by-side
        st.subheader("Pricing")
        m1, m2 = st.columns(2)
        for col, bid in [(m1, a), (m2, b)]:
            col.markdown(f"**{bid['client_name']}**")
            col.metric("Estimated value", _money(bid.get("estimated_value")))
            col.metric("Labor hours", bid.get("estimated_labor_hours") or "—")
            col.metric(
                "Capacity at quote",
                f"{int(float(bid.get('capacity_at_quote') or 0) * 100)}%"
                if bid.get("capacity_at_quote") else "—",
            )
            col.metric("Outcome", bid.get("outcome") or "—")
            if bid.get("delivered_margin_pct") is not None:
                col.metric("Delivered margin", _pct(bid["delivered_margin_pct"]))

        # Pricing-breakdown deltas
        pb_a = a.get("pricing_breakdown") or {}
        pb_b = b.get("pricing_breakdown") or {}
        if pb_a and pb_b:
            st.subheader("Breakdown delta")
            rows = []
            for k in ("target_price", "range_low", "range_high"):
                rows.append({
                    "Field": k,
                    "Left": pb_a.get(k),
                    "Right": pb_b.get(k),
                    "Delta": (pb_b.get(k) or 0) - (pb_a.get(k) or 0),
                })
            for sub in ("labor", "materials", "overhead", "profit"):
                rows.append({
                    "Field": f"{sub}.subtotal",
                    "Left": (pb_a.get(sub) or {}).get("subtotal"),
                    "Right": (pb_b.get(sub) or {}).get("subtotal"),
                    "Delta": ((pb_b.get(sub) or {}).get("subtotal") or 0)
                              - ((pb_a.get(sub) or {}).get("subtotal") or 0),
                })
            st.dataframe(pd.DataFrame(rows), use_container_width=True)

        # Exclusions diff
        st.subheader("Exclusions diff")
        e_a = set(a.get("exclusions_applied") or [])
        e_b = set(b.get("exclusions_applied") or [])
        only_a = e_a - e_b
        only_b = e_b - e_a
        common = e_a & e_b
        dc1, dc2, dc3 = st.columns(3)
        dc1.markdown("**Only left**")
        for ex in sorted(only_a):
            dc1.markdown(f"- {ex}")
        if not only_a:
            dc1.caption("(none)")
        dc2.markdown("**Common**")
        for ex in sorted(common):
            dc2.markdown(f"- {ex}")
        if not common:
            dc2.caption("(none)")
        dc3.markdown("**Only right**")
        for ex in sorted(only_b):
            dc3.markdown(f"- {ex}")
        if not only_b:
            dc3.caption("(none)")

        # Skipped (missing-after-review) exclusions — these are the
        # post-mortem hot zone for loss-pattern analysis
        sk_a = set(a.get("exclusions_missing") or [])
        sk_b = set(b.get("exclusions_missing") or [])
        if sk_a or sk_b:
            st.subheader("⚠️  Skipped exclusions (post-review)")
            sc1, sc2 = st.columns(2)
            with sc1:
                st.markdown(f"**Left ({len(sk_a)})**")
                for ex in sorted(sk_a):
                    st.markdown(f"- {ex}")
            with sc2:
                st.markdown(f"**Right ({len(sk_b)})**")
                for ex in sorted(sk_b):
                    st.markdown(f"- {ex}")


# ─── Page: Loss Postmortem ─────────────────────────────────────
elif page == "Loss Postmortem":
    st.header("Loss postmortem")
    st.caption(
        "9th agent (extension of Intelligence). Takes a LOST bid + the "
        "competitor's price, produces structured reasons-why-we-lost and "
        "next-bid recommendations. Writes an `intelligence_insights` row."
    )

    lost_bids = fetch_all(
        """
        SELECT id, client_name, service_line, estimated_value,
               outcome_competitor, outcome_winning_bid, outcome_captured_at
        FROM bids
        WHERE company_id = %s AND outcome = 'LOST'
        ORDER BY outcome_captured_at DESC NULLS LAST
        LIMIT 100
        """,
        (company_id,),
    )
    if not lost_bids:
        st.info(
            "No LOST bids yet for this company. The postmortem agent only "
            "runs on bids with outcome=LOST. Mark a SENT bid as LOST from "
            "the Active Bids page to enable it."
        )
    else:
        bid_options = {
            f"{b['client_name'][:30]} — {b['service_line']} "
            f"(${float(b['estimated_value'] or 0):,.0f}, lost to "
            f"{b.get('outcome_competitor') or '?'})": b["id"]
            for b in lost_bids
        }
        picked_label = st.selectbox("Select a LOST bid", list(bid_options.keys()))
        picked_id = bid_options[picked_label]
        picked_bid = next(b for b in lost_bids if b["id"] == picked_id)

        # Surface the gap upfront — no agent call needed for the
        # quick read.
        winning_bid = picked_bid.get("outcome_winning_bid")
        if winning_bid is not None and picked_bid.get("estimated_value"):
            our_p = float(picked_bid["estimated_value"])
            their_p = float(winning_bid)
            delta = our_p - their_p
            delta_pct = (delta / our_p * 100) if our_p else 0
            gc1, gc2, gc3 = st.columns(3)
            gc1.metric("Our price", f"${our_p:,.0f}")
            gc2.metric("Winning price", f"${their_p:,.0f}")
            gc3.metric(
                "Gap",
                f"${delta:,.0f}",
                delta=f"{delta_pct:+.1f}%",
                delta_color="inverse",
            )

        if st.button("Run postmortem agent", type="primary"):
            from agents import postmortem

            with st.spinner("Postmortem agent analyzing..."):
                try:
                    result = postmortem.analyze_loss(picked_id, write_insight=True)
                except Exception as e:
                    st.error(f"Postmortem failed: {e}")
                    st.stop()

            st.success("Analysis complete — also written to Intelligence Insights.")

            st.subheader("Likely reasons")
            for r in result.get("likely_reasons", []):
                st.markdown(f"- {r}")

            st.subheader("Price gap interpretation")
            pga = result.get("price_gap_analysis", {})
            st.markdown(
                f"- Our price: ${pga.get('our_price', 0):,.0f}\n"
                f"- Winning price: "
                + (
                    f"${pga['winning_price']:,.0f}"
                    if pga.get("winning_price") is not None
                    else "_unknown_"
                )
                + (
                    f"\n- Delta: ${pga['delta_usd']:,.0f} ({pga['delta_pct']:+.1f}%)"
                    if pga.get("delta_usd") is not None
                    else ""
                )
            )
            if pga.get("interpretation"):
                st.markdown(f"**Interpretation:** {pga['interpretation']}")

            st.subheader("Other signals")
            cc1, cc2 = st.columns(2)
            cc1.markdown(
                f"**Exclusions signal:** {result.get('exclusions_signal', '—')}"
            )
            cc2.markdown(
                f"**Capacity factor:** {result.get('capacity_factor', '—')}"
            )
            st.markdown(
                f"**Pattern across recent losses:** "
                f"{result.get('pattern_across_recent_losses', '—')}"
            )

            st.subheader("Recommendations for next bid")
            for r in result.get("recommendations_for_next_bid", []):
                st.markdown(f"- {r}")

            st.caption(
                f"Confidence: **{result.get('confidence', '?')}** "
                "(low: n<3 comparable losses; medium: 3-7; high: 8+)"
            )

            with st.expander("Full JSON"):
                st.json(result)


# ─── Page: Follow-ups ──────────────────────────────────────────
elif page == "Follow-ups":
    st.header("Layer 3 — Follow-up Automation")
    st.caption("Spec §5.7 / §7.3. Segment-aware cadence — repeat: single soft touch; cold: 3-touch.")

    rows = fetch_all(
        """
        SELECT f.id, f.bid_id, f.sequence_number, f.scheduled_for, f.state,
               f.draft_message, f.sent_at,
               b.client_name, b.client_segment, b.service_line, b.estimated_value
        FROM follow_ups f JOIN bids b ON b.id = f.bid_id
        WHERE b.company_id = %s
        ORDER BY f.scheduled_for ASC
        """,
        (company_id,),
    )
    if not rows:
        st.info(
            "No follow-ups scheduled yet. Send a bid from the Bid Generation page to "
            "trigger the Follow-up agent."
        )
    else:
        st.caption(f"{len(rows)} scheduled / sent follow-up(s)")
        for r in rows:
            with st.expander(
                f"#{r['sequence_number']} → {r['client_name']} ({r['client_segment']}) "
                f"— {r['service_line']} ${float(r['estimated_value'] or 0):,.0f} — "
                f"state: {r['state']}"
            ):
                st.write(f"**Scheduled for:** {r['scheduled_for']}")
                if r["draft_message"]:
                    st.markdown("**Drafted message:**")
                    st.code(r["draft_message"])
                else:
                    if st.button(
                        "Draft message",
                        key=f"draft_{r['id']}",
                    ):
                        from agents import follow_up

                        drafted = follow_up.draft_message(r["bid_id"], r["sequence_number"])
                        st.code(drafted["draft"])


# ─── Page: Job-Cost Reconciliation ─────────────────────────────
elif page == "Job-Cost Reconciliation":
    st.header("Layer 4 — Job-Cost Reconciliation")
    st.caption("Spec §7.4. Quoted vs actual via payroll integration.")

    rows = fetch_all(
        """
        SELECT j.bid_id, b.client_name, b.service_line, j.quoted_price,
               j.actual_labor_cost + j.actual_material_cost + j.actual_other_costs AS actual_total,
               j.quoted_labor_hours, j.actual_labor_hours,
               j.delivered_margin_pct, j.variance_labor_hours_pct,
               j.variance_total_cost_pct, j.reconciled_at
        FROM job_cost_reconciliation j JOIN bids b ON b.id = j.bid_id
        WHERE j.company_id = %s
        ORDER BY j.reconciled_at DESC
        """,
        (company_id,),
    )
    if not rows:
        st.info("No reconciled jobs yet. Run the seed script or complete a job.")
    else:
        df = pd.DataFrame(rows)
        c1, c2, c3 = st.columns(3)
        c1.metric("Reconciled jobs", len(rows))
        c2.metric("Avg delivered margin", f"{df['delivered_margin_pct'].astype(float).mean():.1f}%")
        c3.metric("Avg labor variance", f"{df['variance_labor_hours_pct'].astype(float).mean():.1f}%")

        st.subheader("Margin distribution")
        fig = px.histogram(
            df,
            x="delivered_margin_pct",
            color="service_line",
            nbins=20,
            title="Delivered margin % across reconciled jobs",
        )
        st.plotly_chart(fig, use_container_width=True)

        st.subheader("Variance by service line")
        avg_by_line = df.groupby("service_line").agg(
            n=("bid_id", "count"),
            avg_margin=("delivered_margin_pct", "mean"),
            avg_labor_var=("variance_labor_hours_pct", "mean"),
        ).reset_index()
        st.dataframe(avg_by_line, use_container_width=True)

        st.subheader("Reconciliation detail")
        st.dataframe(df, use_container_width=True)


# ─── Page: Intelligence Dashboard ──────────────────────────────
elif page == "Intelligence Dashboard":
    st.header("Layer 5 — Capacity-Aware Operating Intelligence")
    st.caption("Spec §7.5. Cross-cutting synthesis.")

    if st.button("Re-run weekly analysis"):
        with st.spinner("Intelligence agent computing..."):
            generated = intelligence.run_weekly_analysis(company_id)
            st.success(f"Generated {len(generated)} new insights")

    insights = fetch_all(
        """
        SELECT category, severity, headline, finding, recommendation,
               projected_impact, generated_at
        FROM intelligence_insights
        WHERE company_id = %s AND status = 'open'
        ORDER BY generated_at DESC LIMIT 20
        """,
        (company_id,),
    )
    for ins in insights:
        with st.expander(f"[{ins['category'].upper()} • {ins['severity']}] {ins['headline']}"):
            st.markdown(f"**Finding:** {ins['finding']}")
            st.markdown(f"**Recommendation:** {ins['recommendation']}")
            if ins.get("projected_impact"):
                st.markdown(f"**Projected impact:** {ins['projected_impact']}")

    st.subheader("Capacity forecast — next 8 weeks")
    cap = get_capacity_utilization(company_id, date.today(), weeks=8)
    if cap["weeks"]:
        cap_df = pd.DataFrame(cap["weeks"])
        cap_df["utilization_pct"] = cap_df["utilization"] * 100
        fig2 = px.bar(
            cap_df, x="week_start", y="utilization_pct",
            title=f"Utilization — {cap['headcount']} workers, "
                  f"{cap['capacity_hours_per_week']} hrs/wk capacity",
            range_y=[0, 110],
        )
        fig2.add_hline(y=85, line_dash="dash", line_color="orange",
                       annotation_text="hold-firm threshold")
        st.plotly_chart(fig2, use_container_width=True)

    # Margin-by-service-line heatmap (delivered margin trend over time)
    st.subheader("Delivered margin by service line — quarterly trend")
    margin_rows = fetch_all(
        """
        SELECT b.service_line,
               date_trunc('quarter', j.reconciled_at) AS quarter,
               AVG(j.delivered_margin_pct) AS avg_margin,
               COUNT(*) AS n_jobs
        FROM job_cost_reconciliation j
        JOIN bids b ON b.id = j.bid_id
        WHERE j.company_id = %s
        GROUP BY b.service_line, date_trunc('quarter', j.reconciled_at)
        HAVING COUNT(*) >= 2
        ORDER BY quarter, b.service_line
        """,
        (company_id,),
    )
    if margin_rows:
        df = pd.DataFrame(margin_rows)
        df["quarter_label"] = pd.to_datetime(df["quarter"]).dt.strftime("%YQ%q")
        df["avg_margin"] = df["avg_margin"].astype(float)
        pivot = df.pivot_table(
            index="service_line", columns="quarter_label",
            values="avg_margin", aggfunc="mean",
        ).fillna(0)
        if not pivot.empty:
            fig3 = px.imshow(
                pivot,
                color_continuous_scale="RdYlGn",
                color_continuous_midpoint=30,
                aspect="auto",
                labels={"color": "Margin %"},
                title="Color = avg delivered margin %; gaps = no completed jobs that quarter",
                text_auto=".1f",
            )
            fig3.update_xaxes(side="bottom")
            st.plotly_chart(fig3, use_container_width=True)

            # Surface drift candidates: service lines where the most-recent
            # quarter is >=3pp below the all-time average for that line
            with st.expander("🔎 Drift candidates"):
                latest_col = pivot.columns[-1]
                drifted = False
                for sl in pivot.index:
                    series = pivot.loc[sl][pivot.loc[sl] > 0]
                    if len(series) < 2:
                        continue
                    overall = series.mean()
                    latest = pivot.loc[sl, latest_col]
                    if latest > 0 and overall - latest >= 3.0:
                        drifted = True
                        st.markdown(
                            f"- **{sl}** — latest quarter {latest:.1f}% "
                            f"vs all-time avg {overall:.1f}% "
                            f"(drift **-{overall - latest:.1f}pp**)"
                        )
                if not drifted:
                    st.caption("No service line shows >=3pp drift in the latest quarter.")

            # Drill-down: pick a service line, see the underlying bids
            st.subheader("Drill into a service line")
            sl_options = list(pivot.index)
            picked_sl = st.selectbox(
                "Service line",
                sl_options,
                key="margin_drilldown_sl",
            )
            if picked_sl:
                detail_rows = fetch_all(
                    """
                    SELECT b.id, b.client_name, b.estimated_value,
                           j.quoted_labor_hours, j.actual_labor_hours,
                           j.variance_labor_hours_pct,
                           j.delivered_margin_pct, j.quoted_margin_pct,
                           j.reconciled_at,
                           j.actual_labor_cost + j.actual_material_cost
                               + j.actual_other_costs AS actual_total
                    FROM job_cost_reconciliation j
                    JOIN bids b ON b.id = j.bid_id
                    WHERE j.company_id = %s AND b.service_line = %s
                    ORDER BY j.reconciled_at DESC
                    LIMIT 50
                    """,
                    (company_id, picked_sl),
                )
                if detail_rows:
                    detail_df = pd.DataFrame(detail_rows)
                    detail_df["delivered_margin_pct"] = (
                        detail_df["delivered_margin_pct"].astype(float)
                    )
                    detail_df["variance_labor_hours_pct"] = (
                        detail_df["variance_labor_hours_pct"].astype(float)
                    )
                    detail_df["estimated_value"] = detail_df["estimated_value"].astype(float)
                    detail_df["actual_total"] = detail_df["actual_total"].astype(float)

                    # KPIs across the drilled-into service line
                    dk1, dk2, dk3, dk4 = st.columns(4)
                    dk1.metric("Reconciled jobs", len(detail_df))
                    dk2.metric(
                        "Median delivered margin",
                        f"{detail_df['delivered_margin_pct'].median():.1f}%",
                    )
                    dk3.metric(
                        "Median labor variance",
                        f"{detail_df['variance_labor_hours_pct'].median():.1f}%",
                    )
                    dk4.metric(
                        "Total revenue",
                        f"${detail_df['estimated_value'].sum():,.0f}",
                    )

                    # Margin trend line over reconciled_at
                    detail_df_sorted = detail_df.sort_values("reconciled_at")
                    fig_trend = px.scatter(
                        detail_df_sorted,
                        x="reconciled_at",
                        y="delivered_margin_pct",
                        size="estimated_value",
                        hover_data=["client_name", "variance_labor_hours_pct"],
                        trendline="lowess" if len(detail_df_sorted) >= 5 else None,
                        title=f"{picked_sl} — delivered margin per reconciled job over time",
                        labels={"delivered_margin_pct": "Delivered margin %",
                                "reconciled_at": "Reconciled"},
                    )
                    fig_trend.add_hline(
                        y=float(detail_df["delivered_margin_pct"].mean()),
                        line_dash="dash", line_color="gray",
                        annotation_text="mean",
                    )
                    st.plotly_chart(fig_trend, use_container_width=True)

                    # Bid-by-bid table
                    with st.expander(f"All {len(detail_df)} reconciled bids"):
                        st.dataframe(
                            detail_df[[
                                "client_name", "estimated_value", "actual_total",
                                "quoted_labor_hours", "actual_labor_hours",
                                "variance_labor_hours_pct", "delivered_margin_pct",
                                "reconciled_at",
                            ]],
                            use_container_width=True,
                        )
                else:
                    st.caption(f"No reconciled jobs yet for {picked_sl}.")
    else:
        st.caption("Not enough reconciled jobs per quarter to render the heatmap.")


# ─── Page: Cross-archetype compare ─────────────────────────────
elif page == "Cross-archetype compare":
    st.header("Cross-archetype side-by-side")
    st.caption(
        "Same architecture, different business shape (spec §8.2-8.3). The "
        "Context agent's profile drives all downstream behavior."
    )

    archetypes = fetch_all(
        """
        SELECT id, name, segment, primary_trade, annual_revenue_band,
               years_in_business
        FROM companies WHERE onboarded_at IS NOT NULL ORDER BY name
        """
    )
    if len(archetypes) < 2:
        st.info("Need at least 2 onboarded archetypes. Run `python -m db.seed_all`.")
    else:
        names = [a["name"] for a in archetypes]
        c_left, c_right = st.columns(2)
        with c_left:
            left_name = st.selectbox("Left", names, index=0, key="left_compare")
        with c_right:
            right_name = st.selectbox(
                "Right", names, index=min(1, len(names) - 1), key="right_compare"
            )
        left_id = next(a["id"] for a in archetypes if a["name"] == left_name)
        right_id = next(a["id"] for a in archetypes if a["name"] == right_name)

        def _render_archetype(col, cid):
            info = fetch_one("SELECT * FROM companies WHERE id = %s", (cid,))
            voice = fetch_one("SELECT * FROM voice_patterns WHERE company_id = %s", (cid,))
            sls = fetch_all(
                """
                SELECT line_name, typical_margin_pct, pricing_unit, standard_exclusions
                FROM service_lines WHERE company_id = %s ORDER BY line_name
                """, (cid,),
            )
            pl = fetch_one("SELECT * FROM pricing_logic WHERE company_id = %s", (cid,))

            col.subheader(info["name"])
            col.caption(
                f"{info['segment']} • {info['primary_trade']} • "
                f"{info.get('annual_revenue_band') or '—'}"
            )
            col.markdown("**Tone:**")
            col.write((voice or {}).get("tone") or "—")
            col.markdown("**Boilerplate intro:**")
            col.code((voice or {}).get("boilerplate_intro") or "—", language="text")
            col.markdown("**Service lines:**")
            for sl in sls or []:
                col.markdown(
                    f"- **{sl['line_name']}** · `{sl.get('pricing_unit')}` · "
                    f"{sl.get('typical_margin_pct') or '—'}% margin"
                )
            col.markdown("**Pricing logic:**")
            if pl:
                col.markdown(
                    f"- Target margin: {pl.get('target_margin_pct')}%  \n"
                    f"- Range: {pl.get('margin_range_low_pct')}–"
                    f"{pl.get('margin_range_high_pct')}%  \n"
                    f"- Capacity behavior: `{pl.get('capacity_discount_behavior')}`  \n"
                    f"- Payment: {pl.get('payment_terms_default') or '—'}"
                )
            col.markdown("**First service line's exclusions:**")
            if sls and sls[0].get("standard_exclusions"):
                for e in sls[0]["standard_exclusions"][:5]:
                    col.markdown(f"  - {e}")
                if len(sls[0]["standard_exclusions"]) > 5:
                    col.caption(f"…and {len(sls[0]['standard_exclusions']) - 5} more")

        col_a, col_b = st.columns(2)
        _render_archetype(col_a, left_id)
        _render_archetype(col_b, right_id)

        st.markdown("---")
        st.markdown(
            "### What this demonstrates\n\n"
            "The 8-agent architecture is unchanged. What differs is the "
            "**Context agent's extracted profile** — voice, service lines, "
            "exclusions, pricing logic — which drives downstream behavior:\n\n"
            "- **Composition** writes in the company's voice with its boilerplate.\n"
            "- **Pricing** uses the company's loaded labor + margin logic.\n"
            "- **Composition** verifies the company's standard exclusions are present.\n"
            "- **Follow-up** routes by `segment` (repeat = 1 touch; cold = 3).\n\n"
            "Same code path, different output. This is the spec's "
            "horizontal-entry / vertical-expansion strategy (§2.1)."
        )


# ─── Page: Agent Architecture ─────────────────────────────────
elif page == "Agent Architecture":
    st.header("8-agent architecture")
    st.caption("Spec §1.3, §1.4, §1.5 — this is not a GPT wrapper.")

    agents_list = [
        ("Orchestrator", "Routes workflows, manages state, merges outputs", "Haiku"),
        ("Intake", "Parses RFPs, drawings, scope emails, change requests", "Haiku"),
        ("Context", "Owns company profile: voice, service lines, pricing", "Sonnet"),
        ("Pricing", "Calibrated pricing via loaded-labor tool calls + capacity", "Sonnet + tools"),
        ("Composition", "Bid generation in voice + exclusions verification", "Sonnet"),
        ("Job-Cost Reconciliation", "Closes the loop quoted → actual via payroll", "Sonnet + tools"),
        ("Follow-up", "Post-send lifecycle, segment-aware cadence", "Sonnet"),
        ("Intelligence", "Cross-cutting synthesis, capacity-aware insights (async)", "Sonnet"),
    ]
    df = pd.DataFrame(agents_list, columns=["Agent", "Responsibility", "Model"])
    st.table(df)

    st.subheader("Why this is not a GPT wrapper")
    st.markdown("""
- **Specialization** — each agent uses the model best suited to its task.
- **Tool-grounded numerics** — Pricing/JCR query real loaded-labor data; they
  do not generate numbers.
- **Closed-loop intelligence** — every reconciled job updates the margin
  profile that feeds the next bid's Pricing agent. This is the moat.
""")
