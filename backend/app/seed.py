import hashlib

from sqlalchemy import select

from .auth import seed_users
from .config import ROOT, settings
from .db import AppState, Chunk, Document, SessionLocal, User
from .rag import splitter

SAMPLES = [
    ("getting-started.md", "工作台快速入门", "DDT 工作台", "v2.4", "company"),
    ("knowledge-guide.md", "知识库管理指南", "DDT 工作台", "v2.4", "company"),
    ("permissions.md", "成员与权限说明", "DDT 工作台", "v2.4", "company"),
    ("api-guide.md", "开放平台接入指南", "DDT 开放平台", "v1.0", "company"),
    ("release-plan.md", "产品内部发布计划", "DDT 工作台", "v2.5", "department"),
]


def seed():
    with SessionLocal() as db:
        seed_users(db)
        if not settings.demo_mode:
            return
        # Seed once; deleting examples must not recreate them at every restart.
        if db.get(AppState, "demo-seeded"):
            return
        admin = db.scalar(select(User).where(User.username == settings.admin_username))
        for filename, title, product, version, visibility in SAMPLES:
            content = ROOT.joinpath("examples", filename).read_text()
            digest = hashlib.sha256(content.encode()).hexdigest()
            if db.scalar(select(Document).where(Document.digest == digest)):
                continue
            chunks = splitter.split_text(content)
            doc = Document(
                title=title,
                filename=filename,
                product=product,
                version=version,
                visibility=visibility,
                department="产品部",
                owner_id=admin.id,
                content=content,
                digest=digest,
                size=len(content.encode()),
                chunk_count=len(chunks),
            )
            db.add(doc)
            db.flush()
            for i, text in enumerate(chunks):
                db.add(Chunk(document_id=doc.id, ordinal=i, text=text))
        db.add(AppState(key="demo-seeded", value="Sample content is fictional."))
        db.commit()
