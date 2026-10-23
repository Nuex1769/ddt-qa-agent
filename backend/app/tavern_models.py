from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, now, uid


class Drink(Base):
    __tablename__ = "tavern_drinks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    category: Mapped[str] = mapped_column(String(40), default="鸡尾酒")
    price_fen: Mapped[int] = mapped_column(Integer)
    alcohol_percent: Mapped[float] = mapped_column(Float)
    sweetness: Mapped[int] = mapped_column(Integer)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    ingredients: Mapped[list] = mapped_column(JSON, default=list)
    allergens: Mapped[list] = mapped_column(JSON, default=list)
    private_recipe: Mapped[str] = mapped_column(Text, default="")
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[str] = mapped_column(String(40), default=now)


class Customer(Base):
    __tablename__ = "tavern_customers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    # OpenID is obtained only from WeChat's server; never accept it from the client.
    wechat_openid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    intent: Mapped[dict] = mapped_column(JSON, default=dict)
    cart: Mapped[list] = mapped_column(JSON, default=list)
    # Legacy column retained for schema compatibility; ignored by order-history inference.
    usual: Mapped[list] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class OrderRecord(Base):
    """Read-only history supplied by a trusted order integration, never by the guest API."""

    __tablename__ = "tavern_order_records"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("tavern_customers.id"), index=True)
    status: Mapped[str] = mapped_column(String(20))
    completed_at: Mapped[str] = mapped_column(String(40), index=True)
    items: Mapped[list] = mapped_column(JSON)
