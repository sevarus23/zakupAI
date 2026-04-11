from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import select, func, col

from ..auth import get_admin_user
from ..database import get_session
from ..models import Lead, LLMUsage, Lot, Purchase, User
from ..schemas import AdminDashboard, AdminPurchaseRead, AdminUserRead, LeadRead

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard", response_model=AdminDashboard)
def get_dashboard(
    _admin: User = Depends(get_admin_user),
    session=Depends(get_session),
) -> AdminDashboard:
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    total_users = session.exec(select(func.count(User.id))).one()
    new_users_today = session.exec(
        select(func.count(User.id)).where(col(User.created_at) >= today_start)
    ).one()
    total_purchases = session.exec(select(func.count(Purchase.id))).one()
    purchases_today = session.exec(
        select(func.count(Purchase.id)).where(col(Purchase.created_at) >= today_start)
    ).one()

    return AdminDashboard(
        total_users=total_users,
        new_users_today=new_users_today,
        total_purchases=total_purchases,
        purchases_today=purchases_today,
    )


@router.get("/users", response_model=List[AdminUserRead])
def list_users(
    q: Optional[str] = Query(default=None),
    _admin: User = Depends(get_admin_user),
    session=Depends(get_session),
) -> List[AdminUserRead]:
    stmt = select(User)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            col(User.email).ilike(pattern) | col(User.full_name).ilike(pattern)
        )
    stmt = stmt.order_by(col(User.created_at).desc())
    users = session.exec(stmt).all()

    result = []
    for u in users:
        purchase_count = session.exec(
            select(func.count(Purchase.id)).where(Purchase.user_id == u.id)
        ).one()
        result.append(
            AdminUserRead(
                id=u.id,
                email=u.email,
                full_name=u.full_name,
                organization=u.organization,
                is_admin=u.is_admin,
                is_active=u.is_active,
                created_at=u.created_at,
                purchase_count=purchase_count,
            )
        )
    return result


class ToggleAdminRequest(BaseModel):
    is_admin: bool


@router.patch("/users/{user_id}/admin")
def toggle_admin(
    user_id: int,
    payload: ToggleAdminRequest,
    admin: User = Depends(get_admin_user),
    session=Depends(get_session),
):
    if admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change own admin status")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.is_admin = payload.is_admin
    session.add(user)
    session.commit()
    return {"ok": True, "is_admin": user.is_admin}


@router.get("/leads", response_model=List[LeadRead])
def list_leads(
    status: Optional[str] = Query(default=None),
    _admin: User = Depends(get_admin_user),
    session=Depends(get_session),
) -> List[LeadRead]:
    stmt = select(Lead)
    if status:
        stmt = stmt.where(Lead.status == status)
    stmt = stmt.order_by(col(Lead.created_at).desc())
    return session.exec(stmt).all()


