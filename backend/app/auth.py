import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import User, get_db

signer = URLSafeTimedSerializer(settings.session_secret, salt="ddt-session-v1")
COOKIE = "ddt_session"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000).hex()
    return f"{salt}:{digest}"


def check_password(password: str, encoded: str) -> bool:
    if ":" not in encoded:
        # Keep invalid-account and wrong-password work comparable.
        hashlib.pbkdf2_hmac("sha256", password.encode(), b"invalid-account", 600_000)
        return False
    salt, expected = encoded.split(":", 1)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000).hex()
    return hmac.compare_digest(actual, expected)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    cookie = request.cookies.get(COOKIE)
    try:
        user_id = signer.loads(cookie or "", max_age=60 * 60 * 12)
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, "请先登录，或重新登录已过期的会话") from None
    user = db.get(User, user_id)
    if not user or not user.active:
        raise HTTPException(401, "当前账号不可用，请重新登录")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "此操作需要管理员权限")
    return user


def visible_documents(user: User):
    from sqlalchemy import and_, or_, true

    from .db import Document

    if user.role == "admin":
        return true()
    return or_(
        Document.visibility == "company",
        Document.owner_id == user.id,
        and_(Document.visibility == "department", Document.department == user.department),
    )


def user_json(user: User) -> dict:
    return {k: getattr(user, k) for k in ("id", "username", "name", "role", "department")}


def seed_users(db: Session):
    if not db.scalar(select(User).where(User.username == settings.admin_username)):
        db.add(
            User(
                username=settings.admin_username,
                name="知识库管理员",
                role="admin",
                department="产品部",
                password_hash=hash_password(settings.admin_password or secrets.token_urlsafe(32)),
            )
        )
    if settings.demo_mode:
        for username, name, department in [
            ("demo-product", "产品同事", "产品部"),
            ("demo-support", "客服同事", "客户服务部"),
        ]:
            if not db.scalar(select(User).where(User.username == username)):
                db.add(User(username=username, name=name, role="member", department=department))
    db.commit()
