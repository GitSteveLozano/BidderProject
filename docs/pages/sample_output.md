---
title: Sample output
---

# Sample output

What the system produces, rendered statically. These are examples of
each agent's structured output for the canonical demo scenario:
**Esprit Heights Phase 2 — EIFS package** sent to Honolulu Stucco &
Exteriors LLC (Cavy archetype).

---

## 1. Intake agent — scope email → structured JSON

**Input:** `data/raw/sample_inputs/scope_email_esprit_heights.txt` —
a 30-line scope email from McKenzie GC.

**Output:**

```json
{
  "document_id": "doc-01-esprit",
  "document_classification": "scope_email",
  "client_info": {
    "client_name": "McKenzie General Contractors",
    "client_address": "1245 Esprit Drive, Honolulu HI 96817",
    "project_name": "Esprit Heights Phase 2"
  },
  "service_line_hint": "EIFS",
  "scope_items": [
    {"description": "Exterior wall EIFS, four-story walk-up", "quantity": 3200, "unit": "sqft"},
    {"description": "ADEX system, dark-bronze acrylic finish", "quantity": null, "unit": null}
  ],
  "exclusions_mentioned": [
    "Sheet metal flashings (by Maui Sheet Metal)",
    "Painting (by separate trade)"
  ],
  "inclusions_mentioned": [
    "Substrate already in place",
    "Permit in hand"
  ],
  "pricing_mentioned": {"total": null, "currency": "USD"},
  "deadline": "2026-06-08",
  "addenda_or_changes": [
    "Lift access north + east only; west + south require swing-stage",
    "Noise/dust mitigation weekday afternoons (occupied adjacent units)"
  ],
  "confidence_score": 0.91
}
```

---

## 2. Pricing agent — tool-grounded breakdown

