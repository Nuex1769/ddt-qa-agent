from urllib.parse import urlencode

import pytest
from conftest import upload
from sqlalchemy import select

from app.db import Chunk, Document, SessionLocal


def citation_url(doc_id, chunk, doc):
    query = urlencode({"chunk_id": chunk.id, "digest": doc.digest, "revision": doc.updated_at})
    return f"/api/documents/{doc_id}?{query}"


def test_citation_locates_later_repeated_chunk_with_overlap_and_unicode(admin):
    text = "😀 引言。\n\n相同的段落 内容。\n\n中间内容。\n\n相同的段落 内容。\n\n结束。"
    doc_id = upload(admin, text).json()["id"]
    with SessionLocal() as db:
        doc = db.get(Document, doc_id)
        for chunk in db.scalars(select(Chunk).where(Chunk.document_id == doc_id)):
            db.delete(chunk)
        chunks = [
            Chunk(document_id=doc_id, ordinal=0, text="😀 引言。\n相同的段落 内容。"),
            Chunk(document_id=doc_id, ordinal=1, text="相同的段落 内容。\n中间内容。"),
            Chunk(document_id=doc_id, ordinal=2, text="相同的段落 内容。"),
        ]
        db.add_all(chunks)
        db.commit()
        url = citation_url(doc_id, chunks[-1], doc)
    response = admin.get(url)
    assert response.status_code == 200
    citation = response.json()["citation"]
    assert citation["section"] == 3
    encoded = text.encode("utf-16-le")
    assert encoded[citation["range"]["start"] * 2 : citation["range"]["end"] * 2].decode("utf-16-le") == (
        "相同的段落 内容。"
    )
    assert citation["range"]["start"] == len(text[: text.rindex("相同")].encode("utf-16-le")) // 2
    assert "citation" not in admin.get(f"/api/documents/{doc_id}").json()


@pytest.mark.parametrize("change", ["digest", "revision", "missing", "different_document", "permissions"])
def test_citation_checks_permissions_document_membership_and_revision(admin, change):
    doc_id = upload(admin, visibility="private").json()["id"]
    with SessionLocal() as db:
        doc = db.get(Document, doc_id)
        chunk = db.scalar(select(Chunk).where(Chunk.document_id == doc_id))
        url = citation_url(doc_id, chunk, doc)
        if change == "digest":
            doc.digest = "changed"
        elif change == "revision":
            doc.updated_at = "changed"
        elif change == "missing":
            db.delete(chunk)
        db.commit()
    if change == "different_document":
        other_id = upload(admin, "另一份资料介绍榕树平台的数据采集功能。").json()["id"]
        url = url.replace(doc_id, other_id).split("&digest")[0]
    if change == "permissions":
        admin.post("/api/auth/demo", json={"account": "support"})
    response = admin.get(url)
    assert response.status_code == (409 if change in {"digest", "revision"} else 404)
    assert "content" not in response.json()
    admin.post("/api/auth/logout")
    assert admin.get(url).status_code == 401


def test_unlocatable_citation_does_not_highlight_unrelated_content(admin):
    doc_id = upload(admin).json()["id"]
    with SessionLocal() as db:
        doc = db.get(Document, doc_id)
        chunk = db.scalar(select(Chunk).where(Chunk.document_id == doc_id))
        chunk.text = "这段内容不在当前原文中"
        db.commit()
        url = citation_url(doc_id, chunk, doc)
    response = admin.get(url)
    assert response.status_code == 200
    assert response.json()["citation"]["range"] is None
