import asyncio
import json
import time

import httpx
import pytest
from conftest import events, upload
from sqlalchemy import select

from app import reviews
from app.config import settings
from app.db import Chunk, Document, DocumentReview, DocumentVersion, ReviewTurn, SessionLocal
from app.review_model import Finding, ReviewResult


def open_review(client, doc_id):
    response = client.post(f"/api/documents/{doc_id}/reviews")
    assert response.status_code == 200, response.text
    return response.json()


def run_review(client, review_id, **kwargs):
    return events(
        client.post(
            f"/api/reviews/{review_id}/messages",
            json={
                "question": "检查冲突、缺失及描述建议",
                **kwargs,
            },
        )
    )


def reviewed_draft(admin):
    doc_id = upload(admin).json()["id"]
    review = open_review(admin, doc_id)
    stream = run_review(admin, review["id"])
    assert stream[-1][0] == "done"
    finding = [data for event, data in stream if event == "result"][-1]["findings"][0]
    adopted = admin.post(f"/api/reviews/{review['id']}/adopt", json={"finding_id": finding["id"]})
    assert adopted.status_code == 200, adopted.text
    return doc_id, review, finding, adopted.json()


def save(admin, doc_id, draft, **values):
    return admin.put(
        f"/api/documents/{doc_id}/versions/{draft['id']}",
        json={
            "version": draft["version"],
            "content": draft["content"],
            "expected_updated_at": draft["updated_at"],
            **values,
        },
    )


def publish(admin, doc_id, draft):
    return admin.post(
        f"/api/documents/{doc_id}/versions/{draft['id']}/publish",
        json={
            "expected_updated_at": draft["updated_at"],
        },
    )


def test_standalone_review_adopt_draft_diff_publish_and_history(admin):
    doc_id, review, finding, draft = reviewed_draft(admin)
    assert open_review(admin, doc_id)["id"] == review["id"]
    detail = admin.get(f"/api/reviews/{review['id']}").json()
    assert detail["turns"][0]["sources"] == []
    assert "仅针对当前文档" in detail["turns"][0]["summary"]
    original = admin.get(f"/api/documents/{doc_id}").json()
    assert original["content"] == draft["base_content"]
    assert original["version"] == "v1"
    assert draft["status"] == "draft" and draft["content"].startswith("# ")
    assert any(item["kind"] != "equal" for item in draft["diff"])
    assert (
        admin.post(f"/api/reviews/{review['id']}/adopt", json={"finding_id": finding["id"]}).status_code
        == 409
    )
    saved = save(admin, doc_id, draft, content=draft["content"] + "\n\n草稿中的测试专用说明。").json()
    assert save(admin, doc_id, draft).status_code == 409
    assert publish(admin, doc_id, draft).status_code == 409
    # A draft is never indexed.
    with SessionLocal() as db:
        assert all("测试专用" not in c.text for c in db.scalars(select(Chunk)))
    published = publish(admin, doc_id, saved)
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    current = admin.get(f"/api/documents/{doc_id}").json()
    assert current["version"] == saved["version"] and current["filename"].endswith(".md")
    assert "测试专用" in current["content"]
    assert current["updated_at"] != original["updated_at"]
    with SessionLocal() as db:
        assert any("测试专用" in c.text for c in db.scalars(select(Chunk)))
    history = admin.get(f"/api/documents/{doc_id}/versions").json()
    assert len(history) == 2 and all(v["status"] == "published" for v in history)
    old_id = next(v["id"] for v in history if v["version"] == "v1")
    assert admin.get(f"/api/documents/{doc_id}/versions/{old_id}").json()["content"] == original["content"]
    assert save(admin, doc_id, published.json()).status_code == 409
    assert open_review(admin, doc_id)["id"] != review["id"]
    assert admin.get(f"/api/reviews/{review['id']}").json()["turns"][0]["status"] == "stale"


