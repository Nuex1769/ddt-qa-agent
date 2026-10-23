"""Ground habitual recommendations in completed orders, independently of cart and model output."""

from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .tavern_models import OrderRecord


def infer_usual(records: list[dict], at: datetime | None = None) -> dict:
    at = at or datetime.now(UTC)
    recent = []
    seen = set()
    for record in records:
        try:
            completed = datetime.fromisoformat(record["completed_at"])
        except (KeyError, ValueError, TypeError):
            continue
        if (
            completed.tzinfo is None
            or record.get("status") != "completed"
            or not at - timedelta(days=90) <= completed <= at
            or not record.get("id")
            or record["id"] in seen
        ):
            continue
        lines = {}
        for line in record.get("items", []):
            quantity = line.get("quantity")
            refunded = line.get("refunded_quantity", 0)
            drink_id = line.get("drink_id")
            if (
                isinstance(drink_id, str)
                and type(quantity) is int
                and type(refunded) is int
                and 0 <= refunded < quantity <= 20
            ):
                lines[drink_id] = lines.get(drink_id, 0) + quantity - refunded
        lines = {key: quantity for key, quantity in lines.items() if quantity <= 20}
        if lines:
            recent.append((completed, lines))
            seen.add(record["id"])
    recent.sort(key=lambda row: row[0], reverse=True)
    recent = recent[:10]
    counts = Counter(key for _, lines in recent for key in lines)
    result = {"source": "completed_orders", "status": "insufficient", "order_count": len(recent)}
    if not counts:
        return result
    ranked = counts.most_common()
    winner, frequency = ranked[0]
    if frequency < 3:
        return result
    if frequency / len(recent) < 0.6 or (len(ranked) > 1 and ranked[1][1] == frequency):
        return {**result, "status": "ambiguous"}
    quantities = [lines[winner] for _, lines in recent if winner in lines]
    quantity = Counter(quantities).most_common(1)[0][0]
    last = next(completed for completed, lines in recent if winner in lines)
    return {
        **result,
        "status": "ready",
        "drink_id": winner,
        "quantity": quantity,
        "occurrences": frequency,
        "last_order_at": last.isoformat(),
    }


def customer_usual(db: Session, customer_id: str) -> dict:
    at = datetime.now(UTC)
    records = db.scalars(
        select(OrderRecord)
        .where(
            OrderRecord.customer_id == customer_id,
            OrderRecord.status == "completed",
            OrderRecord.completed_at >= (at - timedelta(days=90)).isoformat(),
            OrderRecord.completed_at <= at.isoformat(),
        )
        .order_by(OrderRecord.completed_at.desc(), OrderRecord.id)
        .limit(100)
    )
    return infer_usual(
        [{"id": r.id, "status": r.status, "completed_at": r.completed_at, "items": r.items} for r in records],
        at,
    )
