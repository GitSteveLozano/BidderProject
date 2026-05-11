"""Bid state machine — spec §6.

State + Transition are pure data. The Orchestrator enforces transitions and
writes bid_state_history rows. No external dependencies here so the state
machine can be unit-tested in isolation.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class BidState(str, Enum):
    RFP_RECEIVED = "RFP_RECEIVED"
    ASSESSING = "ASSESSING"
    DRAFT_GENERATED = "DRAFT_GENERATED"
    EXCLUSIONS_REVIEW = "EXCLUSIONS_REVIEW"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    SENT = "SENT"
    FOLLOW_UP_1_DUE = "FOLLOW_UP_1_DUE"
    FOLLOW_UP_1_SENT = "FOLLOW_UP_1_SENT"
    FOLLOW_UP_2_DUE = "FOLLOW_UP_2_DUE"
    FOLLOW_UP_2_SENT = "FOLLOW_UP_2_SENT"
    FOLLOW_UP_3_DUE = "FOLLOW_UP_3_DUE"
    FOLLOW_UP_3_SENT = "FOLLOW_UP_3_SENT"
    REVISED = "REVISED"
    WON = "WON"
    JOB_IN_PROGRESS = "JOB_IN_PROGRESS"
    JOB_COMPLETE = "JOB_COMPLETE"
    RECONCILED = "RECONCILED"
    LOST = "LOST"
    WITHDRAWN = "WITHDRAWN"
    STALLED = "STALLED"
    NO_DECISION = "NO_DECISION"


@dataclass(frozen=True)
class Transition:
    from_state: BidState
    to_state: BidState
    trigger: str  # 'auto' | 'human' | 'timer'

    def key(self) -> tuple[str, str]:
        return (self.from_state.value, self.to_state.value)


_RAW_TRANSITIONS: list[tuple[BidState, BidState, str]] = [
    (BidState.RFP_RECEIVED, BidState.ASSESSING, "auto"),
    (BidState.ASSESSING, BidState.DRAFT_GENERATED, "auto"),
    (BidState.ASSESSING, BidState.EXCLUSIONS_REVIEW, "auto"),
    (BidState.EXCLUSIONS_REVIEW, BidState.DRAFT_GENERATED, "human"),
    (BidState.DRAFT_GENERATED, BidState.HUMAN_REVIEW, "auto"),
    (BidState.HUMAN_REVIEW, BidState.SENT, "human"),
    (BidState.HUMAN_REVIEW, BidState.REVISED, "human"),
    (BidState.HUMAN_REVIEW, BidState.WITHDRAWN, "human"),
    (BidState.REVISED, BidState.ASSESSING, "auto"),
    (BidState.SENT, BidState.FOLLOW_UP_1_DUE, "timer"),
    (BidState.SENT, BidState.WON, "human"),
    (BidState.SENT, BidState.LOST, "human"),
    (BidState.SENT, BidState.STALLED, "timer"),
    (BidState.SENT, BidState.NO_DECISION, "human"),
    (BidState.FOLLOW_UP_1_DUE, BidState.FOLLOW_UP_1_SENT, "human"),
    (BidState.FOLLOW_UP_1_SENT, BidState.FOLLOW_UP_2_DUE, "timer"),
    (BidState.FOLLOW_UP_1_SENT, BidState.WON, "human"),
    (BidState.FOLLOW_UP_1_SENT, BidState.LOST, "human"),
    (BidState.FOLLOW_UP_2_DUE, BidState.FOLLOW_UP_2_SENT, "human"),
    (BidState.FOLLOW_UP_2_SENT, BidState.FOLLOW_UP_3_DUE, "timer"),
    (BidState.FOLLOW_UP_2_SENT, BidState.WON, "human"),
    (BidState.FOLLOW_UP_2_SENT, BidState.LOST, "human"),
    (BidState.FOLLOW_UP_3_DUE, BidState.FOLLOW_UP_3_SENT, "human"),
    (BidState.FOLLOW_UP_3_SENT, BidState.WON, "human"),
    (BidState.FOLLOW_UP_3_SENT, BidState.LOST, "human"),
    (BidState.FOLLOW_UP_3_SENT, BidState.STALLED, "timer"),
    (BidState.STALLED, BidState.LOST, "timer"),
    (BidState.STALLED, BidState.WON, "human"),
    (BidState.WON, BidState.JOB_IN_PROGRESS, "auto"),
    (BidState.JOB_IN_PROGRESS, BidState.JOB_COMPLETE, "human"),
    (BidState.JOB_COMPLETE, BidState.RECONCILED, "auto"),
]

TRANSITIONS: list[Transition] = [
    Transition(from_state=f, to_state=t, trigger=trg) for f, t, trg in _RAW_TRANSITIONS
]

_VALID_KEYS = {tr.key() for tr in TRANSITIONS}


def can_transition(from_state: BidState | str, to_state: BidState | str) -> bool:
    f = from_state.value if isinstance(from_state, BidState) else from_state
    t = to_state.value if isinstance(to_state, BidState) else to_state
    return (f, t) in _VALID_KEYS


def terminal_states() -> set[BidState]:
    return {BidState.RECONCILED, BidState.LOST, BidState.WITHDRAWN, BidState.NO_DECISION}


def is_terminal(state: BidState | str) -> bool:
    s = BidState(state) if isinstance(state, str) else state
    return s in terminal_states()
