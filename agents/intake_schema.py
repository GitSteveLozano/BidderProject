"""Pydantic schemas for the Intake agent's structured output.

These define the exact shape Claude must return via
`client.messages.parse(output_format=IntakeResult)`. Pydantic validates
the response — if Claude returns anything malformed, the SDK raises
instead of silently passing junk downstream.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ClientInfo(BaseModel):
    client_name: str | None = None
    client_address: str | None = None
    project_name: str | None = None


class ScopeItem(BaseModel):
    description: str
    quantity: float | None = None
    unit: str | None = None


class PricingMentioned(BaseModel):
    total: float | None = None
    labor_subtotal: float | None = None
    material_subtotal: float | None = None
    currency: str = "USD"


# Constrain service_line_hint to the values Composition + Pricing expect
ServiceLineHint = Literal[
    "STUCCO-CONVENTIONAL",
    "STUCCO-textured acrylic",
    "EIFS",
    "Siding",
    "METAL WORK",
    "RESTUCCO",
    "REPAIR",
    "DEMOLITION",
    "INTERIOR-DOORS",
    "CUSTOM-CABINETRY",
    "ARCHITECTURAL-PANELS",
    "BASE-CASING",
    "BRAND-IDENTITY",
    "WEBSITE-PROJECT",
    "ONGOING-RETAINER",
    "other",
]


DocumentClassification = Literal[
    "past_quote", "rfp", "drawings", "scope_email", "change_request",
]


class IntakeResult(BaseModel):
    """The Intake agent's structured output — what every downstream
    agent consumes."""

    document_classification: DocumentClassification
    client_info: ClientInfo = Field(default_factory=ClientInfo)
    service_line_hint: ServiceLineHint | None = None
    scope_items: list[ScopeItem] = Field(default_factory=list)
    exclusions_mentioned: list[str] = Field(default_factory=list)
    inclusions_mentioned: list[str] = Field(default_factory=list)
    pricing_mentioned: PricingMentioned = Field(default_factory=PricingMentioned)
    deadline: str | None = None  # ISO date; kept as string for flexibility
    addenda_or_changes: list[str] = Field(default_factory=list)
    confidence_score: float = Field(ge=0.0, le=1.0)
