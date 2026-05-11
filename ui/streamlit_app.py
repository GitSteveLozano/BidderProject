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
        "Job-Cost Reconciliation",
        "Intelligence Dashboard",
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
        with st.expander("Numeric trail (every number traces to a tool call)"):
            st.json(pb)
        st.markdown("**Pricing rationale:** " + pb["narrative"])

        comp = result["composition"]
        st.subheader("Generated bid draft")
        if not comp["exclusions_verified"]:
            st.warning(
                f"⚠️  Composition flagged {len(comp['exclusions_missing'])} "
                f"missing exclusions. State: EXCLUSIONS_REVIEW."
            )
            for e in comp["exclusions_missing"]:
                st.markdown(f"- {e}")
        else:
            st.success(f"✅  {comp['total_required']} standard exclusions verified present.")
        st.markdown(comp["draft_markdown"])


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
            st.write(f"**State:** `{bid['state']}`")
            st.write(f"**Estimated value:** ${float(bid['estimated_value'] or 0):,.2f}")

            with st.expander("State history (agent trail)"):
                st.dataframe(pd.DataFrame(history), use_container_width=True)

            with st.expander("Pricing breakdown"):
                st.json(bid.get("pricing_breakdown"))


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
