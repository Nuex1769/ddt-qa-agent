import asyncio
import hashlib
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import admin_user, current_user
from .db import Chunk, Document, DocumentReview, DocumentVersion, ReviewTurn, SessionLocal, User, get_db, now
from .observability import Trace
from .rag import MAX_TEXT, embedding_profile, model_error, prepare_document, resolve_sources, sse
from .review_model import PART_SIZE, analyze_part, related_sources, validated_findings
from .versions import (
    accessible_document,
    check_draft,
    draft_json,
    get_version,
    markdown_filename,
    next_version,
    snapshot,
)

router = APIRouter(prefix="/api")
logger = logging.getLogger("ddt")


class ReviewQuestion(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=4000)
    resume_turn_id: str | None = Field(default=None, max_length=32)


class AdoptBody(BaseModel):
    finding_id: str = Field(min_length=1, max_length=32)
    draft_id: str | None = Field(default=None, max_length=32)
    expected_updated_at: str | None = Field(default=None, max_length=40)


class DraftBody(BaseModel):
    content: str = Field(min_length=10, max_length=MAX_TEXT)
    version: str = Field(min_length=1, max_length=40)
    expected_updated_at: str = Field(min_length=1, max_length=40)


class PublishBody(BaseModel):
    expected_updated_at: str = Field(min_length=1, max_length=40)


def own_review(db: Session, user: User, review_id: str) -> tuple[DocumentReview, Document]:
    review = db.scalar(
        select(DocumentReview).where(DocumentReview.id == review_id, DocumentReview.owner_id == user.id)
    )
    if not review:
        raise HTTPException(404, "审查对话不存在")
    return review, accessible_document(db, user, review.document_id)


def ensure_current(review: DocumentReview, doc: Document) -> None:
    if review.base_revision != doc.updated_at:
        raise HTTPException(409, "文档已更新，请重新打开审查窗口，审查当前已发布版本")


def turn_json(db: Session, user: User, turn: ReviewTurn, current: bool = True) -> dict:
    _, valid = resolve_sources(db, user, turn.sources)
    valid = valid and current
    return {
        "id": turn.id,
        "question": turn.question,
        "summary": turn.summary if valid else "目标或参考资料已变化，请重新审查。",
        "findings": turn.findings if valid else [],
        "sources": turn.sources if valid else [],
        "status": turn.status if valid else "stale",
        "completed_parts": turn.completed_parts,
        "total_parts": turn.total_parts,
    }


def review_history(db: Session, user: User, review_id: str) -> list[dict]:
    history = []
    for old in db.scalars(
        select(ReviewTurn)
        .where(ReviewTurn.review_id == review_id, ReviewTurn.status == "complete")
        .order_by(ReviewTurn.created_at.desc())
        .limit(3)
    ).all()[::-1]:
        _, valid = resolve_sources(db, user, old.sources)
        if valid:
            history.extend(
                [
                    {"role": "user", "content": old.question},
                    {"role": "assistant", "content": old.summary[:4000]},
                ]
            )
    return history


