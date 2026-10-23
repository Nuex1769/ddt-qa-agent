import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app import tavern
from app.config import ROOT, settings
from app.db import SessionLocal
from app.tavern_history import infer_usual
from app.tavern_models import Customer, Drink, OrderRecord


@pytest.fixture
def drinks(admin):
    tavern.attempts.clear()
    data = json.loads((ROOT / "examples/tavern-menu.json").read_text())
    assert admin.post("/api/admin/tavern/import", json=data).status_code == 201
    return admin.get("/api/admin/tavern/drinks").json()["items"]


def guest(client):
    response = client.post("/api/tavern/login", json={"mode": "demo"})
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["token"]}


def test_customer_isolation_and_no_internal_access(admin, drinks):
    first, second = guest(admin), guest(admin)
    admin.post("/api/auth/logout")
    assert admin.get("/api/documents", headers=first).status_code == 401
    assert admin.get("/api/admin/tavern/drinks", headers=first).status_code == 401
    assert admin.get("/api/tavern/me").status_code == 401
    payload = {"items": [{"drink_id": drinks[0]["id"], "quantity": 2}], "revision": 0}
    result = admin.put("/api/tavern/cart", headers=first, json=payload)
    assert result.status_code == 200
    assert result.json()["total_fen"] == drinks[0]["price_fen"] * 2
    assert admin.get("/api/tavern/cart", headers=second).json()["items"] == []
    for path in ("/api/tavern/menu", "/api/tavern/cart"):
        public = admin.get(path, headers=first).text
        assert "private_recipe" not in public
        assert "wechat_openid" not in public
    assert admin.post("/api/tavern/login", json={"mode": "demo", "role": "admin"}).status_code == 422


def test_zero_alcohol_sweetness_context_and_allergy_filter(admin, drinks):
    headers = guest(admin)
    response = admin.post(
        "/api/tavern/recommend", headers=headers, json={"message": "给我来一杯微甜的无酒精的鸡尾酒"}
    )
    assert response.status_code == 200
    assert response.json()["items"]
    for item in response.json()["items"]:
        assert item["drink"]["alcohol_percent"] == 0
        assert 1 <= item["drink"]["sweetness"] <= 2
        assert "private_recipe" not in item["drink"]
    response = admin.post("/api/tavern/recommend", headers=headers, json={"message": "40元以内"})
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["drink"]["price_fen"] <= 4000
    me = admin.get("/api/tavern/me", headers=headers).json()
    response = admin.put(
        "/api/tavern/preferences",
        headers=headers,
        json={"revision": me["revision"], "zero_alcohol": True, "avoid": ["坚果"]},
    )
    assert response.status_code == 200
    menu = admin.get("/api/tavern/menu", headers=headers).json()["items"]
    assert len(menu) == 2
    nut_drink = next(d for d in drinks if d["allergens"])
    result = admin.put(
        "/api/tavern/cart",
        headers=headers,
        json={
            "revision": response.json()["revision"],
            "items": [{"drink_id": nut_drink["id"], "quantity": 1}],
        },
    )
    assert result.status_code == 409


def seed_history(headers, drink_id, quantities=(2, 2, 1), status="completed"):
    token = headers["Authorization"].split(" ", 1)[1]
    customer_id = tavern.customer_signer.loads(token)
    with SessionLocal() as db:
        db.add_all(
            [
                OrderRecord(
                    id=f"{customer_id}-{status}-{index}",
                    customer_id=customer_id,
                    status=status,
                    completed_at=(datetime.now(UTC) - timedelta(days=index + 1)).isoformat(),
                    items=[{"drink_id": drink_id, "quantity": quantity}],
                )
                for index, quantity in enumerate(quantities)
            ]
        )
        db.commit()


