"""pgvector similarity search over documents.embedding."""
from __future__ import annotations

from uuid import UUID


def search_documents(
    company_id: UUID | str,
    query: str,
    document_types: list[str] | None = None,
    limit: int = 5,
) -> list[dict]:
    from core.db import fetch_all
    from core.embeddings import embed

    vec = embed(query)
    where_types = ""
    params: list = [str(company_id), vec]
    if document_types:
        where_types = "AND type = ANY(%s)"
        params.append(document_types)
    params.append(limit)
    sql = f"""
        SELECT id, type, filename, raw_text, structured_data,
               1 - (embedding <=> %s::vector) AS similarity
        FROM documents
        WHERE company_id = %s
          AND embedding IS NOT NULL
          {where_types}
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """
    # psycopg parameter order matches placeholder order in SQL:
    # embedding (sim), company_id, optional types, embedding (order), limit
    bind: list = [vec, str(company_id)]
    if document_types:
        bind.append(document_types)
    bind.extend([vec, limit])
    return fetch_all(sql, tuple(bind))