@router.post("/documents/{doc_id}/reviews")
def open_review(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = accessible_document(db, user, doc_id)
    criteria = (
        DocumentReview.document_id == doc.id,
        DocumentReview.owner_id == user.id,
        DocumentReview.base_revision == doc.updated_at,
    )
    review = db.scalar(select(DocumentReview).where(*criteria))
    if not review:
        review = DocumentReview(document_id=doc.id, owner_id=user.id, base_revision=doc.updated_at)
        db.add(review)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            review = db.scalar(select(DocumentReview).where(*criteria))
    return review_detail(review.id, user, db)


@router.get("/reviews/{review_id}")
def review_detail(review_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    review, doc = own_review(db, user, review_id)
    turns = db.scalars(
        select(ReviewTurn)
        .where(ReviewTurn.review_id == review.id)
        .order_by(ReviewTurn.created_at, ReviewTurn.id)
    ).all()
    if review.busy_until <= time.time():
        for turn in turns:
            if turn.status == "streaming":
                turn.status = "interrupted"
        db.commit()
    return {
        "id": review.id,
        "document_id": doc.id,
        "base_revision": review.base_revision,
        "draft_id": review.draft_id,
        "busy": review.busy_until > time.time(),
        "stale": review.base_revision != doc.updated_at,
        "turns": [turn_json(db, user, turn, review.base_revision == doc.updated_at) for turn in turns],
    }


@router.post("/reviews/{review_id}/messages")
async def review_message(
    review_id: str,
    body: ReviewQuestion,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    review, doc = own_review(db, user, review_id)
    ensure_current(review, doc)
    lease = time.time() + 300
    acquired = db.execute(
        update(DocumentReview)
        .where(DocumentReview.id == review.id, DocumentReview.busy_until <= time.time())
        .values(busy_until=lease, updated_at=now())
    )
    if acquired.rowcount != 1:
        raise HTTPException(409, "此文档审查正在进行，请等待结束或停止后重试")
    parts = [doc.content[i : i + PART_SIZE] for i in range(0, len(doc.content), PART_SIZE)]
    if body.resume_turn_id:
        turn = db.scalar(
            select(ReviewTurn).where(
                ReviewTurn.id == body.resume_turn_id,
                ReviewTurn.review_id == review.id,
                ReviewTurn.status.in_(["interrupted", "error"]),
            )
        )
        if not turn or turn.completed_parts >= turn.total_parts:
            raise HTTPException(409, "没有可继续的未完成审查")
        _, valid = resolve_sources(db, user, turn.sources)
        if not valid:
            raise HTTPException(409, "参考资料已变化，请发起新一轮审查")
        turn.status = "streaming"
    else:
        turn = ReviewTurn(review_id=review.id, question=body.question, total_parts=len(parts))
        db.add(turn)
    db.commit()
    turn_id = turn.id

    async def events():
        trace = Trace("review", user.id, review_id)
        trace.details["total_parts"] = len(parts)
        status = "interrupted"
        try:
            with SessionLocal() as stream_db:
                saved = stream_db.get(ReviewTurn, turn_id)
                yield sse("result", turn_json(stream_db, user, saved))
                start_part = saved.completed_parts
            async with asyncio.timeout(240):
                for index in range(start_part, len(parts)):
                    if await request.is_disconnected():
                        return
                    yield sse("status", {"message": f"正在审查第 {index + 1} / {len(parts)} 段正文…"})
                    with SessionLocal() as stream_db:
                        fresh_user = stream_db.get(User, user.id)
                        if not fresh_user or not fresh_user.active:
                            raise HTTPException(401, "账号已失效")
                        fresh_review, fresh_doc = own_review(stream_db, fresh_user, review_id)
                        ensure_current(fresh_review, fresh_doc)
                        sources = await related_sources(stream_db, fresh_user, fresh_doc, parts[index])
                        history = review_history(stream_db, fresh_user, review_id)
                        result = await analyze_part(
                            fresh_doc, parts[index], turn.question, sources, history, index
                        )
                        findings = validated_findings(result, fresh_doc, sources)
                    if await request.is_disconnected():
                        return
                    with SessionLocal() as stream_db:
                        fresh_user = stream_db.get(User, user.id)
                        if not fresh_user or not fresh_user.active:
                            raise HTTPException(401, "账号已失效")
                        fresh_review, fresh_doc = own_review(stream_db, fresh_user, review_id)
                        ensure_current(fresh_review, fresh_doc)
                        saved = stream_db.get(ReviewTurn, turn_id)
                        _, valid = resolve_sources(stream_db, fresh_user, saved.sources + sources)
                        if not valid:
                            raise ValueError("审查期间参考资料发生变化，请重新审查")
                        saved.summary += (
                            "\n\n" if saved.summary else ""
                        ) + f"第 {index + 1} 段：{result.summary}"
                        saved.findings = [*saved.findings, *findings]
                        unique_sources = {s["chunk_id"]: s for s in saved.sources + sources}
                        saved.sources = list(unique_sources.values())
                        saved.completed_parts = index + 1
                        stream_db.commit()
                        yield sse("result", turn_json(stream_db, fresh_user, saved))
            status = "complete"
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            status = "error"
            trace.details["error_type"] = type(exc).__name__
            logger.warning("review_failed type=%s", type(exc).__name__)
            yield sse("error", {"message": "审查未完整完成，已保留完成部分；请重试或继续未完成审查。"})
        finally:
            with SessionLocal() as final_db:
                saved = final_db.get(ReviewTurn, turn_id)
                if saved:
                    saved.status = status
                final_db.execute(
                    update(DocumentReview)
                    .where(DocumentReview.id == review_id, DocumentReview.busy_until == lease)
                    .values(busy_until=0, updated_at=now())
                )
                final_db.commit()
                trace.details["completed_parts"] = saved.completed_parts if saved else 0
            trace.finish(status)
        if status == "complete":
            yield sse("done", {"turn_id": turn_id})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


def make_draft(db: Session, user: User, doc: Document) -> DocumentVersion:
    snapshot(db, doc, user.id)
    draft = DocumentVersion(
        document_id=doc.id,
        version=next_version(doc.version),
        content=doc.content,
        base_content=doc.content,
        base_version=doc.version,
        base_revision=doc.updated_at,
        created_by=user.id,
        metadata_snapshot={
            key: getattr(doc, key) for key in ("title", "product", "filename", "visibility", "department")
        },
    )
    db.add(draft)
    db.flush()
    return draft


@router.post("/reviews/{review_id}/adopt")
def adopt_finding(
    review_id: str,
    body: AdoptBody,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    review, doc = own_review(db, user, review_id)
    ensure_current(review, doc)
    stamp = now()
    locked = db.execute(
        update(DocumentReview)
        .where(
            DocumentReview.id == review.id,
            DocumentReview.updated_at == review.updated_at,
            DocumentReview.busy_until <= time.time(),
        )
        .values(updated_at=stamp)
    )
    if locked.rowcount != 1:
        raise HTTPException(409, "审查或草稿正在更新，请稍后重试")
    selected = None
    context_sources = []
    for turn in db.scalars(select(ReviewTurn).where(ReviewTurn.review_id == review.id)):
        for finding in turn.findings:
            if finding["id"] == body.finding_id:
                _, valid = resolve_sources(db, user, turn.sources)
                if not valid or turn.status != "complete":
                    raise HTTPException(409, "此审查未完成或参考资料已变化，请完成审查后再采用")
                selected = finding
                context_sources = turn.sources
    if not selected or not selected.get("can_apply"):
        raise HTTPException(422, "此问题需要人工确认，暂不能直接采用")
    selected_draft_id = body.draft_id or review.draft_id
    if selected_draft_id:
        _, draft = get_version(db, user, doc.id, selected_draft_id)
        check_draft(doc, draft, body.expected_updated_at or draft.updated_at)
        review.draft_id = draft.id
    else:
        draft = make_draft(db, user, doc)
        review.draft_id = draft.id
    if body.finding_id in draft.adopted_ids:
        raise HTTPException(409, "该建议已采用，请勿重复操作")
    original, replacement = selected["original"], selected["replacement"]
    if original:
        if draft.content.count(original) != 1:
            raise HTTPException(409, "原文已被其他建议或手动编辑改变，请在草稿中合并此建议")
        content = draft.content.replace(original, replacement, 1)
    else:
        content = draft.content.rstrip() + "\n\n" + replacement.strip()
    if len(content) > MAX_TEXT:
        raise HTTPException(422, "采用后正文超过 200 万字，请缩小建议内容")
    changed = db.execute(
        update(DocumentVersion)
        .where(
            DocumentVersion.id == draft.id,
            DocumentVersion.updated_at == draft.updated_at,
            DocumentVersion.status == "draft",
        )
        .values(
            content=content,
            adopted_ids=[*draft.adopted_ids, body.finding_id],
            sources=list({s["chunk_id"]: s for s in draft.sources + context_sources}.values()),
            updated_at=stamp,
        )
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "草稿已在其他窗口更新，请重新打开后采用")
    db.commit()
    db.refresh(draft)
    return draft_json(draft, True)


@router.get("/documents/{doc_id}/versions")
def versions(doc_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    doc = accessible_document(db, user, doc_id)
    items = db.scalars(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == doc.id)
        .order_by(DocumentVersion.created_at.desc(), DocumentVersion.id)
    ).all()
    return [draft_json(item) for item in items]


@router.post("/documents/{doc_id}/drafts", status_code=201)
def create_draft(
    doc_id: str,
    review_id: str | None = None,
    fresh: bool = False,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    doc = accessible_document(db, user, doc_id)
    review = None
    if review_id:
        review, reviewed_doc = own_review(db, user, review_id)
        if reviewed_doc.id != doc.id:
            raise HTTPException(404, "审查不属于当前文档")
        ensure_current(review, doc)
        locked = db.execute(
            update(DocumentReview)
            .where(
                DocumentReview.id == review.id,
                DocumentReview.updated_at == review.updated_at,
                DocumentReview.busy_until <= time.time(),
            )
            .values(updated_at=now())
        )
        if locked.rowcount != 1:
            raise HTTPException(409, "审查正在更新，请稍后重试")
        if review.draft_id and not fresh:
            _, existing = get_version(db, user, doc.id, review.draft_id)
            check_draft(doc, existing, existing.updated_at)
            db.commit()
            return draft_json(existing, True)
    draft = make_draft(db, user, doc)
    if review:
        review.draft_id = draft.id
    db.commit()
    return draft_json(draft, True)


@router.get("/documents/{doc_id}/versions/{version_id}")
def version_detail(
    doc_id: str, version_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)
):
    _, version = get_version(db, user, doc_id, version_id)
    return draft_json(version, True)


@router.put("/documents/{doc_id}/versions/{version_id}")
def save_draft(
    doc_id: str,
    version_id: str,
    body: DraftBody,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    doc, draft = get_version(db, user, doc_id, version_id)
    check_draft(doc, draft, body.expected_updated_at)
    content, version = body.content.strip(), body.version.strip()
    if len(content) < 10 or "\x00" in content or not version or version == doc.version:
        raise HTTPException(422, "请填写至少 10 字的有效正文，以及与当前版本不同的新版本号")
    changed = db.execute(
        update(DocumentVersion)
        .where(
            DocumentVersion.id == draft.id,
            DocumentVersion.updated_at == body.expected_updated_at,
            DocumentVersion.status == "draft",
        )
        .values(content=content, version=version, updated_at=now())
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "草稿已在其他窗口更新，请重新打开后操作")
    db.commit()
    db.refresh(draft)
    return draft_json(draft, True)


@router.post("/documents/{doc_id}/versions/{version_id}/publish")
async def publish_draft(
    doc_id: str,
    version_id: str,
    body: PublishBody,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    doc, draft = get_version(db, user, doc_id, version_id)
    check_draft(doc, draft, body.expected_updated_at)
    if draft.version == doc.version or draft.content == doc.content:
        raise HTTPException(422, "请先修改正文并使用新的版本号，再确认发布")
    if db.scalar(
        select(DocumentVersion.id).where(
            DocumentVersion.document_id == doc.id,
            DocumentVersion.status == "published",
            DocumentVersion.version == draft.version,
        )
    ):
        raise HTTPException(409, "该版本号已发布过，请为草稿设置新的版本号")
    filename = markdown_filename(doc.filename)
    try:
        content, chunks, vectors = await prepare_document(filename, draft.content.encode("utf-8"))
    except Exception as exc:
        raise model_error(exc) from exc
    # Recheck target, role, evidence and both optimistic locks after the external await.
    db.rollback()
    fresh_user = db.get(User, user.id)
    if not fresh_user or not fresh_user.active or fresh_user.role != "admin":
        raise HTTPException(403, "当前账号不再具有发布权限")
    doc, draft = get_version(db, fresh_user, doc_id, version_id)
    check_draft(doc, draft, body.expected_updated_at)
    stamp = now()
    claimed = db.execute(
        update(Document)
        .where(
            Document.id == doc.id,
            Document.updated_at == draft.base_revision,
        )
        .values(updated_at=stamp)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        raise HTTPException(409, "文档已被更新，请重新审查后发布")
    claimed_draft = db.execute(
        update(DocumentVersion)
        .where(
            DocumentVersion.id == draft.id,
            DocumentVersion.updated_at == body.expected_updated_at,
            DocumentVersion.status == "draft",
        )
        .values(updated_at=stamp)
        .execution_options(synchronize_session=False)
    )
    if claimed_draft.rowcount != 1:
        raise HTTPException(409, "草稿已在其他窗口更新，请重新打开后操作")
    snapshot(db, doc, fresh_user.id)
    db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
    doc.content, doc.filename, doc.version = content, filename, draft.version
    doc.digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    doc.size, doc.chunk_count = len(content.encode("utf-8")), len(chunks)
    doc.updated_at, doc.embedding_profile = stamp, embedding_profile()
    draft.status, draft.updated_at, draft.published_revision = "published", stamp, stamp
    draft.content = content
    for i, (text, vector) in enumerate(zip(chunks, vectors, strict=True)):
        db.add(Chunk(document_id=doc.id, ordinal=i, text=text, embedding=vector))
    db.commit()
    return draft_json(draft, True)
