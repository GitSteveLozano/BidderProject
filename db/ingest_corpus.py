"""Bulk-load the file corpus under data/raw/ into the documents table.

Layout assumed (matches what's checked in):
  data/raw/past_quotes_anonymized/*.{txt,pdf}   → type='past_quote'
  data/raw/sample_inputs/scope_email_*.txt      → type='scope_email'
  data/raw/sample_inputs/rfp_*.txt              → type='rfp'
  data/raw/sample_inputs/change_request_*.txt   → type='change_request'
  data/raw/sample_inputs/drawings_*.txt         → type='drawings'

Embeddings are generated via core.embeddings.embed (OpenAI
text-embedding-3-small). If OPENAI_API_KEY is not set, a zero vector
is stored — vector_search will still work structurally but won't
return useful similarities until a real key is provided.

Run: python -m db.ingest_corpus --company-id <uuid>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from core.db import execute, fetch_one
from core.embeddings import embed
from core.settings import get_settings

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"


def _classify_path(p: Path) -> str:
    name = p.name.lower()
    parent = p.parent.name.lower()
    if "past_quotes" in parent:
        return "past_quote"
    if name.startswith("rfp_"):
        return "rfp"
    if name.startswith("scope_email"):
        return "scope_email"
    if name.startswith("change_request"):
        return "change_request"
    if name.startswith("drawings"):
        return "drawings"
    return "past_quote"


def _read(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        from tools.pdf_extraction import extract_pdf_text

        return extract_pdf_text(path)
    return path.read_text(encoding="utf-8", errors="replace")


def ingest_directory(company_id: str, directory: Path, dry_run: bool = False) -> dict:
    if not directory.exists():
        return {"loaded": 0, "error": f"directory does not exist: {directory}"}

    summary = {"by_type": {}, "files": [], "loaded": 0, "skipped": 0}
    for path in sorted(directory.rglob("*")):
        if path.is_dir():
            continue
        if path.suffix.lower() not in (".txt", ".pdf", ".md"):
            continue
        if any(part.startswith(".") for part in path.parts):
            continue

        doc_type = _classify_path(path)
        text = _read(path)
        rel = str(path.relative_to(directory.parent.parent))

        # Skip if already loaded for this company
        existing = fetch_one(
            "SELECT id FROM documents WHERE company_id = %s AND filename = %s",
            (company_id, path.name),
        )
        if existing:
            summary["skipped"] += 1
            continue

        summary["files"].append({"path": rel, "type": doc_type, "chars": len(text)})
        summary["by_type"][doc_type] = summary["by_type"].get(doc_type, 0) + 1
        summary["loaded"] += 1

        if dry_run:
            continue

        emb = embed(text) if text else None
        execute(
            """
            INSERT INTO documents (company_id, type, filename, raw_text, embedding)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (company_id, doc_type, path.name, text, emb),
        )

    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bulk-ingest raw corpus into documents")
    parser.add_argument(
        "--company-id",
        default=get_settings().demo_company_id,
        help="Target company UUID (default: DEMO_COMPANY_ID)",
    )
    parser.add_argument(
        "--dir",
        default=str(RAW_DIR),
        help="Directory to walk (default: data/raw)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    summary = ingest_directory(args.company_id, Path(args.dir), dry_run=args.dry_run)
    print(f"Loaded:  {summary['loaded']}")
    print(f"Skipped: {summary['skipped']} (already in DB)")
    print(f"By type: {summary['by_type']}")
    if summary.get("error"):
        print(f"Error:   {summary['error']}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
