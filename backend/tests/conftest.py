import os
import tempfile
from pathlib import Path

# Set isolation before importing application modules. Tests never touch the user's database.
TEST_ROOT = Path(tempfile.mkdtemp(prefix="ddt-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'test.db'}"
os.environ["DEMO_MODE"] = "true"
os.environ["RETRIEVAL_MODE"] = "hybrid"
os.environ["CHAT_THINKING"] = "auto"
os.environ["EMBEDDING_BASE_URL"] = ""
os.environ["EMBEDDING_API_KEY"] = ""
os.environ["SESSION_SECRET"] = "isolated-tests-only-not-a-production-key"
os.environ["LANGFUSE_ENABLED"] = "false"
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""
os.environ["LANGFUSE_PROJECT_ID"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.auth import seed_users  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    def users_only():
        with SessionLocal() as db:
            seed_users(db)

    monkeypatch.setattr(main, "seed", users_only)
    main.login_attempts.clear()
    with TestClient(main.app) as client:
        yield client


@pytest.fixture
def admin(client):
    response = client.post("/api/auth/demo", json={"account": "admin"})
    assert response.status_code == 200
    return client


def upload(client, content="紫杉平台支持通过设备编码导入测量记录，数据保留期限为九十天。", **kwargs):
    fields = {
        "title": "紫杉平台使用指南",
        "product": "紫杉平台",
        "version": "v1",
        "visibility": "company",
        **kwargs,
    }
    return client.post(
        "/api/documents", data=fields, files={"file": ("guide.md", content.encode(), "text/markdown")}
    )


def events(response):
    import json

    result = []
    for block in response.text.strip().split("\n\n"):
        lines = block.splitlines()
        result.append((lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))))
    return result