def test_usual_inferred_from_orders_and_never_from_cart(admin, drinks):
    headers = guest(admin)
    response = admin.post("/api/tavern/recommend", headers=headers, json={"message": "老样子"})
    assert response.json()["items"] == []
    assert response.json()["usual_inference"]["status"] == "insufficient"
    cart = admin.get("/api/tavern/cart", headers=headers).json()
    items = [{"drink_id": drinks[0]["id"], "quantity": 9}]
    admin.put("/api/tavern/cart", headers=headers, json={"revision": cart["revision"], "items": items})
    # Cart edits and legacy explicitly saved preferences cannot masquerade as purchases.
    with SessionLocal() as db:
        customer = db.scalar(select(Customer))
        customer.usual = items
        db.commit()
    assert (
        admin.post("/api/tavern/recommend", headers=headers, json={"message": "老样子"}).json()["items"] == []
    )
    assert admin.put("/api/tavern/usual", headers=headers, json={"revision": 0}).status_code in (404, 405)
    seed_history(headers, drinks[0]["id"])
    seed_history(headers, drinks[1]["id"], (20,) * 8, "cancelled")
    before = admin.get("/api/tavern/cart", headers=headers).json()["items"]
    response = admin.post("/api/tavern/recommend", headers=headers, json={"message": "老样子"}).json()
    assert response["items"][0]["quantity"] == 2
    assert response["items"][0]["drink"]["id"] == drinks[0]["id"]
    assert "3笔已完成订单" in response["message"]
    assert response["usual_inference"]["source"] == "completed_orders"
    assert admin.get("/api/tavern/cart", headers=headers).json()["items"] == before
    assert admin.post("/api/tavern/orders", headers=headers, json={}).status_code in (404, 405)
    second = guest(admin)
    assert (
        admin.post("/api/tavern/recommend", headers=second, json={"message": "老样子"}).json()["items"] == []
    )
    assert (
        admin.post(
            "/api/tavern/recommend",
            headers=second,
            json={"message": "老样子", "customer_id": "other", "orders": []},
        ).status_code
        == 422
    )
    saved = drinks[0]
    assert (
        admin.put(
            f"/api/admin/tavern/drinks/{saved['id']}",
            json={**{k: v for k, v in saved.items() if k != "id"}, "available": False},
        ).status_code
        == 200
    )
    result = admin.post(
        "/api/tavern/recommend", headers=headers, json={"message": "老样子", "reset": True}
    ).json()
    assert result["items"] == []
    assert result["usual_inference"]["status"] == "unavailable"


def test_order_inference_recency_ambiguity_and_refunds():
    at = datetime.now(UTC)

    def record(index, drink="lime", days=1, status="completed", quantity=1, refunded=0):
        return {
            "id": str(index),
            "status": status,
            "completed_at": (at - timedelta(days=days)).isoformat(),
            "items": [{"drink_id": drink, "quantity": quantity, "refunded_quantity": refunded}],
        }

    orders = [record(i) for i in range(4)] + [record(4, "beer")]
    result = infer_usual(orders, at)
    assert result["drink_id"] == "lime" and result["occurrences"] == 4 and result["quantity"] == 1
    assert (
        infer_usual(
            orders
            + [
                record(6, "beer", status="cancelled"),
                record(7, "beer", status="refunded"),
                record(8, "beer", days=100),
                record(9, "beer", days=-1),
                record(10, "beer", quantity=1, refunded=1),
            ],
            at,
        )
        == result
    )
    assert infer_usual(orders[:2], at)["status"] == "insufficient"
    assert (
        infer_usual([record(i, "lime" if i < 3 else "beer") for i in range(6)], at)["status"] == "ambiguous"
    )
    assert infer_usual([record(i, quantity=2, refunded=1) for i in range(3)], at)["quantity"] == 1
    assert infer_usual([record(1)] * 5, at)["order_count"] == 1
    # Recent ten orders take precedence over an old but frequent preference.
    history = [record(i, "beer", days=i + 1) for i in range(10)] + [
        record(i + 10, days=40 + i) for i in range(20)
    ]
    assert infer_usual(history, at)["drink_id"] == "beer"


def test_usual_rechecks_current_restrictions(admin, drinks):
    headers = guest(admin)
    alcohol = next(d for d in drinks if d["alcohol_percent"] > 0)
    seed_history(headers, alcohol["id"])
    result = admin.post("/api/tavern/recommend", headers=headers, json={"message": "老样子，要无酒精"}).json()
    assert result["items"] == [] and result["usual_inference"]["status"] == "unavailable"
    result = admin.post("/api/tavern/recommend", headers=headers, json={"message": "老样子，10元以内"}).json()
    assert result["items"] == []
    me = admin.get("/api/tavern/me", headers=headers).json()
    admin.put(
        "/api/tavern/preferences",
        headers=headers,
        json={"revision": me["revision"], "zero_alcohol": False, "avoid": alcohol["ingredients"]},
    )
    result = admin.post("/api/tavern/recommend", headers=headers, json={"message": "老样子"}).json()
    assert result["items"] == []


def test_conflicts_and_atomic_import(admin, drinks):
    headers = guest(admin)
    payload = {"revision": 0, "items": []}
    assert admin.put("/api/tavern/cart", headers=headers, json=payload).status_code == 200
    assert admin.put("/api/tavern/cart", headers=headers, json=payload).status_code == 409
    new = {k: v for k, v in drinks[0].items() if k not in ("id", "revision")}
    duplicate = {**new, "name": "重复测试"}
    result = admin.post("/api/admin/tavern/import", json={"drinks": [duplicate, new]})
    assert result.status_code == 409
    assert admin.get("/api/admin/tavern/drinks?q=重复测试").json()["total"] == 0
    update = {**new, "revision": drinks[0]["revision"]}
    path = f"/api/admin/tavern/drinks/{drinks[0]['id']}"
    assert admin.put(path, json=update).status_code == 200
    assert admin.put(path, json=update).status_code == 409
    admin.post("/api/auth/demo", json={"account": "support"})
    assert admin.get("/api/admin/tavern/drinks").status_code == 403