**Tool calls Claude made (visible in the UI's agent trail):**

1. `get_loaded_labor_cost(trade="eifs", hours=312)` →
   `{avg_loaded_rate: 61.74, labor_subtotal: 19262.88, n_employees: 1, citation: "...EIFS Installer..."}`
2. `get_loaded_labor_cost(trade="helper", hours=80)` →
   `{avg_loaded_rate: 31.46, labor_subtotal: 2516.80, citation: "...general_laborer..."}`
3. `lookup_material_cost(service_line="EIFS", quantity=3200)` →
   `{subtotal: 39744.00, citation: "3200sqft × 1.08 × $11.50"}`
4. `get_capacity_utilization(start_date="2026-06-08", weeks=4)` →
   `{avg_utilization: 0.82, recommended_modifier: {action: "hold_firm", rationale: "schedule full"}}`
5. `get_win_rate_at_price(service_line="EIFS", target_price=89500)` →
   `{win_rate: 0.72, n_comparable: 8}`

**Output (synthesized from tool results, no number from text):**

```json
{
  "labor": {
    "by_trade": [
      {"trade": "eifs", "hours": 312, "avg_loaded_rate": 61.74, "labor_subtotal": 19262.88},
      {"trade": "helper", "hours": 80, "avg_loaded_rate": 31.46, "labor_subtotal": 2516.80}
    ],
    "subtotal": 21779.68,
    "total_hours": 392
  },
  "materials": {"subtotal": 39744.00},
  "overhead": {"pct": 18.0, "subtotal": 11074.26},
  "profit": {"subtotal": 26731.86, "target_margin_pct": 32.0},
  "target_price": 99329.80,
  "range_low": 92775.40,
  "range_high": 115040.00,
  "capacity_utilization_at_start": 0.82,
  "capacity_modifier": {
    "action": "hold_firm",
    "modifier_pct": 0.0,
    "rationale": "Schedule is 82% full for the start window — hold target price"
  },
  "win_rate_estimate": {"win_rate": 0.72, "n_comparable": 8},
  "narrative": "Recommended target price: $99,329 (range $92,775–$115,040). Labor is 392 hours across the EIFS team at $55-62 loaded; materials at $39,744 for the ADEX system. Schedule is 82% full at the estimated start, so hold firm at target — no schedule-fill discount needed. Historical win rate at this band: 72% across 8 comparable bids."
}
```

---

## 3. Composition agent — bid in Cavy's voice (excerpt)

```markdown
Thank you for the opportunity to provide a quote on this project. We are
pleased to offer the following based on the scope and drawings supplied.

**Project: Esprit Heights Phase 2**
**Owner: Esprit Heights LLC**
**GC: McKenzie General Contractors**

Our scope of work consists of the following:

  - Installation of complete ADEX EIFS system over substrate provided by
    others (sheathed steel stud with weather-resistive barrier)
  - Approximately 3,200 sqft of EIFS to building exterior
  - EPS insulation, base coat with reinforcing mesh, finish coat
  - Standard heavy-duty mesh at impact zones (ground to +8'-0")
  - Dark-bronze acrylic finish per owner selection
  - Daily cleanup of our work areas
  - One mockup panel for owner approval prior to full production

**Excluded:**

  - Rough grade should not be above final grade height
  - Substrate preparation beyond cleaning and minor patching
  - Sealants between dissimilar materials (by others)
  - Sheet metal flashings (by Maui Sheet Metal)
  - Painting beyond integral finish color
  - Permits, engineering, and design
  - Repair of damage caused by other trades or weather events
  - Caulking of dissimilar material joints (by GC or others)

**PRICING**

  EIFS package — 3,200 sqft                            $99,329.80

  Schedule of values:
    Labor (392 hours at avg $55.56 loaded)             $21,779.68
    Materials (ADEX system + accessories)              $39,744.00
    Overhead (18%)                                     $11,074.26
    Profit                                             $26,731.86

Pricing is valid for 30 days from the date of this quote. Net 30 from
invoice unless otherwise agreed. Progress draws available on jobs
exceeding 4 weeks.

All workmanship is warranted for one year from substantial completion.
Material warranties pass through from manufacturer.

Please call with any questions. We appreciate the opportunity and look
forward to working with you.

Cavy Henderson
Honolulu Stucco & Exteriors LLC
```

The Composition agent's `verify_exclusions` step confirms all 8
standard EIFS exclusions appear in the draft. Had any been missing
the state machine would have routed to `EXCLUSIONS_REVIEW` and the
human would have decided which to add and which to skip.

---

## 4. JCR agent — quoted vs actual (post-completion)

When the job completes 6 weeks later, payroll has logged the actual
hours. The JCR agent runs:

```json
{
  "bid_id": "bid-esprit-eifs",
  "quoted_price": 99329.80,
  "quoted_labor_hours": 392,
  "quoted_labor_cost": 21779.68,
  "quoted_material_cost": 39744.00,
  "actual_labor_hours": 451,
  "actual_labor_cost": 25055.56,
  "actual_material_cost": 41200.00,
  "actual_other_costs": 0,
  "delivered_margin_pct": 26.4,
  "variance_labor_hours_pct": 15.05,
  "variance_total_cost_pct": 6.66,
  "narrative": "Job: Esprit Heights Phase 2 EIFS package, quoted $99,329 at 32% target margin. Actual: 451 labor hours via payroll (+15.1% vs quoted 392), $25,055 labor cost, $41,200 materials, total cost $66,255. Delivered margin: 26.4%. Pattern alert: 3 of last 4 EIFS jobs ran 12-18% over labor hour estimates. Consider updating EIFS labor hour formula by +12-15%."
}
```

---

## 5. Intelligence agent — capacity-aware insight

After 8 reconciled EIFS jobs accumulate the pattern, the Intelligence
agent's weekly run surfaces:

```json
{
  "category": "margin",
  "severity": "medium",
  "headline": "EIFS delivered margin down 5.6pp vs target over last 8 jobs",
  "finding": "Average delivered margin on EIFS jobs is 26.4% vs target 32%. 3 of last 4 EIFS jobs ran labor hours 12-18% over quote. ADEX-system install productivity assumption appears to need recalibration. Pattern is consistent across two installers and three GC clients, suggesting the issue is the formula, not the team.",
  "recommendation": "Add +12% labor hour buffer on next 3 EIFS quotes; measure outcomes; adjust formula.",
  "projected_impact": "Recover ~$4,800 margin per $100K EIFS revenue if formula updated",
  "supporting_bids": ["bid-1", "bid-2", "..."]
}
```

This is the loop the Intelligence agent watches:

```
JCR variance → service_lines.typical_margin_pct drift → Intelligence flags it
   → contractor adjusts formula → next Pricing recommendation reflects it
   → next JCR confirms or refutes
```

That's the moat. It compounds with every reconciled job.
