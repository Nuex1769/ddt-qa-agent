import asyncio
import hashlib
import logging
import time
from collections import defaultdict, deque
from contextlib import aclosing, asynccontextmanager, suppress
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import (
    COOKIE,
    admin_user,
    check_password,
    current_user,
    hash_password,
    signer,
    user_json,
    visible_documents,
)
from .citations import citation_range
from .config import ROOT, settings
from .db import Chunk, Conversation, Document, Message, SessionLocal, User, engine, get_db, init_db, now
from .observability import Trace, export_loop
from .observability import router as observability_router
from .rag import (
    answer_stream,
    embedding_profile,
    model_error,
    prepare_document,
    resolve_sources,
    retrieve,
    sse,
)
from .reviews import router as review_router
from .seed import seed
from .tavern import router as tavern_router
from .versions import snapshot

logger = logging.getLogger("ddt")


@asynccontextmanager
async def lifespan(_app):
    init_db()
    seed()
    exporter = asyncio.create_task(export_loop())
    try:
        yield
    finally:
        exporter.cancel()
        with suppress(asyncio.CancelledError):
            await exporter


app = FastAPI(title="DDT QA Agent", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin", "").rstrip("/")
        if (origin and origin not in settings.origins) or request.headers.get(
            "sec-fetch-site"
        ) == "cross-site":
            return JSONResponse({"detail": "请求来源不受信任，请从应用页面重试"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class DemoBody(BaseModel):
    account: Literal["admin", "product", "support"] = "admin"


class CreateUserBody(BaseModel):
    username: str = Field(min_length=2, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=100)
    department: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("username", "name", "department", mode="before")
    @classmethod
    def strip_identity_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class ChatBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = Field(default=None, max_length=32)
    product: str = Field(default="", max_length=80)
    version: str = Field(default="", max_length=40)


def set_cookie(response: Response, user: User):
    response.set_cookie(
        COOKIE,
        signer.dumps(user.id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=43_200,
        path="/",
    )


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok"}


@app.get("/api/auth/config")
def auth_config():
    return {"demo_mode": settings.demo_mode}


login_attempts: dict[str, deque] = defaultdict(deque)


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    attempts = login_attempts[ip]
    while attempts and attempts[0] < time.monotonic() - 300:
        attempts.popleft()
    if len(attempts) >= 10:
        raise HTTPException(429, "登录尝试过于频繁，请 5 分钟后重试")
    user = db.scalar(select(User).where(User.username == body.username.strip()))
    if not check_password(body.password, user.password_hash if user else "") or not user or not user.active:
        attempts.append(time.monotonic())
        raise HTTPException(401, "账号或密码不正确")
    attempts.clear()
    set_cookie(response, user)
    return user_json(user)


@app.post("/api/auth/demo")
def demo_login(body: DemoBody, response: Response, db: Session = Depends(get_db)):
    if not settings.demo_mode:
        raise HTTPException(404, "未启用演示模式")
    username = {"admin": settings.admin_username, "product": "demo-product", "support": "demo-support"}[
        body.account
    ]
    user = db.scalar(select(User).where(User.username == username, User.active.is_(True)))
    if not user:
        raise HTTPException(404, "演示账号不可用")
    set_cookie(response, user)
    return user_json(user)


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return user_json(user)


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/config")
def config(user: User = Depends(current_user), db: Session = Depends(get_db)):
    docs = db.scalars(select(Document).where(visible_documents(user))).all()
    products: dict[str, set] = {}
    for doc in docs:
        products.setdefault(doc.product, set()).add(doc.version)
    return {
        "demo_mode": settings.demo_mode,
        "model": "资料摘录演示" if settings.demo_mode else settings.chat_model,
        "database": engine.dialect.name,
        "max_upload_mb": settings.max_upload_mb,
        "document_count": len(docs),
        "chunk_count": sum(d.chunk_count for d in docs),
        "products": [
            {"name": name, "versions": sorted(versions, reverse=True)}
            for name, versions in sorted(products.items())
        ],
        "retrieval_mode": "hybrid" if settings.vector_enabled else "keyword",
        "needs_reindex": (
            sum(d.embedding_profile != embedding_profile() for d in docs) if settings.vector_enabled else 0
        ),
    }


def doc_json(doc: Document):
    return {
        k: getattr(doc, k)
        for k in (
            "id",
            "title",
            "filename",
            "product",
            "version",
            "visibility",
            "department",
            "chunk_count",
            "size",
            "updated_at",
        )
    }


def accessible_doc(db: Session, user: User, doc_id: str) -> Document:
    doc = db.scalar(select(Document).where(Document.id == doc_id, visible_documents(user)))
    if not doc:
        raise HTTPException(404, "文档不存在或当前账号无权访问")
    return doc


@app.get("/api/documents")
def documents(
    q: str = "",
    product: str = "",
    version: str = "",
    page: int = 1,
    page_size: int = 10,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    page = max(1, page)
    page_size = min(50, max(1, page_size))
    criteria = [visible_documents(user)]
    if q.strip():
        criteria.append(Document.title.contains(q.strip(), autoescape=True))
    if product:
        criteria.append(Document.product == product)
    if version:
        criteria.append(Document.version == version)
    total = db.scalar(select(func.count()).select_from(Document).where(*criteria))
    docs = db.scalars(
        select(Document)
        .where(*criteria)
        .order_by(Document.updated_at.desc(), Document.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {"items": [doc_json(d) for d in docs], "total": total, "page": page, "page_size": page_size}


@app.get("/api/documents/{doc_id}")
def document(
    doc_id: str,
    chunk_id: str | None = None,
    digest: str | None = None,
    revision: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    doc = accessible_doc(db, user, doc_id)
    result = {**doc_json(doc), "content": doc.content}
    if chunk_id is not None:
        if (digest is not None and digest != doc.digest) or (
            revision is not None and revision != doc.updated_at
        ):
            raise HTTPException(409, "参考资料已更新，原引用片段已失效，请重新提问获取最新引用")
        chunk = db.scalar(select(Chunk).where(Chunk.id == chunk_id, Chunk.document_id == doc.id))
        if not chunk:
            raise HTTPException(404, "引用片段已不存在，请重新提问获取最新引用")
        result["citation"] = {"section": chunk.ordinal + 1, "range": citation_range(db, doc, chunk)}
    return result


async def store_document(
    file: UploadFile,
    title: str,
    product: str,
    version: str,
    visibility: str,
    user: User,
    db: Session,
    doc: Document | None = None,
):
    title, product, version = title.strip(), product.strip(), version.strip()
    if not title or len(title) > 200 or not product or len(product) > 80 or not version or len(version) > 40:
        raise HTTPException(422, "请填写有效的标题、产品和版本（最多 200、80、40 字）")
    if visibility not in {"company", "department", "private"}:
        raise HTTPException(422, "请选择有效的可见范围")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"单个文件不能超过 {settings.max_upload_mb} MB")
    if not data:
        raise HTTPException(422, "文件为空，请重新选择")
    filename = (file.filename or "document.txt").replace("\\", "/").split("/")[-1][:255]
    digest = hashlib.sha256(data).hexdigest()
    duplicate = db.scalar(
        select(Document).where(
            Document.digest == digest,
            Document.product == product,
            Document.version == version,
            Document.id != (doc.id if doc else ""),
        )
    )
    if duplicate:
        raise HTTPException(409, "该产品版本中已存在相同文件，无需重复上传")
    previous_revision = doc.updated_at if doc else None
    try:
        text, chunks, vectors = await prepare_document(filename, data)
    except Exception as exc:
        raise model_error(exc) from exc
    if not doc:
        doc = Document(owner_id=user.id)
        db.add(doc)
    else:
        claimed = db.execute(
            update(Document)
            .where(Document.id == doc.id, Document.updated_at == previous_revision)
            .values(updated_at=now())
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            raise HTTPException(409, "文档已被其他操作更新，请刷新后重试")
        snapshot(db, doc, user.id)
        db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
    doc.title, doc.product, doc.version = title, product, version
    doc.filename, doc.content, doc.digest = filename, text, digest
    doc.visibility, doc.department = visibility, user.department
    doc.size, doc.chunk_count = len(data), len(chunks)
    doc.embedding_profile, doc.updated_at = embedding_profile(), now()
    db.flush()
    for i, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
        db.add(Chunk(document_id=doc.id, ordinal=i, text=chunk, embedding=vector))
    snapshot(db, doc, user.id)
    db.commit()
    return doc_json(doc)


@app.post("/api/documents", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    product: str = Form(...),
    version: str = Form(...),
    visibility: str = Form("company"),
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    return await store_document(file, title, product, version, visibility, user, db)


@app.put("/api/documents/{doc_id}")
async def replace_document(
    doc_id: str,
    file: UploadFile = File(...),
    title: str = Form(...),
    product: str = Form(...),
    version: str = Form(...),
    visibility: str = Form("company"),
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    doc = accessible_doc(db, user, doc_id)
    return await store_document(file, title, product, version, visibility, user, db, doc)


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    doc = accessible_doc(db, user, doc_id)
    db.delete(doc)
    db.commit()
    return {"ok": True}


def own_conversation(db: Session, user: User, conversation_id: str) -> Conversation:
    conv = db.scalar(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.owner_id == user.id)
    )
    if not conv:
        raise HTTPException(404, "会话不存在")
    return conv


@app.get("/api/conversations")
def conversations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    convs = db.scalars(
        select(Conversation)
        .where(Conversation.owner_id == user.id)
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    ).all()
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at} for c in convs]


@app.get("/api/conversations/{conversation_id}")
def conversation(conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conv = own_conversation(db, user, conversation_id)
    messages = db.scalars(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at, Message.id)
    ).all()
    result = []
    for message in messages:
        sources, valid = resolve_sources(db, user, message.sources)
        result.append(
            {
                "id": message.id,
                "role": message.role,
                "content": message.content if valid else "参考资料已更新、删除或不再可访问，请重新提问。",
                "sources": sources if valid else [],
                "status": message.status if valid else "stale",
                "product": message.product,
                "version": message.version,
            }
        )
    return {"id": conv.id, "title": conv.title, "messages": result}


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    conv = own_conversation(db, user, conversation_id)
    if conv.busy_until > time.time():
        raise HTTPException(409, "请等待当前回答结束后再删除会话")
    db.delete(conv)
    db.commit()
    return {"ok": True}


@app.post("/api/chat")
async def chat(
    body: ChatBody, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    if body.conversation_id:
        conv = own_conversation(db, user, body.conversation_id)
    else:
        conv = Conversation(owner_id=user.id, title=body.question[:40])
        db.add(conv)
        db.flush()
    conv_id = conv.id
    acquired = db.execute(
        update(Conversation)
        .where(
            Conversation.id == conv_id,
            Conversation.busy_until <= time.time(),
        )
        .values(busy_until=time.time() + 300, updated_at=now())
    )
    if acquired.rowcount != 1:
        raise HTTPException(409, "此会话正在生成回答，请等待结束后再发送")
    previous = db.scalars(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(10)
    ).all()[::-1]
    history = []
    for message in previous:
        _, valid = resolve_sources(db, user, message.sources)
        if (
            valid
            and message.status == "complete"
            and message.product == body.product
            and message.version == body.version
        ):
            history.append({"role": message.role, "content": message.content[:6000]})
    # Short follow-ups reuse the preceding question for retrieval, not historical answers as evidence.
    query = body.question
    if history and len(body.question) < 30:
        last_question = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
        query = f"{last_question}\n{body.question}"
    db.add(
        Message(
            conversation_id=conv_id,
            role="user",
            content=body.question,
            product=body.product,
            version=body.version,
        )
    )
    db.commit()

    async def events():
        trace = Trace("chat", user.id, conv_id)
        content = ""
        sources = []
        status = "interrupted"
        assistant_id = None
        try:
            yield sse("conversation", {"id": conv_id})
            yield sse("status", {"message": "正在检索可访问的产品资料…"})
            async with asyncio.timeout(240):
                with SessionLocal() as stream_db:
                    sources = await retrieve(stream_db, user, query, body.product, body.version)
                trace.details["source_count"] = len(sources)
                yield sse("sources", {"items": sources})
                yield sse("status", {"message": "正在根据参考资料整理回答…" if sources else "未找到足够资料"})
                async with aclosing(answer_stream(body.question, sources, history)) as answer:
                    async for delta in answer:
                        if await request.is_disconnected():
                            return
                        content += delta
                        if len(content) > 40_000:
                            raise ValueError("回答过长，请缩小问题范围后重试")
                        yield sse("delta", {"text": delta})
            status = "complete"
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            status = "error"
            trace.details["error_type"] = type(exc).__name__
            # Never log prompts, document contents, credentials, or upstream response bodies.
            logger.warning("generation_failed type=%s", type(exc).__name__)
            message = "回答未能完整生成，请重试；如持续失败，请管理员检查模型配置。"
            yield sse("error", {"message": message})
        finally:
            with SessionLocal() as final_db:
                assistant = Message(
                    conversation_id=conv_id,
                    role="assistant",
                    content=content,
                    sources=sources,
                    status=status,
                    product=body.product,
                    version=body.version,
                )
                final_db.add(assistant)
                final_db.execute(
                    update(Conversation)
                    .where(Conversation.id == conv_id)
                    .values(busy_until=0, updated_at=now())
                )
                final_db.commit()
                assistant_id = assistant.id
            trace.details["output_characters"] = len(content)
            trace.finish(status)
        if status == "complete":
            yield sse("done", {"message_id": assistant_id, "conversation_id": conv_id})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get("/api/users")
def users(_user: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [user_json(u) for u in db.scalars(select(User).order_by(User.name)).all()]


@app.post("/api/users", status_code=201)
def create_user(body: CreateUserBody, _user: User = Depends(admin_user), db: Session = Depends(get_db)):
    user = User(
        username=body.username,
        name=body.name,
        department=body.department,
        role="member",
        password_hash=hash_password(body.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "该账号已存在，请更换账号名") from None
    return user_json(user)


app.include_router(review_router)
app.include_router(observability_router)
app.include_router(tavern_router)

# Built assets are served from the same origin in the container deployment.
DIST = ROOT / "frontend" / "dist"


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "接口不存在")
    target = (DIST / path).resolve()
    if target.is_relative_to(DIST.resolve()) and target.is_file():
        return FileResponse(target)
    if DIST.joinpath("index.html").is_file():
        return FileResponse(DIST / "index.html")
    return JSONResponse({"message": "DDT QA Agent API 已启动，开发界面请访问 http://localhost:5173"})
