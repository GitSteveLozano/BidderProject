"""Thin Postgres + pgvector access layer.

Uses psycopg3 connection pool. Pgvector adapter registered on connect so
vector(1536) columns round-trip as Python lists / numpy arrays.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from core.settings import get_settings

_pool: ConnectionPool | None = None


def _register_pgvector(conn: psycopg.Connection) -> None:
    try:
        from pgvector.psycopg import register_vector

        register_vector(conn)
    except Exception:
        # pgvector not installed in env (e.g. unit tests with sqlite mock) — skip
        pass


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
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
def connection() -> Iterator[psycopg.Connection]:
    with get_pool().connection() as conn:
        yield conn


@contextmanager
def cursor() -> Iterator[psycopg.Cursor]:
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