@router.get("/usage")
def get_usage_summary(
    days: int = Query(default=30, ge=1, le=365),
    purchase_id: Optional[int] = Query(default=None),
    _admin: User = Depends(get_admin_user),
    session=Depends(get_session),
) -> dict:
    """Aggregated LLM/search API usage stats for admins.

    Returns totals + breakdowns by channel, operation, and top purchases.
    Token / cost values come straight from provider responses (we never
    hardcode prices). Cost can be NULL when the provider didn't return it
    (Yandex always; Perplexity sometimes) — UI должен это показать как «—».
    """
    since = datetime.utcnow() - timedelta(days=days)

    base_filter = [col(LLMUsage.created_at) >= since]
    if purchase_id is not None:
        base_filter.append(LLMUsage.purchase_id == purchase_id)

    def _row_to_dict(row, *fields):
        return {field: getattr(row, field) if hasattr(row, field) else row[i] for i, field in enumerate(fields)}

    # Totals
    totals_row = session.exec(
        select(
            func.count(LLMUsage.id),
            func.coalesce(func.sum(LLMUsage.prompt_tokens), 0),
            func.coalesce(func.sum(LLMUsage.completion_tokens), 0),
            func.coalesce(func.sum(LLMUsage.total_tokens), 0),
            func.coalesce(func.sum(LLMUsage.cost_usd), 0.0),
            func.coalesce(func.sum(LLMUsage.request_count), 0),
        ).where(*base_filter)
    ).one()

    totals = {
        "rows": int(totals_row[0] or 0),
        "prompt_tokens": int(totals_row[1] or 0),
        "completion_tokens": int(totals_row[2] or 0),
        "total_tokens": int(totals_row[3] or 0),
        "cost_usd": round(float(totals_row[4] or 0.0), 6),
        "requests": int(totals_row[5] or 0),
    }

    # Breakdown by channel
    by_channel_rows = session.exec(
        select(
            LLMUsage.channel,
            func.count(LLMUsage.id),
            func.coalesce(func.sum(LLMUsage.total_tokens), 0),
            func.coalesce(func.sum(LLMUsage.cost_usd), 0.0),
            func.coalesce(func.sum(LLMUsage.request_count), 0),
        )
        .where(*base_filter)
        .group_by(LLMUsage.channel)
        .order_by(func.coalesce(func.sum(LLMUsage.cost_usd), 0.0).desc())
    ).all()
    by_channel = [
        {
            "channel": r[0],
            "calls": int(r[1] or 0),
            "total_tokens": int(r[2] or 0),
            "cost_usd": round(float(r[3] or 0.0), 6),
            "requests": int(r[4] or 0),
        }
        for r in by_channel_rows
    ]

    # Breakdown by operation
    by_operation_rows = session.exec(
        select(
            LLMUsage.operation,
            LLMUsage.channel,
            func.count(LLMUsage.id),
            func.coalesce(func.sum(LLMUsage.total_tokens), 0),
            func.coalesce(func.sum(LLMUsage.cost_usd), 0.0),
        )
        .where(*base_filter)
        .group_by(LLMUsage.operation, LLMUsage.channel)
        .order_by(func.count(LLMUsage.id).desc())
    ).all()
    by_operation = [
        {
            "operation": r[0],
            "channel": r[1],
            "calls": int(r[2] or 0),
            "total_tokens": int(r[3] or 0),
            "cost_usd": round(float(r[4] or 0.0), 6),
        }
        for r in by_operation_rows
    ]

    # Top purchases by cost
    top_purchases_rows = session.exec(
        select(
            LLMUsage.purchase_id,
            func.count(LLMUsage.id),
            func.coalesce(func.sum(LLMUsage.total_tokens), 0),
            func.coalesce(func.sum(LLMUsage.cost_usd), 0.0),
        )
        .where(*base_filter, LLMUsage.purchase_id.is_not(None))
        .group_by(LLMUsage.purchase_id)
        .order_by(func.coalesce(func.sum(LLMUsage.cost_usd), 0.0).desc())
        .limit(20)
    ).all()
    top_purchases = []
    for r in top_purchases_rows:
        pid = r[0]
        purchase = session.get(Purchase, pid) if pid else None
        top_purchases.append(
            {
                "purchase_id": pid,
                "purchase_name": (purchase.custom_name or purchase.full_name) if purchase else None,
                "calls": int(r[1] or 0),
                "total_tokens": int(r[2] or 0),
                "cost_usd": round(float(r[3] or 0.0), 6),
            }
        )

    # Errors count
    errors_count = session.exec(
        select(func.count(LLMUsage.id)).where(*base_filter, LLMUsage.success == False)  # noqa: E712
    ).one()

    return {
        "since": since.isoformat() + "Z",
        "days": days,
        "purchase_id": purchase_id,
        "totals": totals,
        "errors": int(errors_count or 0),
        "by_channel": by_channel,
        "by_operation": by_operation,
        "top_purchases": top_purchases,
        "note": (
            "cost_usd берётся из ответа API провайдера; для каналов без cost (Yandex, "
            "часть Perplexity-моделей) поле может быть 0 — смотрите request_count и total_tokens."
        ),
    }


@router.get("/purchases", response_model=List[AdminPurchaseRead])
def list_all_purchases(
    user_id: Optional[int] = Query(default=None),
    status: Optional[str] = Query(default=None),
    _admin: User = Depends(get_admin_user),
    session=Depends(get_session),
) -> List[AdminPurchaseRead]:
    stmt = select(Purchase)
    if user_id:
        stmt = stmt.where(Purchase.user_id == user_id)
    if status:
        stmt = stmt.where(Purchase.status == status)
    stmt = stmt.order_by(col(Purchase.created_at).desc())
    purchases = session.exec(stmt).all()

    result = []
    for p in purchases:
        user = session.get(User, p.user_id)
        lots_count = session.exec(
            select(func.count(Lot.id)).where(Lot.purchase_id == p.id)
        ).one()
        result.append(
            AdminPurchaseRead(
                id=p.id,
                user_email=user.email if user else "unknown",
                auto_number=p.auto_number,
                full_name=p.full_name,
                custom_name=p.custom_name,
                status=p.status,
                lots_count=lots_count,
                created_at=p.created_at,
            )
        )
    return result
