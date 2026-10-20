"""Content-free local traces and an optional durable Langfuse OTLP exporter."""

import asyncio
import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from functools import wraps
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from .auth import admin_user
from .config import settings
from .db import Observation, SessionLocal, get_db, now, uid

logger = logging.getLogger("ddt")
router = APIRouter(prefix="/api/observability", dependencies=[Depends(admin_user)])
current_trace: ContextVar = ContextVar("ddt_trace", default=None)
current_span: ContextVar = ContextVar("ddt_span", default=None)


class Trace:
    def __init__(self, operation: str, user_id: str, session_id: str):
        self.id = uid()
        self.operation = operation
        self.user_id = user_id
        self.session_id = session_id
        self.started_at = now()
        self.started = time.perf_counter()
        self.spans = []
        self.details = {}
        self.token = current_trace.set(self)

    def finish(self, status: str):
        current_trace.reset(self.token)
        try:
            usage = [span for span in self.spans if span.get("input_tokens") is not None]
            outputs = [span for span in self.spans if span.get("output_tokens") is not None]
            with SessionLocal() as db:
                db.add(
                    Observation(
                        id=self.id,
                        operation=self.operation,
                        user_id=self.user_id,
                        session_id=self.session_id,
                        mode="demo" if settings.demo_mode else "production",
                        model=settings.chat_model if not settings.demo_mode else "",
                        status=status,
                        started_at=self.started_at,
                        ended_at=now(),
                        duration_ms=round((time.perf_counter() - self.started) * 1000, 2),
                        input_tokens=sum(s["input_tokens"] for s in usage) if usage else None,
                        output_tokens=sum(s["output_tokens"] for s in outputs) if outputs else None,
                        spans=self.spans,
                        details=self.details,
                        export_status="pending" if settings.langfuse_enabled else "disabled",
                    )
                )
                db.commit()
        except Exception as exc:
            # Observability must not change a business operation's result, or log its payload.
            logger.warning("trace_save_failed type=%s", type(exc).__name__)


@contextmanager
def span(name: str, kind: str = "span"):
    trace = current_trace.get()
    if trace is None:
        yield None
        return
    parent = current_span.get()
    item = {
        "id": uid()[:16],
        "parent_id": parent["id"] if parent else "",
        "name": name,
        "kind": kind,
        "started_at": now(),
        "status": "complete",
        "input_tokens": None,
        "output_tokens": None,
    }
    trace.spans.append(item)
    token = current_span.set(item)
    started = time.perf_counter()
    try:
        yield item
    except BaseException as exc:
        item["status"] = (
            "interrupted" if isinstance(exc, (asyncio.CancelledError, GeneratorExit)) else "error"
        )
        item["error_type"] = type(exc).__name__
        raise
    finally:
        item["ended_at"] = now()
        item["duration_ms"] = round((time.perf_counter() - started) * 1000, 2)
        current_span.reset(token)


def observed(name: str, kind: str = "span"):
    def decorate(fn):
        @wraps(fn)
        async def wrapped(*args, **kwargs):
            with span(name, kind):
                return await fn(*args, **kwargs)

        return wrapped

    return decorate


def model_usage(payload: dict, model: str):
    item = current_span.get()
    if item is None:
        return
    item["model"] = model
    usage = payload.get("usage") or {}
    for source, target in [("prompt_tokens", "input_tokens"), ("completion_tokens", "output_tokens")]:
        value = usage.get(source)
        if type(value) is int and value >= 0:
            item[target] = value


def trace_url(record: Observation) -> str:
    if record.export_status != "synced" or not settings.langfuse_project_id:
        return ""
    return (
        f"{settings.langfuse_base_url.rstrip('/')}/project/"
        f"{quote(settings.langfuse_project_id, safe='')}/traces/{record.id}"
    )


def record_json(record: Observation, detail: bool = False) -> dict:
    result = {
        key: getattr(record, key)
        for key in (
            "id",
            "operation",
            "user_id",
            "session_id",
            "mode",
            "model",
            "status",
            "started_at",
            "ended_at",
            "duration_ms",
            "input_tokens",
            "output_tokens",
            "export_status",
            "export_attempts",
            "export_error",
            "exported_at",
        )
    }
    result["langfuse_url"] = trace_url(record)
    if detail:
        result.update(spans=record.spans, details=record.details)
    return result


@router.get("/config")
def config():
    return {
        "enabled": settings.langfuse_enabled,
        "configured": bool(settings.langfuse_public_key and settings.langfuse_secret_key),
        "base_url": settings.langfuse_base_url if settings.langfuse_enabled else "",
        "project_link_configured": bool(settings.langfuse_project_id),
        "content_capture": False,
    }


