"""Tests for the exclusions verification heuristic.

Spec §5.5 NEW v2: Composition's verification step is required before the
state transitions to DRAFT_GENERATED. False negatives (saying 'missing'
when present) are tolerable — they just route through EXCLUSIONS_REVIEW.
False positives (saying 'present' when missing) ARE the danger.
"""
from __future__ import annotations

from tools.exclusions_verify import _is_present


class TestVerbatimMatch:
    def test_exact_phrase_present(self):
        draft = "Excluded: Rough grade should not be above final grade height."
        assert _is_present("Rough grade should not be above final grade height", draft)

    def test_case_insensitive(self):
        draft = "EXCLUDED: rough grade ABOVE final grade height"
        assert _is_present("Rough grade should not be above final grade height", draft)


class TestTokenOverlap:
    def test_paraphrased_present(self):
        draft = "The rough grade may not exceed final grade height per detail."
        assert _is_present("Rough grade should not be above final grade height", draft)

    def test_partial_overlap_below_threshold_not_present(self):
        draft = "Painting is excluded from this quote."
        assert not _is_present("Rough grade should not be above final grade height", draft)


class TestMissingDetection:
    def test_missing_exclusion(self):
        draft = """
        Scope of work:
        - Three-coat stucco system on metal lath
        - Acrylic finish per sample

        Excluded:
        - Painting
        - Caulking
        - Permits
        """
        assert not _is_present(
            "Rough grade should not be above final grade height", draft
        )

    def test_caulking_exclusion_present(self):
        draft = "Excluded: caulking of dissimilar material joints by GC."
        assert _is_present(
            "Caulking of dissimilar material joints (by GC or others)", draft
        )
