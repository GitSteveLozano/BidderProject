"""Unit tests for the bid state machine — pure data, no DB required."""
from __future__ import annotations

import pytest

from core.states import BidState, can_transition, is_terminal


class TestHappyPathTransitions:
    """The Cavy demo path: RFP → reconciled job."""

    def test_full_happy_path_transitions_are_valid(self):
        path = [
            BidState.RFP_RECEIVED,
            BidState.ASSESSING,
            BidState.DRAFT_GENERATED,
            BidState.HUMAN_REVIEW,
            BidState.SENT,
            BidState.WON,
            BidState.JOB_IN_PROGRESS,
            BidState.JOB_COMPLETE,
            BidState.RECONCILED,
        ]
        for src, dst in zip(path, path[1:]):
            assert can_transition(src, dst), f"{src} -> {dst} should be valid"

    def test_exclusions_review_path(self):
        assert can_transition(BidState.ASSESSING, BidState.EXCLUSIONS_REVIEW)
        assert can_transition(BidState.EXCLUSIONS_REVIEW, BidState.DRAFT_GENERATED)


class TestInvalidTransitions:
    def test_cannot_skip_assessing(self):
        assert not can_transition(BidState.RFP_RECEIVED, BidState.DRAFT_GENERATED)

    def test_cannot_jump_to_reconciled(self):
        assert not can_transition(BidState.SENT, BidState.RECONCILED)

    def test_cannot_reconcile_before_job_complete(self):
        assert not can_transition(BidState.WON, BidState.RECONCILED)

    def test_lost_is_terminal(self):
        assert not can_transition(BidState.LOST, BidState.WON)


class TestTerminalStates:
    @pytest.mark.parametrize(
        "state",
        [BidState.RECONCILED, BidState.LOST, BidState.WITHDRAWN, BidState.NO_DECISION],
    )
    def test_terminal(self, state):
        assert is_terminal(state)

    @pytest.mark.parametrize(
        "state",
        [BidState.ASSESSING, BidState.SENT, BidState.JOB_IN_PROGRESS],
    )
    def test_not_terminal(self, state):
        assert not is_terminal(state)


def test_string_or_enum_accepted():
    assert can_transition("RFP_RECEIVED", "ASSESSING")
    assert can_transition(BidState.RFP_RECEIVED, "ASSESSING")