@router.get("/traces")
def traces(
    operation: str = Query("", pattern="^(chat|review)?$"),
    status: str = Query("", pattern="^(complete|error|interrupted)?$"),
    export_status: str = Query("", pattern="^(disabled|pending|sending|synced|failed)?$"),
    search: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    criteria = []
    for field, value in [("operation", operation), ("status", status), ("export_status", export_status)]:
        if value:
            criteria.append(getattr(Observation, field) == value)
    if search.strip():
        criteria.append(
            or_(
                Observation.id.contains(search.strip(), autoescape=True),
                Observation.model.contains(search.strip(), autoescape=True),
            )
        )
    total = db.scalar(select(func.count()).select_from(Observation).where(*criteria))
    rows = db.scalars(
        select(Observation)
        .where(*criteria)
        .order_by(Observation.started_at.desc(), Observation.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {"items": [record_json(row) for row in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/traces/{trace_id}")
def trace_detail(trace_id: str, db: Session = Depends(get_db)):
    record = db.get(Observation, trace_id)
    if record is None:
        raise HTTPException(404, "观测记录不存在")
    return record_json(record, True)


@router.post("/traces/{trace_id}/retry")
def retry_trace(trace_id: str, db: Session = Depends(get_db)):
    if not settings.langfuse_enabled:
        raise HTTPException(409, "请先在服务端启用 Langfuse")
    changed = db.execute(
        update(Observation)
        .where(Observation.id == trace_id, Observation.export_status.in_(["failed", "disabled"]))
        .values(export_status="pending", export_attempts=0, next_export_at=0, export_error="")
    )
    if changed.rowcount != 1:
        if db.get(Observation, trace_id) is None:
            raise HTTPException(404, "观测记录不存在")
        raise HTTPException(409, "记录正在同步或已经同步，请刷新状态")
    db.commit()
    return {"queued": True}


def otlp_payload(record: Observation) -> dict:
    """OTLP/HTTP JSON, with Langfuse's documented attribute mappings."""

    def attrs(values):
        return [{"key": key, "value": {"stringValue": str(value)}} for key, value in values.items()]

    def nanos(value):
        return str(int(datetime.fromisoformat(value).timestamp() * 1_000_000_000))

    def exported_span(item, parent=""):
        values = {
            "langfuse.observation.type": item.get("kind", "span"),
            "langfuse.trace.name": f"ddt.{record.operation}",
            "user.id": record.user_id,
            "session.id": record.session_id,
            "langfuse.environment": record.mode,
            "langfuse.observation.metadata.status": item["status"],
        }
        if item.get("model"):
            values["langfuse.observation.model.name"] = item["model"]
        usage = {
            key: item[field]
            for key, field in [("input", "input_tokens"), ("output", "output_tokens")]
            if item.get(field) is not None
        }
        if usage:
            import json

            values["langfuse.observation.usage_details"] = json.dumps(usage)
        result = {
            "traceId": record.id,
            "spanId": item["id"],
            "name": item["name"],
            "kind": 1,
            "startTimeUnixNano": nanos(item["started_at"]),
            "endTimeUnixNano": nanos(item["ended_at"]),
            "attributes": attrs(values),
            "status": {"code": 1 if item["status"] == "complete" else 2},
        }
        if parent:
            result["parentSpanId"] = parent
        return result

    root_id = record.id[:16]
    root = exported_span(
        {
            "id": root_id,
            "name": f"ddt.{record.operation}",
            "status": record.status,
            "started_at": record.started_at,
            "ended_at": record.ended_at,
        }
    )
    children = [exported_span(s, s.get("parent_id") or root_id) for s in record.spans]
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": attrs({"service.name": "ddt-qa-agent"})},
                "scopeSpans": [
                    {"scope": {"name": "ddt.observability", "version": "1"}, "spans": [root, *children]}
                ],
            }
        ]
    }


async def export_pending():
    if not settings.langfuse_enabled:
        return
    with SessionLocal() as db:
        db.execute(
            update(Observation)
            .where(
                Observation.export_status == "sending",
                Observation.export_attempts >= 3,
                Observation.next_export_at <= time.time(),
            )
            .values(export_status="failed", export_error="同步进程已中断，请重新同步")
        )
        db.commit()
        eligible = or_(
            Observation.export_status.in_(["pending", "failed"]),
            Observation.export_status == "sending",
        )
        ids = list(
            db.scalars(
                select(Observation.id)
                .where(eligible, Observation.export_attempts < 3, Observation.next_export_at <= time.time())
                .order_by(Observation.started_at)
                .limit(5)
            )
        )
    for trace_id in ids:
        with SessionLocal() as db:
            changed = db.execute(
                update(Observation)
                .where(
                    Observation.id == trace_id,
                    eligible,
                    Observation.export_attempts < 3,
                    Observation.next_export_at <= time.time(),
                )
                .values(
                    export_status="sending",
                    export_attempts=Observation.export_attempts + 1,
                    next_export_at=time.time() + 30,
                )
            )
            db.commit()
            if changed.rowcount != 1:
                continue
            record = db.get(Observation, trace_id)
            payload = otlp_payload(record)
            attempts = record.export_attempts
        error = ""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.post(
                    f"{settings.langfuse_base_url.rstrip('/')}/api/public/otel/v1/traces",
                    auth=(settings.langfuse_public_key, settings.langfuse_secret_key),
                    headers={"x-langfuse-ingestion-version": "4"},
                    json=payload,
                )
                response.raise_for_status()
                partial = response.json().get("partialSuccess", {})
                if int(partial.get("rejectedSpans", 0)) or partial.get("errorMessage"):
                    error = "Langfuse 未完整接收记录，请检查服务端版本和配置"
        except httpx.HTTPStatusError as exc:
            error = f"Langfuse 返回 HTTP {exc.response.status_code}，请检查地址和服务端凭证"
        except Exception:
            error = "Langfuse 同步失败，请检查服务端连接和配置"
        with SessionLocal() as db:
            db.execute(
                update(Observation)
                .where(Observation.id == trace_id)
                .values(
                    export_status="failed" if error else "synced",
                    export_error=error,
                    exported_at="" if error else now(),
                    next_export_at=time.time() + min(300, 10**attempts),
                )
            )
            db.commit()


async def export_loop():
    while True:
        try:
            await export_pending()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("trace_export_failed type=%s", type(exc).__name__)
        await asyncio.sleep(5)
