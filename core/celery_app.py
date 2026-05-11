"""Celery app for async/scheduled work.

Spec §12.2: Celery + Redis for timer-based transitions and async batch.

Tasks:
- check_due_followups: every 5 minutes, advances follow-ups whose
  scheduled_for time has passed.
- run_intelligence_weekly: weekly per company, runs Intelligence agent.
- detect_jcr_patterns_nightly: nightly per company, runs JCR pattern
  detection over reconciled bids.
"""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from core.settings import get_settings

settings = get_settings()

celery_app = Celery(
    "proservice_bid_intelligence",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["core.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Pacific/Honolulu",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

celery_app.conf.beat_schedule = {
    "check-due-followups-every-5min": {
        "task": "core.tasks.check_due_followups",
        "schedule": crontab(minute="*/5"),
    },
    "run-intelligence-weekly-monday-8am": {
        "task": "core.tasks.run_intelligence_for_all_companies",
        "schedule": crontab(hour=8, minute=0, day_of_week=1),
    },
    "detect-jcr-patterns-nightly-2am": {
        "task": "core.tasks.detect_jcr_patterns_for_all_companies",
        "schedule": crontab(hour=2, minute=0),
    },
    "advance-stalled-bids-daily-9am": {
        "task": "core.tasks.advance_stalled_bids",
        "schedule": crontab(hour=9, minute=0),
    },
}
