import asyncio
import base64
import json
import time
from contextlib import aclosing

import httpx
import pytest
from conftest import events, upload

from app import main, observability, rag, reviews
from app.config import Settings, settings
from app.db import Observation, SessionLocal, now, uid
from app.observability import Trace, current_trace, export_pending, model_usage, span


@pytest.fixture(autouse=True)
def isolate_exporter(monkeypatch):
    async def idle():
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "export_loop", idle)


def list_traces(admin, **params):
    response = admin.get("/api/observability/traces", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_chat_and_review_records_are_content_free_and_admin_only(admin):
    secret = "文档专有内容绝不能出现在观测中：紫杉平台测量记录保留九十天。"
    doc_id = upload(admin, secret, title="秘密文件名").json()["id"]
    stream = events(admin.post("/api/chat", json={"question": "秘密问题：紫杉记录保留多久？"}))
    assert stream[-1][0] == "done"
    review = admin.post(f"/api/documents/{doc_id}/reviews").json()
    response = admin.post(f"/api/reviews/{review['id']}/messages", json={"question": "秘密审查重点"})
    assert events(response)[-1][0] == "done"
    records = list_traces(admin)
    assert records["total"] == 2
    assert {r["operation"] for r in records["items"]} == {"chat", "review"}
    for record in records["items"]:
        detail = admin.get(f"/api/observability/traces/{record['id']}").json()
        assert detail["status"] == "complete" and detail["duration_ms"] >= 0
        assert detail["input_tokens"] is None and detail["output_tokens"] is None
        assert detail["export_status"] == "disabled" and not detail["langfuse_url"]
        assert detail["spans"] and all("ended_at" in s for s in detail["spans"])
        text = json.dumps(detail, ensure_ascii=False)
        assert all(s not in text for s in [secret, "秘密问题", "秘密审查重点", "秘密文件名"])
    config = admin.get("/api/observability/config").json()
    assert config["content_capture"] is False
    assert not config["enabled"]
    trace_id = records["items"][0]["id"]
    # These metadata records contain no document snapshot, so deleting a document leaks no text.
    admin.delete(f"/api/documents/{doc_id}")
    assert admin.get(f"/api/observability/traces/{trace_id}").status_code == 200
    admin.post("/api/auth/demo", json={"account": "product"})
    for path in ["config", "traces", f"traces/{trace_id}"]:
        assert admin.get(f"/api/observability/{path}", params={"role": "admin"}).status_code == 403
    assert admin.post(f"/api/observability/traces/{trace_id}/retry").status_code == 403
    admin.post("/api/auth/logout")
    assert admin.get("/api/observability/traces").status_code == 401


def seed_record(**values):
    with SessionLocal() as db:
        record = Observation(
            id=uid(),
            operation="chat",
            user_id="test-user",
            session_id="test-session",
            mode="production",
            model="test-model",
            status="complete",
            started_at=now(),
            ended_at=now(),
            duration_ms=12,
        )
        for key, value in values.items():
            setattr(record, key, value)
        db.add(record)
        db.commit()
        return record.id


def test_trace_filters_pagination_and_literal_search(admin):
    for _ in range(22):
        seed_record()
    special = seed_record(operation="review", status="error", model="model_100%")
    assert len(list_traces(admin)["items"]) == 20
    assert len(list_traces(admin, page=2)["items"]) == 3
    assert list_traces(admin, operation="review", status="error")["items"][0]["id"] == special
    assert list_traces(admin, search="100%", export_status="disabled")["total"] == 1
    assert list_traces(admin, search=special)["total"] == 1
    assert list_traces(admin, status="interrupted")["total"] == 0
    assert admin.get("/api/observability/traces", params={"page_size": 1000}).status_code == 422
    assert admin.get("/api/observability/traces/not-found").status_code == 404


def test_upstream_usage_is_recorded_without_prompts_or_reasoning(admin, monkeypatch):
    upload(admin)
    monkeypatch.setattr(settings, "demo_mode", False)
    monkeypatch.setattr(settings, "retrieval_mode", "keyword")
    monkeypatch.setattr(settings, "chat_model", "test-model")
    monkeypatch.setattr(settings, "model_base_url", "https://model.invalid/v1")
    original = httpx.AsyncClient

    def upstream(request):
        body = json.loads(request.content)
        assert body["stream_options"]["include_usage"]
        chunks = [
            {"choices": [{"delta": {"reasoning_content": "私密推理"}}]},
            {"choices": [{"delta": {"content": "私密回答"}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 27, "completion_tokens": 11}},
        ]
        return httpx.Response(
            200, text="".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
        )

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(upstream)))
    assert events(admin.post("/api/chat", json={"question": "测量记录保留多久？"}))[-1][0] == "done"
    record = list_traces(admin)["items"][0]
    assert (record["input_tokens"], record["output_tokens"]) == (27, 11)
    detail = admin.get(f"/api/observability/traces/{record['id']}").json()
    assert detail["spans"][-1]["kind"] == "generation"
    assert all(
        s not in json.dumps(detail, ensure_ascii=False) for s in ["私密推理", "私密回答", "测量记录保留多久"]
    )


