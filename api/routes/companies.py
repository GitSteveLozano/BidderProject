"""Companies + onboarding routes."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents import context as context_agent
from core.db import execute, fetch_all, fetch_one

router = APIRouter()


class CompanyIn(BaseModel):
    name: str
    primary_trade: str | None = None
    segment: str = "repeat_customer"


@router.get("/")
def list_companies() -> list[dict]:
    return fetch_all("SELECT id, name, segment, onboarded_at FROM companies ORDER BY name")


@router.post("/")
def create_company(payload: CompanyIn) -> dict:
    row = fetch_one(
        """
        INSERT INTO companies (name, primary_trade, segment)
        VALUES (%s, %s, %s)
        RETURNING id, name, segment
        """,
        (payload.name, payload.primary_trade, payload.segment),
    )
    return row or {}


@router.get("/{company_id}")
def get_company(company_id: UUID) -> dict:
    profile = context_agent.get_company_profile(company_id)
    if not profile.get("company"):
        raise HTTPException(404, "company not found")
    return profile


@router.post("/{company_id}/onboard")
def onboard(company_id: UUID) -> dict:
    """Layer 1 — Contextual Onboarding. Spec §7.1.

    Runs Context agent to extract voice, service lines, pricing logic from
    uploaded past quotes.
    """
    voice = context_agent.extract_voice_patterns(company_id)
    service_lines = context_agent.extract_service_lines(company_id)

    if voice.get("error"):
        raise HTTPException(400, voice["error"])

    execute(
        """
        INSERT INTO voice_patterns (
            company_id, tone, avg_sentence_length, preferred_terms, avoided_terms,
            boilerplate_intro, boilerplate_scope_intro, boilerplate_terms,
            boilerplate_warranty, boilerplate_closing, formatting
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (company_id) DO UPDATE SET
            tone = EXCLUDED.tone,
            avg_sentence_length = EXCLUDED.avg_sentence_length,
            preferred_terms = EXCLUDED.preferred_terms,
            avoided_terms = EXCLUDED.avoided_terms,
            boilerplate_intro = EXCLUDED.boilerplate_intro,
            boilerplate_scope_intro = EXCLUDED.boilerplate_scope_intro,
            boilerplate_terms = EXCLUDED.boilerplate_terms,
            boilerplate_warranty = EXCLUDED.boilerplate_warranty,
            boilerplate_closing = EXCLUDED.boilerplate_closing,
            formatting = EXCLUDED.formatting,
            last_extracted_at = NOW()
        """,
        (
            str(company_id),
            voice.get("tone"),
            voice.get("avg_sentence_length"),
            _json(voice.get("preferred_terms")),
            voice.get("avoided_terms"),
            voice.get("boilerplate_intro"),
            voice.get("boilerplate_scope_intro"),
            voice.get("boilerplate_terms"),
            voice.get("boilerplate_warranty"),
            voice.get("boilerplate_closing"),
            _json(voice.get("formatting")),
        ),
    )

    for sl in service_lines:
        execute(
            """
            INSERT INTO service_lines (
                company_id, line_name, typical_scope_text, standard_exclusions,
                pricing_unit, pricing_range_residential, pricing_range_commercial,
                typical_margin_pct, manufacturers_referenced
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (company_id, line_name) DO UPDATE SET
                typical_scope_text = EXCLUDED.typical_scope_text,
                standard_exclusions = EXCLUDED.standard_exclusions,
                pricing_unit = EXCLUDED.pricing_unit,
                pricing_range_residential = EXCLUDED.pricing_range_residential,
                pricing_range_commercial = EXCLUDED.pricing_range_commercial,
                typical_margin_pct = EXCLUDED.typical_margin_pct,
                manufacturers_referenced = EXCLUDED.manufacturers_referenced,
                last_extracted_at = NOW()
            """,
            (
                str(company_id),
                sl.get("line_name"),
                sl.get("typical_scope_text"),
                sl.get("standard_exclusions"),
                sl.get("pricing_unit"),
                _json(sl.get("pricing_range_residential")),
                _json(sl.get("pricing_range_commercial")),
                sl.get("typical_margin_pct"),
                sl.get("manufacturers_referenced"),
            ),
        )

    execute(
        "UPDATE companies SET onboarded_at = NOW() WHERE id = %s",
        (str(company_id),),
    )

    return {
        "company_id": str(company_id),
        "voice_extracted": bool(voice.get("tone")),
        "service_lines_extracted": len(service_lines),
        "voice": voice,
        "service_lines": service_lines,
    }


class QueryIn(BaseModel):
    query: str


@router.post("/{company_id}/query")
def query(company_id: UUID, payload: QueryIn) -> dict:
    return context_agent.answer_query(company_id, payload.query)


def _json(obj):
    import json
    return json.dumps(obj, default=str) if obj is not None else None
