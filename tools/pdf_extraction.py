"""PDF text + page extraction.

Used by the Intake agent. Vision-based drawing extraction is a hook for
Sonnet's vision capability — implemented as a structured prompt with the
page image base64-encoded.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path


def extract_pdf_text(path: str | Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    out: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        out.append(text)
    return "\n\n".join(out).strip()


def extract_pdf_page_count(path: str | Path) -> int:
    from pypdf import PdfReader

    return len(PdfReader(str(path)).pages)


def extract_pdf_page_image_b64(path: str | Path, page_index: int = 0) -> str | None:
    """Render a page to PNG (base64) for vision input.

    Returns None if pdf2image / poppler is not available; callers should
    fall back to text-only extraction.
    """
    try:
        from pdf2image import convert_from_path  # type: ignore[import-not-found]
    except ImportError:
        return None
    images = convert_from_path(str(path), first_page=page_index + 1, last_page=page_index + 1)
    if not images:
        return None
    buf = io.BytesIO()
    images[0].save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def classify_document_hint(filename: str, text_sample: str) -> str:
    """Cheap heuristic classification before LLM call."""
    fn = filename.lower()
    sample = (text_sample or "")[:2000].lower()
    if any(w in fn for w in ("rfp", "request for proposal")):
        return "rfp"
    if any(w in fn for w in ("drawing", "plan", "blueprint")):
        return "drawings"
    if any(w in fn for w in ("change", "addendum")):
        return "change_request"
    if "exclude" in sample and "warranty" in sample:
        return "past_quote"
    if "subject:" in sample or "from:" in sample:
        return "scope_email"
    return "past_quote"