def test_errors_and_cancellation_are_not_recorded_as_success(admin, monkeypatch):
    async def broken(*args):
        yield "部分回答"
        raise RuntimeError("sk-private-do-not-store")

    monkeypatch.setattr(main, "answer_stream", broken)
    assert events(admin.post("/api/chat", json={"question": "测试失败状态"}))[-1][0] == "error"
    failed = list_traces(admin, status="error")["items"][0]
    detail = admin.get(f"/api/observability/traces/{failed['id']}").json()
    assert detail["details"]["output_characters"] == 4
    assert detail["details"]["error_type"] == "RuntimeError"
    assert "sk-private" not in json.dumps(detail)

    async def cancelled(*args):
        raise asyncio.CancelledError
        yield  # pragma: no cover

    monkeypatch.setattr(main, "answer_stream", cancelled)
    response = admin.post("/api/chat", json={"question": "测试取消状态"})
    assert "event: done" not in response.text
    assert list_traces(admin, status="interrupted")["total"] == 1
    doc_id = upload(admin).json()["id"]
    review_id = admin.post(f"/api/documents/{doc_id}/reviews").json()["id"]

    async def failed_review(*args):
        raise RuntimeError("private-document-text")

    monkeypatch.setattr(reviews, "analyze_part", failed_review)
    assert (
        events(admin.post(f"/api/reviews/{review_id}/messages", json={"question": "审查文档"}))[-1][0]
        == "error"
    )
    assert list_traces(admin, operation="review", status="error")["total"] == 1


async def test_spans_close_in_same_context_when_answer_is_stopped(admin):
    trace = Trace("chat", "user", "session")
    async with aclosing(rag.answer_stream("test", [], [])) as answer:
        await anext(answer)
    trace.finish("interrupted")
    assert current_trace.get() is None
    record = list_traces(admin)["items"][0]
    detail = admin.get(f"/api/observability/traces/{record['id']}").json()
    assert detail["spans"][0]["status"] == "interrupted"
    assert "ended_at" in detail["spans"][0]


async def test_parallel_traces_keep_context_and_usage_separate(admin):
    async def operation(index):
        trace = Trace("review", str(index), str(index))
        with span("first", "generation"):
            model_usage({"usage": {"prompt_tokens": index, "completion_tokens": 2}}, "model")
            await asyncio.sleep(0)
            with span("child"):
                await asyncio.sleep(0)
        trace.finish("complete")

    await asyncio.gather(operation(3), operation(7))
    records = list_traces(admin)["items"]
    assert {r["input_tokens"] for r in records} == {3, 7}
    for record in records:
        assert str(record["input_tokens"]) == record["user_id"]
        detail = admin.get(f"/api/observability/traces/{record['id']}").json()
        assert detail["spans"][1]["parent_id"] == detail["spans"][0]["id"]


