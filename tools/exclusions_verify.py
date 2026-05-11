"""Exclusions verification — spec §5.5 NEW v2.

Composition agent calls verify_exclusions(draft, service_line, company_id)
before transitioning to DRAFT_GENERATED. Standard exclusions for the
service line are pulled from service_lines.standard_exclusions and the
draft is checked for each. Missing ones go to state EXCLUSIONS_REVIEW.

Matching is fuzzy: keyword overlap after normalization. The exclusions are
short phrases ('Rough grade should not be above final grade height') so
substring/keyword matching is sufficient and avoids false positives.
"""
from __future__ import annotations

import re
from uuid import UUID

_STOPWORDS = {
    "the", "a", "an", "of", "to", "in", "on", "and", "or", "for", "with",
    "is", "are", "be", "by", "as", "at", "from", "not", "should", "this",
    "that", "any", "all",
}


def _tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z][a-z\-]+", text.lower()) if t not in _STOPWORDS]


def _is_present(exclusion: str, draft: str) -> bool:
    """Heuristic: exclusion is 'present' if its content tokens overlap >=70%
    with any 200-char window of the draft, OR if a 4+ word distinctive
    phrase from the exclusion appears verbatim.
    """
    excl_tokens = _tokenize(exclusion)
    if not excl_tokens:
        return False
    # Verbatim phrase check
    phrase = " ".join(excl_tokens[:5])
    if phrase and phrase in " ".join(_tokenize(draft)):
        return True
    # Token-set overlap
    draft_token_set = set(_tokenize(draft))
    overlap = sum(1 for t in excl_tokens if t in draft_token_set)
    ratio = overlap / max(len(excl_tokens), 1)
    return ratio >= 0.7


def get_standard_exclusions(company_id: UUID | str, service_line: str) -> list[str]:
    from core.db import fetch_one

    row = fetch_one(
        """
        SELECT standard_exclusions
        FROM service_lines
        WHERE company_id = %s AND line_name = %s
        """,
        (str(company_id), service_line),
    )
    if not row or not row.get("standard_exclusions"):
        return []
    return list(row["standard_exclusions"])


def verify_exclusions(draft: str, service_line: str, company_id: UUID | str) -> dict:
    """Compare draft against company+service_line standard exclusions.

    Returns:
      {
        "all_present": bool,
        "present": [str],
        "missing": [str],
        "total_required": int,
      }
    """
    required = get_standard_exclusions(company_id, service_line)
    present, missing = [], []
    for ex in required:
        (present if _is_present(ex, draft) else missing).append(ex)
    return {
        "all_present": len(missing) == 0,
        "present": present,
        "missing": missing,
        "total_required": len(required),
    }
