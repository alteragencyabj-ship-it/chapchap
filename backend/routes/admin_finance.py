"""
Admin Finance Routes
=====================
Revenue dashboards, transaction lists, payment tracking, anomaly detection.
"""

from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import datetime, timedelta

import database as db_module
from permissions import require_permission

router = APIRouter(prefix="/api/admin/finance", tags=["admin-finance"])


@router.get("/dashboard")
async def finance_dashboard(
    period: str = Query("month", pattern="^(week|month|quarter|year)$"),
    admin: dict = Depends(require_permission("finance.read")),
):
    """Get financial overview: revenue, commissions, balances."""
    now = datetime.utcnow()
    period_map = {
        "week": timedelta(days=7),
        "month": timedelta(days=30),
        "quarter": timedelta(days=90),
        "year": timedelta(days=365),
    }
    since = now - period_map[period]

    # Total commission earned in period
    pipeline_commission = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {
            "_id": None,
            "total_commission": {"$sum": "$commission"},
            "total_revenue": {"$sum": "$amount"},
            "total_artisan_earnings": {"$sum": "$artisan_earning"},
            "count": {"$sum": 1},
        }},
    ]
    tx_stats = await db_module.db.mission_transactions.aggregate(pipeline_commission).to_list(1)
    tx = tx_stats[0] if tx_stats else {"total_commission": 0, "total_revenue": 0, "total_artisan_earnings": 0, "count": 0}

    # Total commission payments received in period
    pipeline_payments = [
        {"$match": {"created_at": {"$gte": since}, "status": "completed"}},
        {"$group": {
            "_id": None,
            "total_paid": {"$sum": "$amount"},
            "count": {"$sum": 1},
        }},
    ]
    pay_stats = await db_module.db.commission_payments.aggregate(pipeline_payments).to_list(1)
    pay = pay_stats[0] if pay_stats else {"total_paid": 0, "count": 0}

    # Outstanding commission
    pipeline_outstanding = [
        {"$group": {
            "_id": None,
            "total_outstanding": {"$sum": "$commission_due"},
            "blocked_count": {"$sum": {"$cond": ["$is_blocked", 1, 0]}},
        }},
    ]
    out_stats = await db_module.db.artisan_credits.aggregate(pipeline_outstanding).to_list(1)
    outstanding = out_stats[0] if out_stats else {"total_outstanding": 0, "blocked_count": 0}

    return {
        "period": period,
        "since": since.isoformat(),
        "revenue": {
            "total_service_value": tx.get("total_revenue", 0),
            "total_commission_earned": tx.get("total_commission", 0),
            "total_artisan_earnings": tx.get("total_artisan_earnings", 0),
            "missions_completed": tx.get("count", 0),
        },
        "payments": {
            "total_commission_received": pay.get("total_paid", 0),
            "payment_count": pay.get("count", 0),
        },
        "outstanding": {
            "total_commission_due": outstanding.get("total_outstanding", 0),
            "blocked_artisans": outstanding.get("blocked_count", 0),
        },
    }


@router.get("/transactions")
async def list_transactions(
    artisan_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_permission("finance.read")),
):
    """List all mission transactions with filters."""
    query = {}
    if artisan_id:
        query["artisan_id"] = artisan_id
    if date_from:
        query.setdefault("created_at", {})["$gte"] = datetime.fromisoformat(date_from)
    if date_to:
        query.setdefault("created_at", {})["$lte"] = datetime.fromisoformat(date_to)

    skip = (page - 1) * limit
    results = []
    async for tx in db_module.db.mission_transactions.find(query).sort("created_at", -1).skip(skip).limit(limit):
        tx["_id"] = str(tx["_id"])
        results.append(tx)

    total = await db_module.db.mission_transactions.count_documents(query)
    return {"transactions": results, "total": total, "page": page}


@router.get("/payments")
async def list_payments(
    artisan_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_permission("finance.read")),
):
    """List all commission payments."""
    query = {}
    if artisan_id:
        query["artisan_id"] = artisan_id
    if status:
        query["status"] = status

    skip = (page - 1) * limit
    results = []
    async for p in db_module.db.commission_payments.find(query).sort("created_at", -1).skip(skip).limit(limit):
        p["_id"] = str(p["_id"])
        results.append(p)

    total = await db_module.db.commission_payments.count_documents(query)
    return {"payments": results, "total": total, "page": page}


@router.get("/anomalies")
async def get_anomalies(
    admin: dict = Depends(require_permission("finance.read")),
):
    """Detect financial anomalies: overdue payments, high commission, etc."""
    anomalies = []

    # Artisans blocked for > 7 days
    week_ago = datetime.utcnow() - timedelta(days=7)
    async for credit in db_module.db.artisan_credits.find({
        "is_blocked": True,
        "blocked_at": {"$lte": week_ago},
    }):
        artisan = await db_module.db.users.find_one({"_id": credit["artisan_id"]}) if isinstance(credit["artisan_id"], str) else None
        anomalies.append({
            "type": "overdue_blocked",
            "artisan_id": credit["artisan_id"],
            "artisan_name": artisan.get("name", "?") if artisan else "?",
            "commission_due": credit.get("commission_due", 0),
            "blocked_since": credit.get("blocked_at"),
        })

    # Very high commission due (> 50k FCFA)
    async for credit in db_module.db.artisan_credits.find({
        "commission_due": {"$gte": 50000},
    }):
        artisan = await db_module.db.users.find_one({"_id": credit["artisan_id"]}) if isinstance(credit["artisan_id"], str) else None
        anomalies.append({
            "type": "high_commission_due",
            "artisan_id": credit["artisan_id"],
            "artisan_name": artisan.get("name", "?") if artisan else "?",
            "commission_due": credit.get("commission_due", 0),
        })

    return {"anomalies": anomalies, "count": len(anomalies)}
