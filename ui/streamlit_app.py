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
        submitted = st.form_submit_button("Run all 4 generation agents")

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
        with st.status("Running assessment...", expanded=True) as status:
            st.write("→ Pricing agent: querying loaded labor costs + capacity")
            result = orchestrator.run_assessment(
                bid_id=bid_id,
                labor_plan=[
                    {"trade": primary_trade, "hours": primary_hours},
                    {"trade": "helper", "hours": helper_hours},
                ],
                material_quantity=material_qty,
            )
            st.write("→ Composition agent: drafting bid in company voice")
            st.write("→ Composition agent: verifying standard exclusions")
            status.update(label=f"Done. State = **{result['state']}**", state="complete")

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
        st.markdown("**Pricing rationale:** " + pb["narrative"])

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
