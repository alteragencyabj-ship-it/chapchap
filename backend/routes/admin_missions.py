"""
Admin Mission Routes
=====================
Supervision of all missions: list, detail, intervention, stats.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime, timedelta
from bson import ObjectId

import database as db_module
from permissions import require_permission
from audit import log_action
from models import RequestStatus

router = APIRouter(prefix="/api/admin/missions", tags=["admin-missions"])


@router.get("")
async def list_missions(
    status: Optional[str] = None,
    artisan_id: Optional[str] = None,
    client_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_permission("mission.read")),
):
    """List all missions with filters."""
    query = {}
    if status:
        query["status"] = status
    if artisan_id:
        query["$or"] = [{"assigned_artisan_id": artisan_id}, {"artisan_id": artisan_id}]
    if client_id:
        query["client_id"] = client_id
    if date_from:
        query.setdefault("created_at", {})["$gte"] = datetime.fromisoformat(date_from)
    if date_to:
        query.setdefault("created_at", {})["$lte"] = datetime.fromisoformat(date_to)

    skip = (page - 1) * limit
    results = []
    async for req in db_module.db.service_requests.find(query).sort("created_at", -1).skip(skip).limit(limit):
        req["_id"] = str(req["_id"])
        # Enrich with user names
        client = await db_module.db.users.find_one({"_id": ObjectId(req["client_id"])}) if req.get("client_id") else None
        req["client_name"] = client.get("name", "?") if client else "?"

        aid = req.get("assigned_artisan_id") or req.get("artisan_id")
        if aid:
            artisan = await db_module.db.users.find_one({"_id": ObjectId(aid)})
            req["artisan_name"] = artisan.get("name", "?") if artisan else "?"

        results.append(req)

    total = await db_module.db.service_requests.count_documents(query)
    return {"missions": results, "total": total, "page": page}


@router.get("/stats")
async def mission_stats(
    admin: dict = Depends(require_permission("mission.read")),
):
    """Get mission statistics: counts by status, completion rate, average times."""
    # Counts by status
    pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    status_counts = {}
    async for doc in db_module.db.service_requests.aggregate(pipeline):
        status_counts[doc["_id"]] = doc["count"]

    total = sum(status_counts.values())
    confirmed = status_counts.get("confirmed", 0)
    completed = status_counts.get("completed", 0)
    completion_rate = (confirmed + completed) / total * 100 if total > 0 else 0

    # Average time to accept (accepted_at - created_at)
    pipeline_time = [
        {"$match": {"accepted_at": {"$exists": True}}},
        {"$project": {"duration": {"$subtract": ["$accepted_at", "$created_at"]}}},
        {"$group": {"_id": None, "avg_ms": {"$avg": "$duration"}}},
    ]
    time_stats = await db_module.db.service_requests.aggregate(pipeline_time).to_list(1)
    avg_accept_hours = time_stats[0]["avg_ms"] / 3600000 if time_stats and time_stats[0].get("avg_ms") else None

    return {
        "by_status": status_counts,
        "total": total,
        "completion_rate": round(completion_rate, 1),
        "avg_accept_time_hours": round(avg_accept_hours, 1) if avg_accept_hours else None,
    }


@router.get("/{mission_id}")
async def get_mission_detail(
    mission_id: str,
    admin: dict = Depends(require_permission("mission.read")),
):
    """Get complete mission detail including conversation and messages."""
    req = await db_module.db.service_requests.find_one({"_id": ObjectId(mission_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Mission not found")
    req["_id"] = str(req["_id"])

    # Client info
    client = await db_module.db.users.find_one({"_id": ObjectId(req["client_id"])}) if req.get("client_id") else None
    if client:
        client["_id"] = str(client["_id"])
        req["client"] = {"_id": client["_id"], "name": client.get("name"), "phone": client.get("phone"), "email": client.get("email")}

    # Artisan info
    aid = req.get("assigned_artisan_id") or req.get("artisan_id")
    if aid:
        artisan = await db_module.db.users.find_one({"_id": ObjectId(aid)})
        if artisan:
            artisan["_id"] = str(artisan["_id"])
            req["artisan"] = {"_id": artisan["_id"], "name": artisan.get("name"), "phone": artisan.get("phone"), "email": artisan.get("email")}

    # Conversation
    conv = await db_module.db.conversations.find_one({"request_id": mission_id})
    if conv:
        conv["_id"] = str(conv["_id"])
        # Last 20 messages
        messages = []
        async for msg in db_module.db.messages.find({"conversation_id": str(conv["_id"])}).sort("timestamp", -1).limit(20):
            msg["_id"] = str(msg["_id"])
            messages.append(msg)
        messages.reverse()
        req["conversation"] = conv
        req["messages"] = messages

    # Dispute if any
    dispute = await db_module.db.disputes.find_one({"request_id": mission_id})
    if dispute:
        dispute["_id"] = str(dispute["_id"])
        req["dispute"] = dispute

    return req


@router.post("/{mission_id}/intervene")
async def intervene_mission(
    mission_id: str,
    body: dict,
    request: Request,
    admin: dict = Depends(require_permission("mission.intervene")),
):
    """Admin forces a status change on a mission."""
    new_status = body.get("status")
    note = body.get("note", "")

    if not new_status:
        raise HTTPException(status_code=400, detail="status is required")

    req = await db_module.db.service_requests.find_one({"_id": ObjectId(mission_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Mission not found")

    old_status = req["status"]
    now = datetime.utcnow()

    await db_module.db.service_requests.update_one(
        {"_id": ObjectId(mission_id)},
        {
            "$set": {"status": new_status, "admin_note": note},
            "$push": {"status_history": {
                "from": old_status,
                "to": new_status,
                "actor_id": admin["_id"],
                "timestamp": now,
                "reason": f"Admin intervention: {note}",
            }},
        },
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="mission.intervene",
        resource_type="service_request",
        resource_id=mission_id,
        changes={"old_status": old_status, "new_status": new_status, "note": note},
        ip_address=request.client.host if request.client else None,
    )

    return {"message": f"Mission status changed from {old_status} to {new_status}", "note": note}