def test_related_review_excludes_target_and_inaccessible_documents(admin, monkeypatch):
    doc_id = upload(admin, title="紫杉采集指南").json()["id"]
    other_id = upload(
        admin, "紫杉平台通过设备编码导入测量记录，测量记录的数据保留期限为三十天。", title="紫杉存储规范"
    ).json()["id"]
    secret_id = upload(
        admin, "紫杉平台通过设备编码导入测量记录，内部隐私口令不能向成员透露。", visibility="private"
    ).json()["id"]
    captured = []

    async def analyze(doc, part, question, sources, history, index):
        captured.extend(sources)
        return ReviewResult(
            summary="保留期限需要核对资料的权威性。",
            findings=[
                Finding(
                    kind="conflict",
                    title="记录保留期限不同",
                    explanation="需由负责人确认采用哪个期限。",
                    suggestion="请数据负责人核对两份规范的适用版本和生效日期，确认保留期限后同步更新两份文档。",
                    source_numbers=[1],
                )
            ],
        )

    monkeypatch.setattr(reviews, "analyze_part", analyze)
    admin.post("/api/auth/demo", json={"account": "product"})
    review = open_review(admin, doc_id)
    assert run_review(admin, review["id"])[-1][0] == "done"
    assert other_id in {s["document_id"] for s in captured}
    assert not {doc_id, secret_id} & {s["document_id"] for s in captured}
    assert all(s["text"] for s in captured)
    finding = admin.get(f"/api/reviews/{review['id']}").json()["turns"][0]["findings"][0]
    assert not finding["can_apply"]
    assert "确认保留期限后同步更新两份文档" in finding["suggestion"]
    assert (
        admin.post(f"/api/reviews/{review['id']}/adopt", json={"finding_id": finding["id"]}).status_code
        == 403
    )
    assert admin.get(f"/api/documents/{doc_id}/versions").status_code == 403
    admin.post("/api/auth/demo", json={"account": "support"})
    assert admin.get(f"/api/reviews/{review['id']}").status_code == 404


def test_unrelated_documents_do_not_become_review_evidence(admin):
    doc_id = upload(admin, "紫杉平台支持设备编码导入测量记录，数据保留期限为九十天。").json()["id"]
    upload(admin, "食堂午餐供应清炒菠菜和米饭，营业地点在南侧大厅。", title="食堂供应安排")
    review = open_review(admin, doc_id)
    stream = run_review(admin, review["id"])
    assert stream[-1][0] == "done"
    assert [v for k, v in stream if k == "result"][-1]["sources"] == []


def test_review_revalidates_related_evidence_before_read_and_adopt(admin):
    doc_id, review, finding, _ = reviewed_draft(admin)
    other_id = upload(admin, "紫杉平台的设备编码支持测量记录导入，保留期限为三十天。").json()["id"]
    run_review(admin, review["id"])
    with SessionLocal() as db:
        turn = db.scalars(
            select(ReviewTurn)
            .where(ReviewTurn.review_id == review["id"])
            .order_by(ReviewTurn.created_at.desc())
        ).first()
        assert any(s["document_id"] == other_id for s in turn.sources)
        finding_id = turn.findings[0]["id"]
        db.get(Document, other_id).visibility = "private"
        # Admin still sees private documents, so remove the reference entirely.
        db.delete(db.get(Document, other_id))
        db.commit()
    detail = admin.get(f"/api/reviews/{review['id']}").json()["turns"][-1]
    assert detail["status"] == "stale" and not detail["findings"] and not detail["sources"]
    assert (
        admin.post(f"/api/reviews/{review['id']}/adopt", json={"finding_id": finding_id}).status_code == 409
    )
    assert admin.get(f"/api/documents/{doc_id}").status_code == 200


def test_review_failure_preserves_completed_parts_and_can_resume(admin, monkeypatch):
    monkeypatch.setattr(reviews, "PART_SIZE", 25)
    calls = []
    failure = True

    async def analyze(doc, part, question, sources, history, index):
        calls.append(index)
        if index == 1 and failure:
            raise RuntimeError("test failure")
        return ReviewResult(summary=f"已完成分段 {index + 1}", findings=[])

    monkeypatch.setattr(reviews, "analyze_part", analyze)
    doc_id = upload(admin, "紫杉平台的测量记录通过设备编码导入。" * 4).json()["id"]
    review = open_review(admin, doc_id)
    stream = run_review(admin, review["id"])
    assert stream[-1][0] == "error" and all(e != "done" for e, _ in stream)
    saved = admin.get(f"/api/reviews/{review['id']}").json()["turns"][0]
    assert saved["status"] == "error" and saved["completed_parts"] == 1
    assert "分段 1" in saved["summary"]
    failure = False
    calls.clear()
    stream = run_review(admin, review["id"], resume_turn_id=saved["id"])
    assert stream[-1][0] == "done" and 0 not in calls
    saved = admin.get(f"/api/reviews/{review['id']}").json()["turns"][0]
    assert saved["status"] == "complete" and saved["completed_parts"] == saved["total_parts"]