@pytest.mark.parametrize("message", ["我对神秘果过敏", "我要无糖的"])
def test_uncertain_safety_request_requires_clarification(admin, drinks, message):
    headers = guest(admin)
    result = admin.post("/api/tavern/recommend", headers=headers, json={"message": message}).json()
    assert result["items"] == []
    assert result["intent"]["clarification"]


def test_production_does_not_offer_demo_identity(admin, monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", False)
    assert admin.post("/api/tavern/login", json={"mode": "demo"}).status_code == 404


def test_wechat_openid_is_server_verified_and_reused(client, monkeypatch):
    tavern.attempts.clear()
    monkeypatch.setattr(settings, "wechat_app_id", "test-app")
    monkeypatch.setattr(settings, "wechat_app_secret", "test-secret")

    async def fake_get(self, url, **kwargs):
        assert url == "https://api.weixin.qq.com/sns/jscode2session"
        assert kwargs["params"]["js_code"] == "one-use-code"
        return httpx.Response(
            200,
            json={"openid": "server-verified-id", "session_key": "secret"},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    for _ in range(2):
        response = client.post("/api/tavern/login", json={"mode": "wechat", "code": "one-use-code"})
        assert response.status_code == 200
        assert "server-verified-id" not in response.text
        assert "secret" not in response.text
    with SessionLocal() as db:
        assert len(list(db.scalars(select(Customer)))) == 1


def test_model_cannot_weaken_explicit_zero_alcohol(admin, drinks, monkeypatch):
    headers = guest(admin)
    monkeypatch.setattr(settings, "demo_mode", False)

    async def fake_post(self, url, **kwargs):
        assert "private_recipe" not in json.dumps(kwargs)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {
                                    "zero_alcohol": False,
                                    "min_sweetness": 0,
                                    "max_sweetness": 4,
                                    "max_price_fen": 100000,
                                }
                            )
                        },
                    }
                ]
            },
            request=httpx.Request("POST", "https://test.invalid"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    response = admin.post(
        "/api/tavern/recommend", headers=headers, json={"message": "我要微甜的无酒精鸡尾酒，40元以内"}
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "model"
    assert response.json()["items"]
    assert all(
        i["drink"]["alcohol_percent"] == 0
        and 1 <= i["drink"]["sweetness"] <= 2
        and i["drink"]["price_fen"] <= 4000
        for i in response.json()["items"]
    )


def test_multiple_invalid_cart_lines_can_be_removed_individually(admin, drinks):
    headers = guest(admin)
    items = [{"drink_id": d["id"], "quantity": 1} for d in drinks[:2]]
    cart = admin.put("/api/tavern/cart", headers=headers, json={"revision": 0, "items": items}).json()
    with SessionLocal() as db:
        for item in items:
            db.get(Drink, item["drink_id"]).available = False
        db.commit()
    result = admin.put(
        "/api/tavern/cart", headers=headers, json={"revision": cart["revision"], "items": items[1:]}
    )
    assert result.status_code == 200
    assert len(result.json()["items"]) == 1
    assert not result.json()["items"][0]["valid"]


def test_catalog_rechecked_after_model_and_failure_never_recommends(admin, drinks, monkeypatch):
    headers = guest(admin)
    monkeypatch.setattr(settings, "demo_mode", False)

    async def change_catalog(self, url, **kwargs):
        with SessionLocal() as db:
            for drink in db.scalars(select(Drink)):
                drink.available = False
            db.commit()
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"finish_reason": "stop", "message": {"content": json.dumps({"zero_alcohol": True})}}
                ]
            },
            request=httpx.Request("POST", "https://test.invalid"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", change_catalog)
    result = admin.post("/api/tavern/recommend", headers=headers, json={"message": "无酒精"})
    assert result.status_code == 200
    assert result.json()["items"] == []

    async def unavailable(self, url, **kwargs):
        raise httpx.ConnectError("test failure")

    monkeypatch.setattr(httpx.AsyncClient, "post", unavailable)
    result = admin.post("/api/tavern/recommend", headers=headers, json={"message": "随便推荐"})
    assert result.json()["mode"] == "unavailable"
    assert result.json()["items"] == []
    assert "重试" in result.json()["message"]
