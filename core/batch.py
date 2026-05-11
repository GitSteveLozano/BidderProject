"""Anthropic Message Batches API helpers.

The Intelligence agent's weekly task makes one LLM call per insight
per company — typically dozens of independent narrative calls. Batch
mode cuts those costs by 50% in exchange for async processing (most
batches finish under 1 hour; 24-hour SLA).

This module wraps the SDK's batch creation + result polling so callers
can submit a list of (custom_id, system, user, ...) tuples and get
back results keyed by custom_id when the batch completes.

The Celery beat task `core.tasks.run_intelligence_for_all_companies`
can be switched to use this by setting `INTELLIGENCE_USE_BATCH=true`.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from core.settings import get_settings

logger = logging.getLogger(__name__)


def submit_batch(
    requests: list[dict],
    poll: bool = True,
    poll_interval_s: int = 60,
    max_wait_s: int = 24 * 3600,
) -> dict[str, Any]:
    """Submit a batch of message-create requests.

    Each entry in `requests` is a dict with keys:
      custom_id: str       — your stable id for this request
      system: str|list     — system prompt (string or content blocks)
      user: str            — user message content
      model: str|None      — defaults to settings.model_sonnet
      max_tokens: int|None — defaults to 1024
      temperature: float|None
      cache_control: dict|None — for top-level prompt caching

    Returns:
      {
        "batch_id": str,
        "status": "ended" | "in_progress" | "canceling" | ...,
        "results": dict[custom_id, str|None]  — present when poll=True
                                                and status='ended'
      }
    """
    from core.anthropic_client import get_client

    client = get_client()
    settings = get_settings()

    # SDK Stainless-generated `Request` and `MessageCreateParamsNonStreaming`
    # types are TypedDicts — passing plain dicts has identical wire
    # semantics and avoids importing SDK types at function scope (which
    # breaks test envs without `anthropic` installed).
    sdk_requests: list[dict[str, Any]] = []
    for r in requests:
        params: dict[str, Any] = {
            "model": r.get("model") or settings.model_sonnet,
            "max_tokens": r.get("max_tokens") or 1024,
            "messages": [{"role": "user", "content": r["user"]}],
            "system": r["system"],
        }
        if r.get("temperature") is not None:
            params["temperature"] = r["temperature"]
        sdk_requests.append({
            "custom_id": r["custom_id"],
            "params": params,
        })

    batch = client.messages.batches.create(requests=sdk_requests)
    logger.info(
        "submitted batch %s: %d requests, status=%s",
        batch.id, len(requests), batch.processing_status,
    )

    if not poll:
        return {
            "batch_id": batch.id,
            "status": batch.processing_status,
        }

    # Poll until terminal status
    start = time.monotonic()
    while True:
        batch = client.messages.batches.retrieve(batch.id)
        if batch.processing_status == "ended":
            break
        if time.monotonic() - start > max_wait_s:
            logger.warning("batch %s did not complete within %ds", batch.id, max_wait_s)
            return {
                "batch_id": batch.id,
                "status": batch.processing_status,
                "timed_out": True,
            }
        time.sleep(poll_interval_s)

    results = collect_results(batch.id)
    return {
        "batch_id": batch.id,
        "status": "ended",
        "results": results,
        "succeeded": sum(1 for v in results.values() if v is not None),
        "errored": sum(1 for v in results.values() if v is None),
    }


def collect_results(batch_id: str) -> dict[str, str | None]:
    """Pull all results from an ended batch. Returns {custom_id: text or None}."""
    from core.anthropic_client import get_client

    client = get_client()
    out: dict[str, str | None] = {}
    for result in client.messages.batches.results(batch_id):
        if result.result.type == "succeeded":
            msg = result.result.message
            text = next(
                (b.text for b in msg.content if getattr(b, "type", None) == "text"),
                "",
            )
            out[result.custom_id] = text
        else:
            # 'errored' | 'canceled' | 'expired' — record None and let
            # the caller decide how to handle (retry, fall back to sync, etc.)
            out[result.custom_id] = None
    return out


def batch_intelligence_narratives(
    companies_with_facts: list[dict],
    system_prompt: str,
    poll: bool = True,
) -> dict[str, str | None]:
    """Specific helper for the Intelligence agent's weekly task.

    Each entry in `companies_with_facts`:
      {company_id: str, category: str, facts: dict, guidance: str}

    Returns: {f"{company_id}:{category}": narrative_text | None}
    """
    import json

    requests = []
    for entry in companies_with_facts:
        cid = entry["company_id"]
        cat = entry["category"]
        user_msg = (
            f"Category: {cat}\n"
            f"Facts: {json.dumps(entry['facts'], default=str, sort_keys=True)}\n\n"
            f"Guidance: {entry['guidance']}\n\nWrite the finding."
        )
        requests.append({
            "custom_id": f"{cid}:{cat}",
            "system": system_prompt,
            "user": user_msg,
            "max_tokens": 512,
            "temperature": 0.3,
        })

    result = submit_batch(requests, poll=poll)
    return result.get("results", {})
