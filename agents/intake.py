"""Intake agent — spec §5.2.

Parse uploaded documents (RFPs, drawings, scope emails, change requests,
past quotes) into structured data. Model: Haiku 4.5 with construction
few-shots; Sonnet fallback for ambiguous documents.
"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You parse construction-industry documents into structured JSON.

Document types you handle:
- past_quote: a contractor's prior estimate (line items, exclusions, pricing)
- rfp: a request for proposal from a general contractor or owner
- drawings: architectural / construction drawings (cover page + sheet list usually)
- scope_email: an informal scope description sent over email
- change_request: a request to change scope or pricing on an existing bid

You ALWAYS return valid JSON matching the schema described in the user message.
You do NOT invent fields. Missing fields → null. Low confidence → confidence_score < 0.7.

You recognize specialty-contractor terminology:
- Stucco service lines: STUCCO-CONVENTIONAL, STUCCO-textured acrylic, EIFS, RESTUCCO
- Siding service lines: hardie, gentek, LUX, metal cladding
- Common exclusions: rough grade above final grade, painting, caulking joints,
  electrical, plumbing, permitting
- Pricing units: lump_sum, per_sqft, per_lf, hourly
"""

USER_TEMPLATE = """Document filename: {filename}
Document type hint (may be wrong): {hint}

Document text (first 8000 chars):
---
{text}
---

Return JSON in exactly this shape:
{{
  "document_classification": "past_quote|rfp|drawings|scope_email|change_request",
  "client_info": {{
    "client_name": str|null,
    "client_address": str|null,
    "project_name": str|null
  }},
  "service_line_hint": "STUCCO-CONVENTIONAL|STUCCO-textured acrylic|EIFS|Siding|METAL WORK|RESTUCCO|REPAIR|DEMOLITION|other"|null,
  "scope_items": [
    {{"description": str, "quantity": number|null, "unit": str|null}}
  ],
  "exclusions_mentioned": [str],
  "inclusions_mentioned": [str],
  "pricing_mentioned": {{
    "total": number|null,
    "labor_subtotal": number|null,
    "material_subtotal": number|null,
    "currency": "USD"
  }},
  "deadline": "YYYY-MM-DD"|null,
  "addenda_or_changes": [str],
  "confidence_score": number  // 0.0 to 1.0
}}

Return ONLY the JSON object — no prose, no code fence."""


def run(document_id: str, filename: str, text: str, document_type_hint: str | None = None) -> dict:
    """Public contract per spec §5.2.

    Inputs: document_id (uuid str), filename, raw text, optional type hint.
    Output: structured JSON dict (see USER_TEMPLATE).
    """
    from core.anthropic_client import complete_json, parse_structured
    from core.settings import get_settings
    from tools.pdf_extraction import classify_document_hint

    settings = get_settings()
    hint = document_type_hint or classify_document_hint(filename, text)
    user_msg = USER_TEMPLATE.format(filename=filename, hint=hint, text=text[:8000])

    # Preferred path: schema-validated structured output via messages.parse().
    # Falls back to the hand-rolled complete_json path on:
    #  - older SDK versions that don't expose .parse() / parsed_output
    #  - JSON parse failures on Haiku (rare with parse() but kept for safety)
    try:
        from agents.intake_schema import IntakeResult

        parsed = parse_structured(
            model=settings.model_haiku,
            system=SYSTEM_PROMPT,
            user=user_msg,
            output_format=IntakeResult,
            max_tokens=2048,
            temperature=0.1,
        )
        result = parsed.model_dump() if hasattr(parsed, "model_dump") else dict(parsed)
    except (AttributeError, ImportError, json.JSONDecodeError) as parse_err:
        logger.warning("Intake .parse() unavailable or failed: %s; falling back", parse_err)
        try:
            result = complete_json(
                model=settings.model_haiku,
                system=SYSTEM_PROMPT,
                user=user_msg,
                max_tokens=2048,
                temperature=0.1,
            )
        except json.JSONDecodeError:
            logger.warning("Intake Haiku JSON parse failed, retrying with Sonnet")
            result = complete_json(
                model=settings.model_sonnet,
                system=SYSTEM_PROMPT,
                user=user_msg,
                max_tokens=2048,
                temperature=0.1,
            )

    result["document_id"] = document_id
    result.setdefault("confidence_score", 0.5)
    if result["confidence_score"] < 0.7:
        result["needs_human_review"] = True
    return result
