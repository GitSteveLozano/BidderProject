"""Margin snapshot refresh task tests."""
from __future__ import annotations

import pytest


@pytest.fixture
def snapshot_stub(monkeypatch):
    state = {"executes": [], "fail_concurrent": False, "fail_both": False}

    import core.db as core_db

    def fake_execute(sql, params=None):
        state["executes"].append(sql)
        if "CONCURRENTLY" in sql:
            if state["fail_concurrent"]:
                raise RuntimeError("unique index missing")
        else:
            if state["fail_both"]:
                raise RuntimeError("view does not exist")

    monkeypatch.setattr(core_db, "execute", fake_execute)
    return state


class TestMaterializeMarginSnapshots:
    """Tests target the plain-function impl, not the Celery-decorated
    wrapper — so they run without `celery` installed in the test env.
    Production uses the Celery beat schedule (see core/celery_app.py)."""

    def test_concurrent_refresh_first_path(self, snapshot_stub):
        # Patch celery so import succeeds in this test env
        import sys
        import types
        sys.modules.setdefault("celery", types.SimpleNamespace(
            Celery=lambda *a, **k: types.SimpleNamespace(
                conf=types.SimpleNamespace(
                    update=lambda **kw: None,
                    beat_schedule={},
                ),
                task=lambda **kw: (lambda f: f),
            ),
        ))
        sys.modules.setdefault("celery.schedules", types.SimpleNamespace(
            crontab=lambda **kw: None,
        ))

        from core.tasks import _materialize_margin_snapshots_impl

        result = _materialize_margin_snapshots_impl()
        assert result == {"refreshed": True, "concurrent": True}
        assert "CONCURRENTLY" in snapshot_stub["executes"][0]

    def test_falls_back_to_blocking_refresh(self, snapshot_stub):
        from core.tasks import _materialize_margin_snapshots_impl

        snapshot_stub["fail_concurrent"] = True
        result = _materialize_margin_snapshots_impl()
        assert result == {"refreshed": True, "concurrent": False}
        # Two execute calls: concurrent (failed), then non-concurrent
        assert len(snapshot_stub["executes"]) == 2
        assert "CONCURRENTLY" in snapshot_stub["executes"][0]
        assert "CONCURRENTLY" not in snapshot_stub["executes"][1]

    def test_both_paths_fail_returns_error(self, snapshot_stub):
        from core.tasks import _materialize_margin_snapshots_impl

        snapshot_stub["fail_concurrent"] = True
        snapshot_stub["fail_both"] = True
        result = _materialize_margin_snapshots_impl()
        assert result["refreshed"] is False
        assert "error" in result