def test_review_lease_blocks_parallel_requests_and_recovers_after_expiry(admin):
    doc_id = upload(admin).json()["id"]
    review = open_review(admin, doc_id)
    with SessionLocal() as db:
        db.get(DocumentReview, review["id"]).busy_until = time.time() + 300
        db.commit()
    assert (
        admin.post(f"/api/reviews/{review['id']}/messages", json={"question": "检查文档"}).status_code == 409
    )
    with SessionLocal() as db:
        db.get(DocumentReview, review["id"]).busy_until = time.time() - 1
        turn = ReviewTurn(review_id=review["id"], question="被中断的审查")
        db.add(turn)
        db.commit()
    assert admin.get(f"/api/reviews/{review['id']}").json()["turns"][0]["status"] == "interrupted"
    assert run_review(admin, review["id"])[-1][0] == "done"


def test_stale_target_and_index_failure_cannot_overwrite_published_content(admin, monkeypatch):
    doc_id, review, _, draft = reviewed_draft(admin)
    original = admin.get(f"/api/documents/{doc_id}").json()

    async def fail(*args):
        raise RuntimeError("index failed")

    monkeypatch.setattr(reviews, "prepare_document", fail)
    assert publish(admin, doc_id, draft).status_code == 502
    assert admin.get(f"/api/documents/{doc_id}").json() == original
    assert admin.get(f"/api/documents/{doc_id}/versions/{draft['id']}").json()["status"] == "draft"
    updated = admin.put(
        f"/api/documents/{doc_id}",
        data={
            "title": "紫杉使用指南",
            "product": "紫杉平台",
            "version": "v-other",
            "visibility": "company",
        },
        files={
            "file": (
                "updated.md",
                "新版紫杉平台数据保留期限为一百天，并更新了导入说明。".encode(),
                "text/markdown",
            )
        },
    )
    assert updated.status_code == 200
    assert publish(admin, doc_id, draft).status_code == 409
    assert save(admin, doc_id, draft).status_code == 409
    assert (
        admin.post(f"/api/reviews/{review['id']}/messages", json={"question": "继续审查"}).status_code == 409
    )


def test_publish_rechecks_draft_after_index_preparation(admin, monkeypatch):
    doc_id, _, _, draft = reviewed_draft(admin)
    original_prepare = reviews.prepare_document

    async def concurrent_edit(*args):
        prepared = await original_prepare(*args)
        with SessionLocal() as db:
            db.get(DocumentVersion, draft["id"]).updated_at = "concurrent-edit"
            db.commit()
        return prepared

    monkeypatch.setattr(reviews, "prepare_document", concurrent_edit)
    assert publish(admin, doc_id, draft).status_code == 409
    assert admin.get(f"/api/documents/{doc_id}").json()["version"] == "v1"


def test_stale_evidence_blocks_draft_publish_and_can_be_replaced_without_deleting_old_draft(admin):
    doc_id = upload(admin).json()["id"]
    other_id = upload(admin, "紫杉平台通过设备编码导入测量记录，数据保留期限为三十天。").json()["id"]
    review = open_review(admin, doc_id)
    stream = run_review(admin, review["id"])
    result = [v for k, v in stream if k == "result"][-1]
    assert result["sources"]
    adopted = admin.post(
        f"/api/reviews/{review['id']}/adopt", json={"finding_id": result["findings"][0]["id"]}
    ).json()
    assert admin.delete(f"/api/documents/{other_id}").status_code == 200
    assert publish(admin, doc_id, adopted).status_code == 409
    fresh = admin.post(f"/api/documents/{doc_id}/drafts?review_id={review['id']}&fresh=true")
    assert fresh.status_code == 201, fresh.text
    assert fresh.json()["id"] != adopted["id"]
    history = admin.get(f"/api/documents/{doc_id}/versions").json()
    assert len([item for item in history if item["status"] == "draft"]) == 2
    assert admin.get(f"/api/documents/{doc_id}").json()["version"] == "v1"


def test_draft_operations_are_admin_only_and_selected_draft_lock_is_enforced(admin):
    doc_id, review, finding, first = reviewed_draft(admin)
    other = admin.post(f"/api/documents/{doc_id}/drafts?review_id={review['id']}&fresh=true").json()
    assert other["id"] != first["id"]
    changed = save(admin, doc_id, other, content=other["content"] + "\n\n新增的说明段落。").json()
    stale = admin.post(
        f"/api/reviews/{review['id']}/adopt",
        json={
            "finding_id": finding["id"],
            "draft_id": other["id"],
            "expected_updated_at": other["updated_at"],
        },
    )
    assert stale.status_code == 409
    adopted = admin.post(
        f"/api/reviews/{review['id']}/adopt",
        json={
            "finding_id": finding["id"],
            "draft_id": other["id"],
            "expected_updated_at": changed["updated_at"],
        },
    )
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["id"] == other["id"]
    admin.post("/api/auth/demo", json={"account": "product"})
    assert admin.post(f"/api/documents/{doc_id}/drafts").status_code == 403
    assert save(admin, doc_id, changed).status_code == 403
    assert publish(admin, doc_id, changed).status_code == 403
    assert admin.get(f"/api/documents/{doc_id}/versions/{changed['id']}").status_code == 403


