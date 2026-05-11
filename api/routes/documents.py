"""Document upload + Intake agent invocation."""
from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

router = APIRouter()


@router.post("/upload")
async def upload_document(
    company_id: UUID = Form(...),
    document_type: str = Form("past_quote"),
    file: UploadFile = File(...),
) -> dict:
    from core.db import execute
    from core.embeddings import embed

    raw_bytes = await file.read()
    filename = file.filename or "upload"

    if filename.lower().endswith(".pdf"):
        import io

        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw_bytes))
        text = "\n\n".join((p.extract_text() or "") for p in reader.pages).strip()
    else:
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
        except Exception:
            text = ""

    doc_id = str(uuid4())
    emb = embed(text) if text else None
    execute(
        """
        INSERT INTO documents (id, company_id, type, filename, raw_text, embedding)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (doc_id, str(company_id), document_type, filename, text, emb),
    )
    return {"document_id": doc_id, "filename": filename, "chars": len(text)}


class IngestRequest(BaseModel):
    company_id: UUID
    directory: str = "data/raw"
    dry_run: bool = False


@router.post("/ingest")
def ingest_corpus(payload: IngestRequest) -> dict:
    """Bulk-load a directory of past quotes / sample inputs.

    Maps to `python -m db.ingest_corpus` but callable via HTTP for the
    Streamlit UI's onboarding step.
    """
    from db.ingest_corpus import ingest_directory

    path = Path(payload.directory)
    if not path.exists():
        raise HTTPException(400, f"directory not found: {payload.directory}")
    return ingest_directory(str(payload.company_id), path, dry_run=payload.dry_run)


@router.post("/{document_id}/intake")
def run_intake(document_id: UUID) -> dict:
    from agents import intake
    from core.db import execute, fetch_one
    from tools.pdf_extraction import classify_document_hint

    row = fetch_one(
        "SELECT filename, raw_text, type FROM documents WHERE id = %s", (str(document_id),)
    )
    if not row:
        raise HTTPException(404, "document not found")
    hint = row.get("type") or classify_document_hint(row["filename"], row.get("raw_text") or "")
    result = intake.run(
        document_id=str(document_id),
        filename=row["filename"],
        text=row.get("raw_text") or "",
        document_type_hint=hint,
    )
    execute(
        "UPDATE documents SET structured_data = %s WHERE id = %s",
        (_json(result), str(document_id)),
    )
    return result


@router.get("/")
def list_documents(company_id: UUID) -> list[dict]:
    from core.db import fetch_all

    return fetch_all(
        """
        SELECT id, type, filename, uploaded_at, structured_data IS NOT NULL AS processed
        FROM documents WHERE company_id = %s ORDER BY uploaded_at DESC
        """,
        (str(company_id),),
    )


def _json(obj):
    import json
    return json.dumps(obj, default=str) if obj is not None else None
