"""
Service Request Routes -- Moteur Metier
========================================
Handles the full lifecycle: create -> accept/refuse -> start -> complete -> confirm
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from datetime import datetime
from bson import ObjectId

import database as db_module
from auth import get_current_user
from models import (
    ServiceRequest, ServiceRequestCreate,
    RequestRefuse, RequestCancel, RequestDispute, RequestStatus,
)
from state_machine import transition
import credit_system

router = APIRouter(prefix="/api/requests", tags=["requests"])


async def _get_user(current_user: dict) -> dict:
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return user


@router.post("", response_model=ServiceRequest)
async def create_request(
    data: ServiceRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new service request (client -> specific artisan)."""
    user = await _get_user(current_user)

    req = data.dict()
    req["client_id"] = user["_id"]
    req["status"] = RequestStatus.PUBLISHED.value
    req["status_history"] = [
        {"from": None, "to": "published", "actor_id": user["_id"], "timestamp": datetime.utcnow()}
    ]
    req["created_at"] = datetime.utcnow()

    # If targeting a specific artisan, set assigned_artisan_id
    if data.artisan_id:
        artisan = await db_module.db.users.find_one({"_id": ObjectId(data.artisan_id), "role": "artisan"})
        if not artisan:
            raise HTTPException(status_code=404, detail="Artisan not found")
        req["assigned_artisan_id"] = data.artisan_id

    result = await db_module.db.service_requests.insert_one(req)
    req["_id"] = str(result.inserted_id)

    # Emit event for notification
    from events import emit
    await emit("request.created", request_id=str(result.inserted_id), client_id=user["_id"],
               artisan_id=data.artisan_id, service_type=data.service_type)

    return ServiceRequest(**req)


@router.get("", response_model=List[ServiceRequest])
async def list_requests(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Get requests for the current user (client: sent, artisan: received)."""
    user = await _get_user(current_user)
    uid = user["_id"]

    query = {}
    if user["role"] == "client":
        query["client_id"] = uid
    elif user["role"] == "artisan":
        query["$or"] = [
            {"assigned_artisan_id": uid},
            {"artisan_id": uid},
        ]
    else:
        pass  # admin sees all (no filter)

    if status:
        query["status"] = status

    skip = (page - 1) * limit
    results = []
    async for req in db_module.db.service_requests.find(query).sort("created_at", -1).skip(skip).limit(limit):
        req["_id"] = str(req["_id"])
        results.append(ServiceRequest(**req))
    return results


@router.get("/{request_id}", response_model=ServiceRequest)
async def get_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single request. Must be participant or admin."""
    user = await _get_user(current_user)
    req = await db_module.db.service_requests.find_one({"_id": ObjectId(request_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    uid = user["_id"]
    is_participant = uid in [req.get("client_id"), req.get("assigned_artisan_id"), req.get("artisan_id")]
    if not is_participant and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to view this request")

    req["_id"] = str(req["_id"])
    return ServiceRequest(**req)


@router.post("/{request_id}/accept")
async def accept_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Artisan accepts a request."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can accept requests")

    # Check credit
    can = await credit_system.check_can_accept_mission(user["_id"])
    if not can["can_accept"]:
        raise HTTPException(status_code=403, detail=can.get("reason", "Cannot accept missions"))

    updated = await transition(request_id, RequestStatus.ACCEPTED, user["_id"], user["role"])
    return updated


@router.post("/{request_id}/refuse")
async def refuse_request(
    request_id: str,
    body: RequestRefuse = None,
    current_user: dict = Depends(get_current_user),
):
    """Artisan refuses a request."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can refuse requests")

    reason = body.reason if body else None
    updated = await transition(request_id, RequestStatus.REFUSED, user["_id"], user["role"], reason=reason)
    return updated


@router.post("/{request_id}/start")
async def start_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Artisan starts work on the request."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can start work")

    updated = await transition(request_id, RequestStatus.IN_PROGRESS, user["_id"], user["role"])
    return updated


@router.post("/{request_id}/complete")
async def complete_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Artisan declares work completed."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can mark complete")

    updated = await transition(request_id, RequestStatus.COMPLETED, user["_id"], user["role"])
    return updated


@router.post("/{request_id}/confirm")
async def confirm_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Client confirms work is satisfactory -> triggers credit consumption."""
    user = await _get_user(current_user)
    if user["role"] != "client":
        raise HTTPException(status_code=403, detail="Only clients can confirm")

    updated = await transition(request_id, RequestStatus.CONFIRMED, user["_id"], user["role"])
    return updated


@router.post("/{request_id}/cancel")
async def cancel_request(
    request_id: str,
    body: RequestCancel = None,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a request (client or artisan depending on state)."""
    user = await _get_user(current_user)
    reason = body.reason if body else None
    updated = await transition(request_id, RequestStatus.CANCELLED, user["_id"], user["role"], reason=reason)
    return updated


@router.post("/{request_id}/dispute")
async def dispute_request(
    request_id: str,
    body: RequestDispute,
    current_user: dict = Depends(get_current_user),
):
    """Open a dispute on a request."""
    user = await _get_user(current_user)

    # Create dispute record
    dispute_doc = {
        "request_id": request_id,
        "opened_by": user["_id"],
        "reason": body.reason,
        "category": body.category,
        "status": "open",
        "messages": [{
            "sender_id": user["_id"],
            "message": body.reason,
            "timestamp": datetime.utcnow(),
            "is_admin": False,
        }],
        "created_at": datetime.utcnow(),
    }
    await db_module.db.disputes.insert_one(dispute_doc)

    updated = await transition(request_id, RequestStatus.DISPUTED, user["_id"], user["role"], reason=body.reason)
    return updated