@pytest.mark.parametrize(
    "mode",
    [
        "success",
        "truncated",
        "invalid_json",
        "invalid_edit",
        "missing_suggestion",
        "blank_suggestion",
        "unrepaired_suggestion",
    ],
)
def test_production_review_model_protocol_uses_target_and_permission_filtered_context(
    admin, monkeypatch, mode
):
    doc_id = upload(admin).json()["id"]
    review = open_review(admin, doc_id)
    for key, value in {
        "demo_mode": False,
        "retrieval_mode": "keyword",
        "model_base_url": "https://api.deepseek.com",
        "model_api_key": "test-key",
        "chat_model": "deepseek-flash",
    }.items():
        monkeypatch.setattr(settings, key, value)
    original_client = httpx.AsyncClient
    requests = []

    def upstream(request):
        body = json.loads(request.content)
        requests.append(body)
        assert "紫杉平台" in body["messages"][1]["content"]
        assert "无相关资料" in body["messages"][1]["content"]
        assert body["response_format"] == {"type": "json_object"}
        content = {
            "summary": "独立审查完成，建议增加标题。",
            "findings": [
                {
                    "kind": "clarity",
                    "title": "增加标题",
                    "explanation": "提升可读性。",
                    "suggestion": "在文末补充维护责任章节，向文档负责人核实责任人后填写。",
                    "original": "不存在的原文" if mode == "invalid_edit" else "",
                    "replacement": "## 维护责任\n\n请明确文档的维护责任人。",
                    "source_numbers": [],
                }
            ],
        }
        # One incomplete item among valid items must prevent accepting the entire result.
        content["findings"].append(
            {
                "kind": "missing",
                "title": "缺少适用范围",
                "explanation": "未明确测量记录导入适用于哪些设备。",
                "suggestion": "向产品负责人核对支持的设备范围，并在导入说明前补充适用范围章节。",
            }
        )
        if mode == "unrepaired_suggestion" or (
            len(requests) == 1 and mode in {"missing_suggestion", "blank_suggestion"}
        ):
            content["findings"][1].pop("suggestion")
            if mode == "blank_suggestion":
                content["findings"][1]["suggestion"] = " \n\t "
        return httpx.Response(
            200,
            json={
                "usage": {"prompt_tokens": 30, "completion_tokens": 10},
                "choices": [
                    {
                        "finish_reason": "length" if mode == "truncated" else "stop",
                        "message": {"content": "broken" if mode == "invalid_json" else json.dumps(content)},
                    }
                ],
            },
        )

    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(upstream))
    )
    stream = run_review(admin, review["id"])
    assert requests and requests[0]["thinking"] == {"type": "disabled"}
    trace = admin.get("/api/observability/traces?operation=review").json()["items"][0]
    assert trace["input_tokens"] == 30 * len(requests)
    assert trace["output_tokens"] == 10 * len(requests)
    failed = mode in {"truncated", "invalid_json", "unrepaired_suggestion"}
    assert stream[-1][0] == ("error" if failed else "done")
    saved = admin.get(f"/api/reviews/{review['id']}").json()["turns"][0]
    if mode in {"missing_suggestion", "blank_suggestion", "unrepaired_suggestion"}:
        assert len(requests) == 2
        assert "每项补齐非空的suggestion" in requests[1]["messages"][-1]["content"]
    if failed:
        assert not saved["findings"] and saved["status"] == "error"
        assert all(event != "done" for event, _ in stream)
    else:
        assert len(saved["findings"]) == 2
        assert all(finding["suggestion"].strip() for finding in saved["findings"])
    if mode == "invalid_edit":
        assert not [v for k, v in stream if k == "result"][-1]["findings"][0]["can_apply"]


def test_cancelled_review_retains_results_and_releases_lease(admin, monkeypatch):
    async def cancelled(*args):
        raise asyncio.CancelledError

    monkeypatch.setattr(reviews, "analyze_part", cancelled)
    doc_id = upload(admin).json()["id"]
    review = open_review(admin, doc_id)
    response = admin.post(f"/api/reviews/{review['id']}/messages", json={"question": "审查文档"})
    assert "event: done" not in response.text
    saved = admin.get(f"/api/reviews/{review['id']}").json()
    assert not saved["busy"] and saved["turns"][0]["status"] == "interrupted"
