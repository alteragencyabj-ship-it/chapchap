"""
Admin Dispute Routes
=====================
View, assign, manage, and resolve disputes.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime
from bson import ObjectId

import database as db_module
from permissions import require_permission
from audit import log_action
from models import DisputeResolve, DisputeMessage

router = APIRouter(prefix="/api/admin/disputes", tags=["admin-disputes"])


@router.get("")
async def list_disputes(
    status: Optional[str] = None,
    category: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    admin: dict = Depends(require_permission("support.read")),
):
    """List disputes with filters."""
    query = {}
    if status:
        query["status"] = status
    if category:
        query["category"] = category

    skip = (page - 1) * limit
    results = []
    async for d in db_module.db.disputes.find(query).sort("created_at", -1).skip(skip).limit(limit):
        d["_id"] = str(d["_id"])
        # Enrich with user name
        opener = await db_module.db.users.find_one({"_id": ObjectId(d["opened_by"])}) if d.get("opened_by") else None
        d["opener_name"] = opener.get("name", "?") if opener else "?"
        results.append(d)

    total = await db_module.db.disputes.count_documents(query)
    return {"disputes": results, "total": total, "page": page}


@router.get("/{dispute_id}")
async def get_dispute(
    dispute_id: str,
    admin: dict = Depends(require_permission("support.read")),
):
    """Get full dispute detail including related request."""
    dispute = await db_module.db.disputes.find_one({"_id": ObjectId(dispute_id)})
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")

    dispute["_id"] = str(dispute["_id"])

    # Get related request
    if dispute.get("request_id"):
        req = await db_module.db.service_requests.find_one({"_id": ObjectId(dispute["request_id"])})
        if req:
            req["_id"] = str(req["_id"])
            dispute["request"] = req

    # Get opener info
    if dispute.get("opened_by"):
        opener = await db_module.db.users.find_one({"_id": ObjectId(dispute["opened_by"])})
        if opener:
            dispute["opener"] = {"name": opener.get("name"), "email": opener.get("email"), "role": opener.get("role")}

    return dispute


@router.put("/{dispute_id}")
async def update_dispute(
    dispute_id: str,
    body: dict,
    request: Request,
    admin: dict = Depends(require_permission("support.manage")),
):
    """Assign admin or change status."""
    update_set = {}
    if "assigned_admin" in body:
        update_set["assigned_admin"] = body["assigned_admin"]
    if "status" in body:
        update_set["status"] = body["status"]

    if not update_set:
        raise HTTPException(status_code=400, detail="Nothing to update")

    await db_module.db.disputes.update_one(
        {"_id": ObjectId(dispute_id)},
        {"$set": update_set},
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="dispute.update",
        resource_type="dispute",
        resource_id=dispute_id,
        changes=update_set,
        ip_address=request.client.host if request.client else None,
    )

    return {"message": "Dispute updated", "changes": update_set}


@router.post("/{dispute_id}/resolve")
async def resolve_dispute(
    dispute_id: str,
    body: DisputeResolve,
    request: Request,
    admin: dict = Depends(require_permission("support.resolve")),
):
    """Resolve a dispute with outcome."""
    dispute = await db_module.db.disputes.find_one({"_id": ObjectId(dispute_id)})
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")

    now = datetime.utcnow()
    await db_module.db.disputes.update_one(
        {"_id": ObjectId(dispute_id)},
        {"$set": {
            "status": "resolved",
            "outcome": body.outcome,
            "resolution_note": body.resolution_note,
            "refund_amount": body.refund_amount,
            "resolved_at": now,
            "resolved_by": admin["_id"],
        }},
    )

    # Also resolve the request status if it's disputed
    if dispute.get("request_id"):
        from state_machine import transition as sm_transition
        from models import RequestStatus
        try:
            await sm_transition(
                dispute["request_id"],
                RequestStatus.RESOLVED,
                admin["_id"],
                "admin",
                reason=body.resolution_note,
            )
        except Exception:
            pass  # Request might not be in disputed state

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="dispute.resolve",
        resource_type="dispute",
        resource_id=dispute_id,
        changes={"outcome": body.outcome, "note": body.resolution_note, "refund": body.refund_amount},
        ip_address=request.client.host if request.client else None,
    )

    # Notify opener
    from notification_service import send_notification
    await send_notification(
        recipient_id=dispute["opened_by"],
        notif_type="dispute_resolved",
        data={"dispute_id": dispute_id, "request_id": dispute.get("request_id")},
        template_vars={"outcome": body.outcome},
    )

    return {"message": "Dispute resolved", "outcome": body.outcome}


@router.post("/{dispute_id}/message")
async def add_message(
    dispute_id: str,
    body: DisputeMessage,
    admin: dict = Depends(require_permission("support.manage")),
):
    """Add an admin message to the dispute thread."""
    now = datetime.utcnow()
    msg = {
        "sender_id": admin["_id"],
        "message": body.message,
        "timestamp": now,
        "is_admin": True,
    }

    await db_module.db.disputes.update_one(
        {"_id": ObjectId(dispute_id)},
        {"$push": {"messages": msg}},
    )

    return {"message": "Message added to dispute"}
