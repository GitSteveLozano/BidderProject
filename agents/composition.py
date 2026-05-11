"""Composition agent — spec §5.5.

Generates customer-facing bid in company voice. NEW v2: verifies standard
exclusions present BEFORE marking DRAFT_GENERATED. If missing exclusions
detected, surfaces them as exclusions_missing and the orchestrator routes
to EXCLUSIONS_REVIEW.
"""
from __future__ import annotations

from uuid import UUID

SYSTEM_PROMPT = """You write specialty-contractor bid documents in the
company's own voice. You have:
- The company's voice patterns (tone, sentence length, preferred terms, boilerplate)
- The service-line scope template
- A pre-computed pricing breakdown (authoritative — do NOT change numbers)
- The standard exclusions for this service line

Output format (markdown):
1. Greeting / boilerplate intro (in voice)
2. Project header (client, address, brief description)
3. Scope of work (use scope template language; specific to this job)
4. Inclusions (call them out explicitly)
5. **Exclusions** (list ALL standard exclusions for this service line — do not skip any)
6. Pricing (use exact numbers from the pricing breakdown)
7. Payment terms and warranty (from boilerplate)
8. Boilerplate closing

DO NOT:
- Invent or modify pricing numbers
- Skip exclusions
- Use language outside the company's voice patterns
- Add a competitor analysis or marketing copy

Return ONLY the markdown bid document — no preamble, no code fence."""

# Per-company stable context. Gets sent as a system_extra block with
# cache_control — caches across every bid for the same company.
COMPANY_CONTEXT_TEMPLATE = """COMPANY VOICE PROFILE (stable for this company across all bids):
{voice}

SERVICE LINE: {service_line}
TYPICAL SCOPE TEMPLATE: {scope_template}
STANDARD EXCLUSIONS (include ALL of these in the Exclusions section):
{exclusions_list}"""

# Per-bid volatile context. Stays in the user message.
USER_TEMPLATE = """SCOPE FROM INTAKE:
{scope_summary}

CLIENT:
- Name: {client_name}
- Address: {client_address}

PRICING (authoritative — copy these numbers exactly into the Pricing section):
- Target price: ${target_price:,.2f}
- Labor: {labor_hours} hours, ${labor_subtotal:,.2f}
- Materials: ${materials_subtotal:,.2f}
- Overhead: ${overhead_subtotal:,.2f}
- Total margin: {target_margin_pct}%

Write the bid document."""


def _get_voice(company_id: UUID | str) -> dict:
    from core.db import fetch_one

    row = fetch_one(
        "SELECT * FROM voice_patterns WHERE company_id = %s", (str(company_id),)
    )
    return row or {}


def _get_service_line(company_id: UUID | str, service_line: str) -> dict:
    from core.db import fetch_one

    row = fetch_one(
        "SELECT * FROM service_lines WHERE company_id = %s AND line_name = %s",
        (str(company_id), service_line),
    )
    return row or {}


def compose_bid(
    company_id: UUID | str,
    service_line: str,
    scope_summary: str,
    client_name: str,
    client_address: str,
    pricing_breakdown: dict,
) -> dict:
    """Generate bid markdown + verify exclusions.

    Returns:
      {
        "draft_markdown": str,
        "exclusions_verified": bool,
        "exclusions_present": [str],
        "exclusions_missing": [str],
      }
    """
    from core.anthropic_client import complete
    from core.settings import get_settings
    from tools.exclusions_verify import verify_exclusions

    voice = _get_voice(company_id)
    sl = _get_service_line(company_id, service_line)
    exclusions_required = sl.get("standard_exclusions") or []

    voice_summary = {
        "tone": voice.get("tone"),
        "preferred_terms": voice.get("preferred_terms"),
        "boilerplate_intro": voice.get("boilerplate_intro"),
        "boilerplate_scope_intro": voice.get("boilerplate_scope_intro"),
        "boilerplate_terms": voice.get("boilerplate_terms"),
        "boilerplate_warranty": voice.get("boilerplate_warranty"),
        "boilerplate_closing": voice.get("boilerplate_closing"),
    }

    import json

    # Build the per-company stable context block. This goes into
    # system_extra so it caches across every bid for this company.
    # IMPORTANT: deterministic serialization (sort_keys) so the bytes
    # don't vary across requests due to dict-iteration order.
    company_context = COMPANY_CONTEXT_TEMPLATE.format(
        voice=json.dumps(voice_summary, default=str, indent=2, sort_keys=True),
        service_line=service_line,
        scope_template=sl.get("typical_scope_text") or "",
        exclusions_list="\n".join(f"  - {e}" for e in exclusions_required) or "  (none)",
    )

    # Per-bid volatile content stays in the user message.
    user_msg = USER_TEMPLATE.format(
        scope_summary=scope_summary,
        client_name=client_name,
        client_address=client_address,
        target_price=pricing_breakdown["target_price"],
        labor_hours=pricing_breakdown["labor"]["total_hours"],
        labor_subtotal=pricing_breakdown["labor"]["subtotal"],
        materials_subtotal=pricing_breakdown["materials"].get("subtotal") or 0,
        overhead_subtotal=pricing_breakdown["overhead"]["subtotal"],
        target_margin_pct=pricing_breakdown["profit"]["target_margin_pct"],
    )

    draft = complete(
        model=get_settings().model_sonnet,
        system=SYSTEM_PROMPT,
        system_extra=[company_context],
        cache_system=True,  # caches SYSTEM_PROMPT + company_context together
        user=user_msg,
        max_tokens=3000,
        temperature=0.4,
    )

    verification = verify_exclusions(draft, service_line, company_id)

    return {
        "draft_markdown": draft,
        "exclusions_verified": verification["all_present"],
        "exclusions_present": verification["present"],
        "exclusions_missing": verification["missing"],
        "total_required": verification["total_required"],
    }