@pytest.mark.parametrize("outcome", ["success", "unauthorized", "partial", "offline"])
async def test_langfuse_otlp_export_auth_status_privacy_and_retry(admin, monkeypatch, outcome):
    for key, value in {
        "langfuse_enabled": True,
        "langfuse_base_url": "https://langfuse.invalid",
        "langfuse_public_key": "pk-test",
        "langfuse_secret_key": "sk-test-secret",
        "langfuse_project_id": "project-test",
    }.items():
        monkeypatch.setattr(settings, key, value)
    trace = Trace("review", "user", "session")
    with span("review-model", "generation"):
        model_usage({"usage": {"prompt_tokens": 25, "completion_tokens": 9}}, "model")
    trace.finish("complete")
    original = httpx.AsyncClient
    calls = []

    def upstream(request):
        calls.append(request)
        assert str(request.url) == "https://langfuse.invalid/api/public/otel/v1/traces"
        assert (
            request.headers["authorization"]
            == "Basic " + base64.b64encode(b"pk-test:sk-test-secret").decode()
        )
        assert request.headers["x-langfuse-ingestion-version"] == "4"
        payload = json.loads(request.content)
        spans = payload["resourceSpans"][0]["scopeSpans"][0]["spans"]
        assert len(spans) == 2 and all(s["traceId"] == trace.id for s in spans)
        assert spans[1]["parentSpanId"] == spans[0]["spanId"]
        attrs = {a["key"]: a["value"]["stringValue"] for a in spans[1]["attributes"]}
        assert json.loads(attrs["langfuse.observation.usage_details"]) == {"input": 25, "output": 9}
        assert all("input" not in a["key"] and "output" not in a["key"] for a in spans[0]["attributes"])
        if outcome == "offline":
            raise httpx.ConnectError("sk-test-secret private-upstream-body")
        return httpx.Response(
            401 if outcome == "unauthorized" else 200,
            json={"partialSuccess": {"rejectedSpans": "1", "errorMessage": "sk-test-secret"}}
            if outcome == "partial"
            else {},
        )

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(upstream)))
    await export_pending()
    detail = admin.get(f"/api/observability/traces/{trace.id}").json()
    assert detail["export_attempts"] == 1
    assert detail["export_status"] == ("synced" if outcome == "success" else "failed")
    assert "sk-test-secret" not in json.dumps(detail)
    assert "sk-test-secret" not in admin.get("/api/observability/config").text
    if outcome == "success":
        assert detail["langfuse_url"] == f"https://langfuse.invalid/project/project-test/traces/{trace.id}"
        assert admin.post(f"/api/observability/traces/{trace.id}/retry").status_code == 409
    else:
        assert not detail["langfuse_url"]
        # Respect backoff, stop after three tries, then allow an explicit manual retry.
        await export_pending()
        assert len(calls) == 1
        for _ in range(3):
            with SessionLocal() as db:
                db.get(Observation, trace.id).next_export_at = 0
                db.commit()
            await export_pending()
        assert len(calls) == 3
        assert admin.post(f"/api/observability/traces/{trace.id}/retry").status_code == 200
        detail = admin.get(f"/api/observability/traces/{trace.id}").json()
        assert detail["export_status"] == "pending" and detail["export_attempts"] == 0


async def test_disabled_export_does_not_contact_network_and_expired_lease_recovers(admin, monkeypatch):
    trace_id = seed_record(export_status="sending", export_attempts=3, next_export_at=time.time() - 10)

    async def forbidden(*args, **kwargs):
        raise AssertionError("No network expected")

    monkeypatch.setattr(httpx.AsyncClient, "post", forbidden)
    await export_pending()
    assert admin.get(f"/api/observability/traces/{trace_id}").json()["export_status"] == "sending"
    monkeypatch.setattr(settings, "langfuse_enabled", True)
    await export_pending()
    assert admin.get(f"/api/observability/traces/{trace_id}").json()["export_status"] == "failed"


def test_observability_database_failure_never_breaks_answer(admin, monkeypatch):
    def unavailable():
        raise RuntimeError("database failure")

    monkeypatch.setattr(observability, "SessionLocal", unavailable)
    assert events(admin.post("/api/chat", json={"question": "本地无匹配依据的问题"}))[-1][0] == "done"


def test_langfuse_config_requires_valid_endpoint_and_credentials():
    with pytest.raises(ValueError, match="LANGFUSE_PUBLIC_KEY"):
        Settings(_env_file=None, langfuse_enabled=True)
    for endpoint in [
        "javascript:alert(1)",
        "https://user:pass@example.com",
        "https://example.com?key=secret",
    ]:
        with pytest.raises(ValueError, match="LANGFUSE_BASE_URL"):
            Settings(
                _env_file=None,
                langfuse_enabled=True,
                langfuse_base_url=endpoint,
                langfuse_public_key="pk",
                langfuse_secret_key="sk",
            )
