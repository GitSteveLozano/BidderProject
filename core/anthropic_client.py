"""Anthropic client wrapper.

One client per process. Bare SDK per spec §12.4 — no framework layer.

Prompt caching is supported on `complete()` and `complete_json()` via two
parameters:
  - `cache_system`: when True, marks the last system block with
    `cache_control: {type: "ephemeral"}`. Used for the frozen SYSTEM_PROMPT.
  - `system_extra`: optional list of additional system blocks appended
    AFTER the primary system prompt and BEFORE the user message. Useful
    for per-company stable context (voice patterns, service-line
    template). The breakpoint goes on the last of these blocks.

Render order on the wire: tools → system blocks → messages. Caching is a
prefix match — any byte change anywhere in the prefix invalidates
everything after it.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from core.settings import get_settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_client():
    import anthropic

    return anthropic.Anthropic(api_key=get_settings().anthropic_api_key)


def _build_system(
    system: str,
    cache_system: bool,
    system_extra: list[str] | None,
) -> str | list[dict]:
    """Return either a bare string (no caching) or a list of system blocks
    with `cache_control` on the last cacheable block.

    The single most stable string sits first. If `system_extra` blocks
    are provided, they render after the primary system and the cache
    breakpoint anchors on the last extra block — so per-company stable
    context caches together with the frozen system prompt.
    """
    if not cache_system and not system_extra:
        return system  # bare string — no caching

    blocks: list[dict[str, Any]] = [{"type": "text", "text": system}]
    if system_extra:
        for extra in system_extra:
            blocks.append({"type": "text", "text": extra})
    if cache_system:
        # Anchor breakpoint on the LAST block (system or extra). This
        # caches the entire system prefix.
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
    return blocks


def complete(
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2048,
    temperature: float = 0.4,
    cache_system: bool = False,
    system_extra: list[str] | None = None,
) -> str:
    """One-shot text completion. Returns the assistant's text content."""
    system_payload = _build_system(system, cache_system, system_extra)
    msg = get_client().messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_payload,
        messages=[{"role": "user", "content": user}],
    )
    if cache_system:
        usage = getattr(msg, "usage", None)
        if usage is not None:
            logger.info(
                "anthropic_cache",
                extra={
                    "cache_read_tokens": getattr(usage, "cache_read_input_tokens", 0),
                    "cache_create_tokens": getattr(usage, "cache_creation_input_tokens", 0),
                    "input_tokens": getattr(usage, "input_tokens", 0),
                    "output_tokens": getattr(usage, "output_tokens", 0),
                    "model": model,
                },
            )
    parts = [block.text for block in msg.content if getattr(block, "type", None) == "text"]
    return "".join(parts).strip()


def complete_stream(
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2048,
    temperature: float = 0.4,
    cache_system: bool = False,
    system_extra: list[str] | None = None,
):
    """Streaming text completion.

    Yields text deltas as they arrive. Caller composes the final string
    by concatenation, or by calling .get_final_message() on the stream
    helper. We use the recommended `client.messages.stream()` context
    manager, which accumulates state and exposes `text_stream`.
    """
    system_payload = _build_system(system, cache_system, system_extra)
    client = get_client()
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_payload,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        for text in stream.text_stream:
            yield text


def parse_structured(
    model: str,
    system: str,
    user: str,
    output_format: Any,
    max_tokens: int = 2048,
    temperature: float = 0.1,
    cache_system: bool = False,
    system_extra: list[str] | None = None,
):
    """Schema-validated completion via `client.messages.parse()`.

    `output_format` is a Pydantic model class. The SDK forces Claude to
    return JSON matching the model's JSON schema and validates the
    response. Returns the parsed Pydantic instance, not a dict.
    """
    system_payload = _build_system(system, cache_system, system_extra)
    response = get_client().messages.parse(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_payload,
        messages=[{"role": "user", "content": user}],
        output_format=output_format,
    )
    return response.parsed_output


def complete_json(
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2048,
    temperature: float = 0.1,
    cache_system: bool = False,
    system_extra: list[str] | None = None,
) -> dict:
    """Force-JSON completion. Strips code fences if present, parses to dict."""
    import json
    import re

    raw = complete(
        model, system, user,
        max_tokens=max_tokens,
        temperature=temperature,
        cache_system=cache_system,
        system_extra=system_extra,
    )
    fenced = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", raw, re.DOTALL)
    payload = fenced.group(1) if fenced else raw
    if not payload.lstrip().startswith(("{", "[")):
        match = re.search(r"(\{.*\}|\[.*\])", payload, re.DOTALL)
        if match:
            payload = match.group(1)
    return json.loads(payload)
