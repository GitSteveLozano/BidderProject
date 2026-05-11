"""Thin Postgres + pgvector access layer.

Uses psycopg3 connection pool. Pgvector adapter registered on connect so
vector(1536) columns round-trip as Python lists / numpy arrays.

The psycopg import is deferred so this module is importable in test
environments that monkeypatch fetch_one/fetch_all/execute.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from core.settings import get_settings

_pool = None


def _register_pgvector(conn) -> None:
    try:
        from pgvector.psycopg import register_vector

        register_vector(conn)
    except Exception:
        # pgvector not installed (e.g. unit tests) — skip
        pass


def get_pool():
    global _pool
    if _pool is None:
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        _pool = ConnectionPool(
            conninfo=get_settings().database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            configure=_register_pgvector,
            open=True,
        )
    return _pool


@contextmanager
def connection() -> Iterator[Any]:
    with get_pool().connection() as conn:
        yield conn


@contextmanager
def cursor() -> Iterator[Any]:
    with connection() as conn, conn.cursor() as cur:
        yield cur


def fetch_one(sql: str, params: tuple | dict | None = None) -> dict[str, Any] | None:
    with cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def fetch_all(sql: str, params: tuple | dict | None = None) -> list[dict[str, Any]]:
    with cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(sql: str, params: tuple | dict | None = None) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        conn.commit()
