"""
Service Request State Machine for ARTISAN
============================================
Manages transitions: PUBLISHED -> ACCEPTED -> IN_PROGRESS -> COMPLETED -> CONFIRMED
Also: REFUSED, CANCELLED, DISPUTED, RESOLVED

Each transition:
1. Validates the permission (who can trigger)
2. Updates status + status_history
3. Emits an event via the event bus
"""

from datetime import datetime
from typing import Dict, Any, Optional
from bson import ObjectId
from fastapi import HTTPException

import database as db_module
from events import emit
from models import RequestStatus

# Valid transitions: current_status -> {allowed_new_status: required_role}
TRANSITIONS = {
    RequestStatus.PUBLISHED: {
        RequestStatus.ACCEPTED: "artisan",
        RequestStatus.REFUSED: "artisan",
        RequestStatus.CANCELLED: "any",  # client or admin
    },
    RequestStatus.ACCEPTED: {
        RequestStatus.IN_PROGRESS: "artisan",
        RequestStatus.CANCELLED: "any",
        RequestStatus.DISPUTED: "any",
    },
    RequestStatus.IN_PROGRESS: {
        RequestStatus.COMPLETED: "artisan",
        RequestStatus.CANCELLED: "any",
        RequestStatus.DISPUTED: "any",
    },
    RequestStatus.COMPLETED: {
        RequestStatus.CONFIRMED: "client",
        RequestStatus.DISPUTED: "any",
    },
    RequestStatus.DISPUTED: {
        RequestStatus.RESOLVED: "admin",
    },
}

# Events emitted per transition
TRANSITION_EVENTS = {
    RequestStatus.ACCEPTED: "request.accepted",
    RequestStatus.REFUSED: "request.refused",
    RequestStatus.IN_PROGRESS: "request.started",
    RequestStatus.COMPLETED: "request.completed",
    RequestStatus.CONFIRMED: "request.confirmed",
    RequestStatus.CANCELLED: "request.cancelled",
    RequestStatus.DISPUTED: "request.disputed",
    RequestStatus.RESOLVED: "request.resolved",
}


async def transition(
    request_id: str,
    new_status: RequestStatus,
    actor_id: str,
    actor_role: str,
    reason: Optional[str] = None,
    admin_note: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute a state transition on a service request.

    Returns the updated request document.
    Raises HTTPException on invalid transition or permission.
    """
    request = await db_module.db.service_requests.find_one({"_id": ObjectId(request_id)})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    current_status = request["status"]

    # Validate transition is allowed
    allowed = TRANSITIONS.get(RequestStatus(current_status), {})
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{current_status}' to '{new_status.value}'",
        )

    # Validate actor permission
    required_role = allowed[new_status]
    if required_role != "any":
        if required_role == "client" and request.get("client_id") != actor_id:
            raise HTTPException(status_code=403, detail="Only the client can perform this action")
        if required_role == "artisan":
            artisan_id = request.get("assigned_artisan_id") or request.get("artisan_id")
            if artisan_id != actor_id:
                raise HTTPException(status_code=403, detail="Only the assigned artisan can perform this action")
        if required_role == "admin" and actor_role != "admin":
            raise HTTPException(status_code=403, detail="Only admin can perform this action")

    # Build update
    now = datetime.utcnow()
    update_set: Dict[str, Any] = {"status": new_status.value}
    history_entry = {
        "from": current_status,
        "to": new_status.value,
        "actor_id": actor_id,
        "timestamp": now,
        "reason": reason,
    }

    # Status-specific timestamp fields
    ts_map = {
        RequestStatus.ACCEPTED: "accepted_at",
        RequestStatus.IN_PROGRESS: "started_at",
        RequestStatus.COMPLETED: "completed_at",
        RequestStatus.CONFIRMED: "confirmed_at",
        RequestStatus.CANCELLED: "cancelled_at",
    }
    if new_status in ts_map:
        update_set[ts_map[new_status]] = now

    if new_status == RequestStatus.ACCEPTED:
        update_set["assigned_artisan_id"] = actor_id

    if reason:
        if new_status == RequestStatus.CANCELLED:
            update_set["cancel_reason"] = reason
        elif new_status == RequestStatus.REFUSED:
            update_set["refuse_reason"] = reason

    if admin_note:
        update_set["admin_note"] = admin_note

    # Execute update
    await db_module.db.service_requests.update_one(
        {"_id": ObjectId(request_id)},
        {
            "$set": update_set,
            "$push": {"status_history": history_entry},
        },
    )

    # Emit event
    event_name = TRANSITION_EVENTS.get(new_status)
    if event_name:
        event_data = {
            "request_id": request_id,
            "request": request,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "client_id": request.get("client_id"),
            "artisan_id": request.get("assigned_artisan_id") or request.get("artisan_id") or actor_id,
            "reason": reason,
            "service_type": request.get("service_type"),
            "service_name": request.get("service_name"),
            "budget": request.get("budget"),
            "service_price": request.get("service_price"),
        }
        if extra_data:
            event_data.update(extra_data)
        await emit(event_name, **event_data)

    # Fetch and return updated doc
    updated = await db_module.db.service_requests.find_one({"_id": ObjectId(request_id)})
    updated["_id"] = str(updated["_id"])
    return updated

