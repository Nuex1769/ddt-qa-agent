import json

import httpx
import pytest
from conftest import events, upload
from sqlalchemy import select

from app import rag
from app.config import Settings, settings
from app.db import Chunk, Document, SessionLocal


def production_settings(**overrides):
    return Settings(
        _env_file=None,
        **{
            "demo_mode": False,
            "session_secret": "test-only-session-secret-with-32-characters",
            "admin_password": "test-only-password-123",
            "model_base_url": "https://api.deepseek.com",
            "model_api_key": "test-chat-key",
            "chat_model": "deepseek-flash",
            "retrieval_mode": "keyword",
            **overrides,
        },
    )


def test_deepseek_keyword_configuration_needs_no_embedding():
    config = production_settings()
    assert not config.vector_enabled
    assert config.thinking_options == {"thinking": {"type": "disabled"}}
    assert production_settings(chat_thinking="enabled").thinking_options == {"thinking": {"type": "enabled"}}
    assert production_settings(model_base_url="https://other.invalid/v1").thinking_options == {}
    with pytest.raises(ValueError, match="DeepSeek 官方"):
        production_settings(retrieval_mode="hybrid")


def test_separate_embedding_service_requires_its_own_key():
    with pytest.raises(ValueError, match="EMBEDDING_API_KEY"):
        production_settings(
            retrieval_mode="hybrid",
            embedding_base_url="https://vectors.invalid/v1",
            embedding_model="test-embedding",
        )
    config = production_settings(
        retrieval_mode="hybrid",
        model_base_url="https://shared.invalid/v1/",
        embedding_model="test-embedding",
    )
    assert config.vector_api_key == "test-chat-key"


def test_keyword_real_answer_stream_uses_only_deepseek_chat(admin, monkeypatch):
    # Documents indexed in demo mode must remain immediately usable with keyword retrieval.
    upload(admin)
    for key, value in {
        "demo_mode": False,
        "retrieval_mode": "keyword",
        "model_base_url": "https://api.deepseek.com",
        "model_api_key": "test-chat-key",
        "chat_model": "deepseek-flash",
    }.items():
        monkeypatch.setattr(settings, key, value)
    requests = []
    original = httpx.AsyncClient

    def upstream(request):
        requests.append(request)
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-chat-key"
        body = json.loads(request.content)
        assert body["model"] == "deepseek-flash" and body["stream"] is True
        assert body["thinking"] == {"type": "disabled"}
        assert "九十天" in body["messages"][0]["content"]
        payloads = [
            {"choices": [{"delta": {"reasoning_content": "不要显示的思考"}}]},
            {"choices": [{"delta": {"content": "保留九十天"}}]},
            {"choices": [{"delta": {"content": "。[1]"}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"total_tokens": 100}},
        ]
        return httpx.Response(
            200,
            text=": keep-alive\n\n"
            + "".join(f"data: {json.dumps(p)}\n\n" for p in payloads)
            + "data: [DONE]\n\n",
            headers={"Content-Type": "text/event-stream"},
        )

    monkeypatch.setattr(
        rag.httpx, "AsyncClient", lambda **_kwargs: original(transport=httpx.MockTransport(upstream))
    )
    added = upload(admin, "紫杉平台的设备导入任务支持批量校验与错误重试，请检查失败记录。")
    assert added.status_code == 201
    with SessionLocal() as db:
        assert db.get(Document, added.json()["id"]).embedding_profile == "keyword"
        assert all(c.embedding is None for c in db.scalars(select(Chunk)))
    config = admin.get("/api/config").json()
    assert config["retrieval_mode"] == "keyword" and config["needs_reindex"] == 0
    stream = events(admin.post("/api/chat", json={"question": "测量记录保留多久？"}))
    assert stream[-1][0] == "done"
    assert "".join(d["text"] for k, d in stream if k == "delta") == "保留九十天。[1]"
    assert len(requests) == 1  # No request to /embeddings during upload or retrieval.
    saved = admin.get(f"/api/conversations/{stream[0][1]['id']}").json()["messages"][-1]
    assert saved["content"] == "保留九十天。[1]" and saved["status"] == "complete"


async def test_independent_vector_service_and_stable_profile(monkeypatch):
    config = production_settings(
        retrieval_mode="hybrid",
        embedding_base_url="https://vectors.invalid/v1/",
        embedding_api_key="test-vector-key",
        embedding_model="test-embedding",
        embedding_dimensions=3,
    )
    monkeypatch.setattr(rag, "settings", config)
    profile = rag.embedding_profile()
    config.chat_model = "another-chat-model"
    config.model_base_url = "https://other-chat.invalid/v1"
    assert rag.embedding_profile() == profile
    original = httpx.AsyncClient

    def upstream(request):
        assert str(request.url) == "https://vectors.invalid/v1/embeddings"
        assert request.headers["Authorization"] == "Bearer test-vector-key"
        assert json.loads(request.content) == {"model": "test-embedding", "input": ["测试"]}
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.0, 1.0, 0.0]}]})

    monkeypatch.setattr(
        rag.httpx, "AsyncClient", lambda **_kwargs: original(transport=httpx.MockTransport(upstream))
    )
    assert await rag.embed(["测试"]) == [[0.0, 1.0, 0.0]]
    config.embedding_model = "another-vector-model"
    assert rag.embedding_profile() != profile
