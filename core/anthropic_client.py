"""Anthropic client wrapper.

One client per process. The bare SDK is fine for this scope; no framework
layer per spec §12.4.
"""
from __future__ import annotations

from functools import lru_cache

from core.settings import get_settings


@lru_cache(maxsize=1)
def get_client():
    import anthropic

    return anthropic.Anthropic(api_key=get_settings().anthropic_api_key)


def complete(
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2048,
    temperature: float = 0.4,
) -> str:
    """One-shot text completion. Returns the assistant's text content."""
    msg = get_client().messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    parts = [block.text for block in msg.content if getattr(block, "type", None) == "text"]
    return "".join(parts).strip()


def complete_json(
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2048,
    temperature: float = 0.1,
) -> dict:
    """Force-JSON completion. Strips code fences if present, parses to dict."""
    import json
    import re

    raw = complete(model, system, user, max_tokens=max_tokens, temperature=temperature)
    fenced = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", raw, re.DOTALL)
    payload = fenced.group(1) if fenced else raw
    # Fallback: find first {...} or [...] span
    if not payload.lstrip().startswith(("{", "[")):
        match = re.search(r"(\{.*\}|\[.*\])", payload, re.DOTALL)
        if match:
            payload = match.group(1)
    return json.loads(payload)
