"""Local maintenance commands; credentials are read from server configuration only."""

import argparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .config import settings
from .db import SessionLocal, User


def reset_admin_password(db: Session) -> None:
    password = settings.admin_password
    if not 12 <= len(password) <= 256 or len(password.strip()) < 12:
        raise ValueError("请先在 .env 中设置 12–256 位的 ADMIN_PASSWORD（去除首尾空白后至少 12 位）")
    user = db.scalar(select(User).where(User.username == settings.admin_username))
    if not user or user.role != "admin" or not user.active:
        raise ValueError("ADMIN_USERNAME 对应的有效管理员不存在，请检查配置和数据库；未修改任何账号")
    user.password_hash = hash_password(password)
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="DDT 本地账号维护")
    parser.add_argument("command", choices=["reset-admin-password"])
    parser.parse_args()
    with SessionLocal() as db:
        try:
            reset_admin_password(db)
        except ValueError as error:
            parser.exit(1, f"{error}\n")
    print("管理员密码已更新为 ADMIN_PASSWORD 配置值；现有资料和账号已保留。")


if __name__ == "__main__":
    main()
