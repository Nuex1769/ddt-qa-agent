"""Published documents remain the retrieval source; draft text lives only in this table."""

import difflib
import re
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import visible_documents
from .db import Document, DocumentVersion, User
from .rag import resolve_sources


def accessible_document(db: Session, user: User, doc_id: str) -> Document:
    doc = db.scalar(select(Document).where(Document.id == doc_id, visible_documents(user)))
    if not doc:
        raise HTTPException(404, "文档不存在或当前账号无权访问")
    return doc


def snapshot(db: Session, doc: Document, user_id: str) -> None:
    if db.scalar(
        select(DocumentVersion.id).where(
            DocumentVersion.document_id == doc.id, DocumentVersion.published_revision == doc.updated_at
        )
    ):
        return
    db.add(
        DocumentVersion(
            document_id=doc.id,
            status="published",
            version=doc.version,
            content=doc.content,
            base_content=doc.content,
            base_version=doc.version,
            base_revision=doc.updated_at,
            published_revision=doc.updated_at,
            metadata_snapshot={
                key: getattr(doc, key) for key in ("title", "product", "filename", "visibility", "department")
            },
            created_by=user_id,
        )
    )


def next_version(version: str) -> str:
    match = re.search(r"\d+$", version)
    if match:
        candidate = version[: match.start()] + str(int(match.group()) + 1)
    else:
        candidate = version[:34] + "-修订1"
    return candidate[:40]


def draft_json(version: DocumentVersion, detail: bool = False) -> dict:
    result = {
        key: getattr(version, key)
        for key in (
            "id",
            "document_id",
            "status",
            "version",
            "base_version",
            "base_revision",
            "created_at",
            "updated_at",
            "published_revision",
        )
    }
    if detail:
        old = version.base_content.splitlines(keepends=True)
        new = version.content.splitlines(keepends=True)
        matcher = difflib.SequenceMatcher(None, old, new)
        changes = []
        for tag, i, j, a, b in matcher.get_opcodes():
            changes.append({"kind": tag, "old": "".join(old[i:j]), "new": "".join(new[a:b])})
        result.update(
            content=version.content,
            base_content=version.base_content,
            diff=changes,
            adopted_ids=version.adopted_ids,
        )
    return result


def get_version(db: Session, user: User, doc_id: str, version_id: str) -> tuple[Document, DocumentVersion]:
    doc = accessible_document(db, user, doc_id)
    version = db.scalar(
        select(DocumentVersion).where(DocumentVersion.id == version_id, DocumentVersion.document_id == doc.id)
    )
    if not version:
        raise HTTPException(404, "文档版本不存在")
    if version.status == "draft":
        _, valid = resolve_sources(db, user, version.sources)
        if not valid:
            raise HTTPException(409, "草稿采用的参考资料已变化，请重新审查并创建草稿")
    return doc, version


def check_draft(doc: Document, version: DocumentVersion, expected: str) -> None:
    if version.status != "draft":
        raise HTTPException(409, "该版本已发布，不能继续修改；请重新审查当前版本")
    if version.updated_at != expected:
        raise HTTPException(409, "草稿已在其他窗口更新，请重新打开后操作")
    if doc.updated_at != version.base_revision:
        raise HTTPException(409, "已发布文档已变化，请重新审查当前版本，避免覆盖他人修改")


def markdown_filename(filename: str) -> str:
    return (Path(filename).stem[:240] or "document") + ".md"
