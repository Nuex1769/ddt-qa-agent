import time
import uuid
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    select,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import ROOT, settings


def uid() -> str:
    return uuid.uuid4().hex


def now() -> str:
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


class AppState(Base):
    __tablename__ = "app_state"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(Text, default="")
    role: Mapped[str] = mapped_column(String(20), default="member")
    department: Mapped[str] = mapped_column(String(80), default="产品部")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(255))
    product: Mapped[str] = mapped_column(String(80), index=True)
    version: Mapped[str] = mapped_column(String(40), index=True)
    visibility: Mapped[str] = mapped_column(String(20), default="company")
    department: Mapped[str] = mapped_column(String(80), default="产品部")
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(String(64), index=True)
    size: Mapped[int] = mapped_column(Integer)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    embedding_profile: Mapped[str] = mapped_column(String(64), default="demo")
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list | None] = mapped_column(
        JSON().with_variant(Vector(settings.embedding_dimensions), "postgresql"), nullable=True
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    version: Mapped[str] = mapped_column(String(40))
    content: Mapped[str] = mapped_column(Text)
    base_content: Mapped[str] = mapped_column(Text, default="")
    base_version: Mapped[str] = mapped_column(String(40), default="")
    base_revision: Mapped[str] = mapped_column(String(40))
    published_revision: Mapped[str] = mapped_column(String(40), default="", index=True)
    metadata_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    adopted_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class DocumentReview(Base):
    __tablename__ = "document_reviews"
    __table_args__ = (UniqueConstraint("document_id", "owner_id", "base_revision"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    base_revision: Mapped[str] = mapped_column(String(40))
    draft_id: Mapped[str] = mapped_column(String(32), default="")
    busy_until: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class ReviewTurn(Base):
    __tablename__ = "review_turns"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    review_id: Mapped[str] = mapped_column(ForeignKey("document_reviews.id", ondelete="CASCADE"), index=True)
    question: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, default="")
    findings: Mapped[list] = mapped_column(JSON, default=list)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    completed_parts: Mapped[int] = mapped_column(Integer, default=0)
    total_parts: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="streaming")
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(100), default="新对话")
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    busy_until: Mapped[float] = mapped_column(Float, default=0)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="complete")
    product: Mapped[str] = mapped_column(String(80), default="")
    version: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Observation(Base):
    __tablename__ = "observations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    operation: Mapped[str] = mapped_column(String(20), index=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    session_id: Mapped[str] = mapped_column(String(32), default="")
    mode: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), index=True)
    started_at: Mapped[str] = mapped_column(String(40), index=True)
    ended_at: Mapped[str] = mapped_column(String(40))
    duration_ms: Mapped[float] = mapped_column(Float)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    spans: Mapped[list] = mapped_column(JSON, default=list)
    export_status: Mapped[str] = mapped_column(String(20), default="disabled", index=True)
    export_attempts: Mapped[int] = mapped_column(Integer, default=0)
    export_error: Mapped[str] = mapped_column(String(200), default="")
    next_export_at: Mapped[float] = mapped_column(Float, default=0)
    exported_at: Mapped[str] = mapped_column(String(40), default="")


ROOT.joinpath("data").mkdir(exist_ok=True)
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
    pool_pre_ping=True,
)


if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def sqlite_setup(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=5000")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as db:
        yield db


def init_db():
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks "
                    "USING hnsw (embedding vector_cosine_ops)"
                )
            )
    # Reclaim abandoned generation leases after a server restart.
    with SessionLocal() as db:
        from sqlalchemy import update

        from .versions import snapshot

        # Additive history backfill for databases created before document versioning.
        for doc in db.scalars(select(Document)):
            snapshot(db, doc, doc.owner_id)

        db.execute(update(Conversation).where(Conversation.busy_until < time.time()).values(busy_until=0))
        expired = select(DocumentReview.id).where(DocumentReview.busy_until < time.time())
        db.execute(
            update(ReviewTurn)
            .where(ReviewTurn.review_id.in_(expired), ReviewTurn.status == "streaming")
            .values(status="interrupted")
        )
        db.execute(update(DocumentReview).where(DocumentReview.busy_until < time.time()).values(busy_until=0))
        db.commit()
