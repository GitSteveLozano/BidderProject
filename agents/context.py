"""Context agent — spec §5.3.

Owns the company profile. Answers questions about voice, service lines,
scope language, exclusions, pricing logic, history. Reads from
voice_patterns, service_lines, pricing_logic, scope_patterns.
"""
from __future__ import annotations

import json
from uuid import UUID

from core.anthropic_client import complete, complete_json
from core.db import fetch_all, fetch_one
from core.settings import get_settings
from tools.vector_search import search_documents

EXTRACT_VOICE_SYSTEM = """You analyze past quotes from a specialty contractor and
extract their writing voice patterns. You return strict JSON.

You identify:
- tone (e.g. "direct, no-nonsense, formal")
- avg_sentence_length in words
- preferred_terms (terms the contractor uses where alternatives exist)
- avoided_terms (industry terms the contractor never uses)
- boilerplate sections (intro, scope intro, terms, warranty, closing)
"""

EXTRACT_VOICE_USER = """Past quote samples (numbered):
{samples}

Return JSON exactly in this shape:
{{
  "tone": str,
  "avg_sentence_length": int,
  "preferred_terms": {{"category": [str]}},
  "avoided_terms": [str],
  "boilerplate_intro": str,
  "boilerplate_scope_intro": str,
  "boilerplate_terms": str,
  "boilerplate_warranty": str,
  "boilerplate_closing": str,
  "formatting": {{
    "uses_bullet_points": bool,
    "section_headers": bool,
    "all_caps_emphasis": bool
  }}
}}

Return ONLY the JSON object."""


EXTRACT_SERVICE_LINES_SYSTEM = """You analyze past quotes from a specialty
contractor and extract their service-line taxonomy. Each service line has its
own typical scope, standard exclusions, pricing logic, and price range.

You return strict JSON."""

EXTRACT_SERVICE_LINES_USER = """Past quote samples (numbered):
{samples}

Identify each distinct service line and return JSON in exactly this shape:
{{
  "service_lines": [
    {{
      "line_name": str,
      "typical_scope_text": str,
      "standard_exclusions": [str],
      "pricing_unit": "lump_sum|per_sqft|per_lf|hourly",
      "pricing_range_residential": {{"low": number, "mid": number, "high": number}}|null,
      "pricing_range_commercial": {{"low": number, "mid": number, "high": number}}|null,
      "typical_margin_pct": number|null,
      "manufacturers_referenced": [str]
    }}
  ]
}}

Return ONLY the JSON."""


def _get_company_documents(company_id: UUID | str, doc_type: str = "past_quote") -> list[dict]:
    return fetch_all(
        """
        SELECT id, filename, raw_text, structured_data
        FROM documents
        WHERE company_id = %s AND type = %s
        ORDER BY uploaded_at DESC
        LIMIT 20
        """,
        (str(company_id), doc_type),
    )


def extract_voice_patterns(company_id: UUID | str) -> dict:
    """Extract voice patterns from past quotes. Writes to voice_patterns."""
    docs = _get_company_documents(company_id)
    if not docs:
        return {"error": "no past quotes for company", "n_documents": 0}
    samples = "\n\n---\n\n".join(
        f"QUOTE #{i+1} ({d['filename']}):\n{(d['raw_text'] or '')[:3000]}"
        for i, d in enumerate(docs[:10])
    )
    result = complete_json(
        model=get_settings().model_sonnet,
        system=EXTRACT_VOICE_SYSTEM,
        user=EXTRACT_VOICE_USER.format(samples=samples),
        max_tokens=2048,
        temperature=0.2,
    )
    result["n_documents"] = len(docs)
    result["confidence"] = "low" if len(docs) < 3 else "ok"
    return result


def extract_service_lines(company_id: UUID | str) -> list[dict]:
    docs = _get_company_documents(company_id)
    if not docs:
        return []
    samples = "\n\n---\n\n".join(
        f"QUOTE #{i+1} ({d['filename']}):\n{(d['raw_text'] or '')[:3000]}"
        for i, d in enumerate(docs[:10])
    )
    result = complete_json(
        model=get_settings().model_sonnet,
        system=EXTRACT_SERVICE_LINES_SYSTEM,
        user=EXTRACT_SERVICE_LINES_USER.format(samples=samples),
        max_tokens=3000,
        temperature=0.2,
    )
    return result.get("service_lines", [])


def get_company_profile(company_id: UUID | str) -> dict:
    """Pull all profile tables for the company in one call."""
    company = fetch_one("SELECT * FROM companies WHERE id = %s", (str(company_id),))
    voice = fetch_one("SELECT * FROM voice_patterns WHERE company_id = %s", (str(company_id),))
    service_lines = fetch_all(
        "SELECT * FROM service_lines WHERE company_id = %s ORDER BY line_name",
        (str(company_id),),
    )
    pricing = fetch_one(
        "SELECT * FROM pricing_logic WHERE company_id = %s", (str(company_id),)
    )
    scope = fetch_one(
        "SELECT * FROM scope_patterns WHERE company_id = %s", (str(company_id),)
    )
    return {
        "company": company,
        "voice_patterns": voice,
        "service_lines": service_lines,
        "pricing_logic": pricing,
        "scope_patterns": scope,
    }


def answer_query(company_id: UUID | str, query: str) -> dict:
    """Synthesize an answer about a company using retrieved context."""
    profile = get_company_profile(company_id)
    hits = search_documents(company_id, query, limit=5)
    context_chunks = "\n\n".join(
        f"[doc:{h['id']}, sim={h['similarity']:.2f}]\n{(h.get('raw_text') or '')[:1500]}"
        for h in hits
    )
    profile_json = json.dumps(
        {
            "service_lines": [s["line_name"] for s in profile["service_lines"]],
            "target_margin_pct": (profile.get("pricing_logic") or {}).get("target_margin_pct"),
            "segment": (profile.get("company") or {}).get("segment"),
        },
        default=str,
    )
    answer = complete(
        model=get_settings().model_sonnet,
        system=(
            "You synthesize accurate answers about a specialty contractor from their "
            "company profile and retrieved past documents. Cite document IDs inline as "
            "[doc:<id>]. If insufficient evidence, say so explicitly."
        ),
        user=f"Profile: {profile_json}\n\nRetrieved context:\n{context_chunks}\n\nQuestion: {query}",
        max_tokens=1024,
        temperature=0.3,
    )
    return {
        "answer": answer,
        "citations": [str(h["id"]) for h in hits],
        "confidence": "low" if len(hits) < 2 else "ok",
    }
