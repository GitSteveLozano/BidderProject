"""Document upload + Intake agent invocation."""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from agents import intake
from core.db import execute, fetch_all
from core.embeddings import embed
from tools.pdf_extraction import classify_document_hint

router = APIRouter()


@router.post("/upload")
async def upload_document(
    company_id: UUID = Form(...),
    document_type: str = Form("past_quote"),
    file: UploadFile = File(...),
) -> dict:
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


@router.post("/{document_id}/intake")
def run_intake(document_id: UUID) -> dict:
    from core.db import fetch_one

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
