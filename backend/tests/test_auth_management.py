import pytest
from conftest import upload
from sqlalchemy import select

from app.auth import seed_users
from app.config import settings
from app.db import SessionLocal, User
from app.manage import reset_admin_password


def test_reset_existing_admin_password_preserves_data_and_survives_seed(admin, monkeypatch):
    document_id = upload(admin).json()["id"]
    admin_id = admin.get("/api/auth/me").json()["id"]
    password = "reset-test-password-123"
    monkeypatch.setattr(settings, "admin_password", password)
    with SessionLocal() as db:
        usernames = list(db.scalars(select(User.username).order_by(User.username)))
        reset_admin_password(db)
        seed_users(db)
        assert list(db.scalars(select(User.username).order_by(User.username))) == usernames
    admin.post("/api/auth/logout")
    assert (
        admin.post(
            "/api/auth/login", json={"username": settings.admin_username, "password": "wrong"}
        ).status_code
        == 401
    )
    response = admin.post("/api/auth/login", json={"username": settings.admin_username, "password": password})
    assert response.status_code == 200
    assert response.json()["id"] == admin_id
    assert password not in response.text
    assert admin.get(f"/api/documents/{document_id}").status_code == 200
    assert admin.get("/api/auth/me").json()["id"] == admin_id


@pytest.mark.parametrize("password", ["", "short", " " * 12, "x" * 257])
def test_reset_rejects_invalid_password_without_changing_accounts(client, monkeypatch, password):
    monkeypatch.setattr(settings, "admin_password", password)
    with SessionLocal() as db:
        original = list(db.execute(select(User.id, User.password_hash)))
        with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
            reset_admin_password(db)
        assert list(db.execute(select(User.id, User.password_hash))) == original


@pytest.mark.parametrize("account", ["missing", "member", "inactive"])
def test_reset_cannot_create_promote_or_reactivate_accounts(client, monkeypatch, account):
    monkeypatch.setattr(settings, "admin_password", "reset-test-password-123")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == settings.admin_username))
        if account == "missing":
            monkeypatch.setattr(settings, "admin_username", "missing-admin")
        elif account == "member":
            user.role = "member"
        else:
            user.active = False
        db.commit()
        original = list(db.execute(select(User.id, User.password_hash, User.role, User.active)))
        with pytest.raises(ValueError, match="有效管理员不存在"):
            reset_admin_password(db)
        assert list(db.execute(select(User.id, User.password_hash, User.role, User.active))) == original
