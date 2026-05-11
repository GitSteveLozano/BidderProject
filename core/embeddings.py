"""Embedding helpers. Uses OpenAI text-embedding-3-small (1536 dims).

Embeddings are written to pgvector columns. If OPENAI_API_KEY is missing
returns a zero vector so demo flows still work without an embedding key.
"""
from __future__ import annotations

from functools import lru_cache

from core.settings import get_settings

EMBED_DIM = 1536
EMBED_MODEL = "text-embedding-3-small"


@lru_cache(maxsize=1)
def _client():
    from openai import OpenAI

    return OpenAI(api_key=get_settings().openai_api_key)


def embed(text: str) -> list[float]:
    text = (text or "").strip()
    if not text:
        return [0.0] * EMBED_DIM
    if not get_settings().openai_api_key:
        return [0.0] * EMBED_DIM
    resp = _client().embeddings.create(model=EMBED_MODEL, input=text[:8000])
    return resp.data[0].embedding


def embed_batch(texts: list[str]) -> list[list[float]]:
    return [embed(t) for t in texts]
