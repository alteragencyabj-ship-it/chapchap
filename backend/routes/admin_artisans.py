"""
Admin Artisan Routes
=====================
Manage artisan accounts: create (onboarding), list, update, status changes, credit adjustments.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime
from bson import ObjectId
import bcrypt

import database as db_module
from permissions import require_permission
from audit import log_action
from models import AdminArtisanCreate, StatusChangeRequest, CreditAdjustment, User
import credit_system

router = APIRouter(prefix="/api/admin/artisans", tags=["admin-artisans"])


@router.post("")
async def create_artisan(
    data: AdminArtisanCreate,
    request: Request,
    admin: dict = Depends(require_permission("artisan.create")),
):
    """Create an artisan account after physical interview (admin onboarding)."""
    # Check if email already exists
    existing = await db_module.db.users.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    artisan_doc = {
        "name": data.name,
        "email": data.email,
        "phone": data.phone,
        "role": "artisan",
        "specialties": data.specialties,
        "experience": data.experience,
        "city": data.city,
        "quartier": data.quartier,
        "address": data.address,
        "zone": data.zone,
        "id_document": data.id_document,
        "photo": data.photo,
        "verified": True,  # Admin-created = pre-verified
        "average_rating": 0.0,
        "total_missions": 0,
        "is_active": True,
        "status": "active",
        "onboarded_by": admin["_id"],
        "interview_notes": data.interview_notes,
        "created_at": datetime.utcnow(),
    }

    if data.password:
        hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt())
        artisan_doc["password_hash"] = hashed.decode()

    result = await db_module.db.users.insert_one(artisan_doc)
    artisan_id = str(result.inserted_id)

    # Initialize credit system
    await credit_system.get_or_create_credit(artisan_id)

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="artisan.create",
        resource_type="user",
        resource_id=artisan_id,
        changes={"name": data.name, "email": data.email, "specialties": data.specialties},
        ip_address=request.client.host if request.client else None,
    )

    artisan_doc["_id"] = artisan_id
    return artisan_doc


@router.get("")
async def list_artisans(
    status: Optional[str] = None,
    level: Optional[str] = None,
    verified: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_permission("artisan.read")),
):
    """List artisans with filters."""
    query = {"role": "artisan"}
    if status:
        query["status"] = status
    if verified is not None:
        query["verified"] = verified
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
        ]

    skip = (page - 1) * limit
    artisans = []
    async for a in db_module.db.users.find(query).sort("created_at", -1).skip(skip).limit(limit):
        a["_id"] = str(a["_id"])
        # Attach credit info
        credit = await db_module.db.artisan_credits.find_one({"artisan_id": a["_id"]})
        if credit:
            a["credit_info"] = {
                "level": credit.get("level"),
                "credit_remaining": credit.get("credit_remaining"),
                "commission_due": credit.get("commission_due"),
                "is_blocked": credit.get("is_blocked"),
            }
            # Filter by level if requested
            if level and credit.get("level") != level:
                continue
        artisans.append(a)

    total = await db_module.db.users.count_documents(query)
    return {"artisans": artisans, "total": total, "page": page, "limit": limit}


@router.get("/{artisan_id}")
async def get_artisan(
    artisan_id: str,
    admin: dict = Depends(require_permission("artisan.read")),
):
    """Get full artisan profile with credit info and action history."""
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id), "role": "artisan"})
    if not artisan:
        raise HTTPException(status_code=404, detail="Artisan not found")

    artisan["_id"] = str(artisan["_id"])

    # Attach credit info
    credit = await credit_system.get_credit_status(artisan_id)
    artisan["credit_status"] = credit

    # Recent missions count
    missions = await db_module.db.service_requests.count_documents({
        "$or": [{"assigned_artisan_id": artisan_id}, {"artisan_id": artisan_id}],
        "status": {"$in": ["completed", "confirmed"]},
    })
    artisan["completed_missions"] = missions

    return artisan


@router.put("/{artisan_id}")
async def update_artisan(
    artisan_id: str,
    data: dict,
    request: Request,
    admin: dict = Depends(require_permission("artisan.update")),
):
    """Update artisan profile fields."""
    # Prevent updating sensitive fields
    forbidden = {"_id", "password_hash", "admin_role", "permissions", "role"}
    update_data = {k: v for k, v in data.items() if k not in forbidden}

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    await db_module.db.users.update_one(
        {"_id": ObjectId(artisan_id)},
        {"$set": update_data},
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="artisan.update",
        resource_type="user",
        resource_id=artisan_id,
        changes=update_data,
        ip_address=request.client.host if request.client else None,
    )

    updated = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    updated["_id"] = str(updated["_id"])
    return updated


@router.post("/{artisan_id}/status")
async def change_status(
    artisan_id: str,
    body: StatusChangeRequest,
    request: Request,
    admin: dict = Depends(require_permission("artisan.manage_status")),
):
    """Change artisan status (active/suspended/blocked) with reason."""
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    if not artisan:
        raise HTTPException(status_code=404, detail="Artisan not found")

    old_status = artisan.get("status", "active")

    await db_module.db.users.update_one(
        {"_id": ObjectId(artisan_id)},
        {"$set": {
            "status": body.status,
            "status_reason": body.reason,
            "is_active": body.status == "active",
        }},
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="artisan.status_change",
        resource_type="user",
        resource_id=artisan_id,
        changes={"old_status": old_status, "new_status": body.status, "reason": body.reason},
        ip_address=request.client.host if request.client else None,
    )

    return {"message": f"Artisan status changed to {body.status}", "reason": body.reason}


@router.get("/{artisan_id}/history")
async def get_artisan_history(
    artisan_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    admin: dict = Depends(require_permission("artisan.read")),
):
    """Get audit log entries for a specific artisan."""
    skip = (page - 1) * limit
    entries = []
    async for entry in db_module.db.audit_log.find(
        {"resource_id": artisan_id}
    ).sort("timestamp", -1).skip(skip).limit(limit):
        entry["_id"] = str(entry["_id"])
        entries.append(entry)
    return entries


@router.post("/{artisan_id}/credits/adjust")
async def adjust_credits(
    artisan_id: str,
    body: CreditAdjustment,
    request: Request,
    admin: dict = Depends(require_permission("credits.adjust")),
):
    """Manually adjust artisan credits or commission_due."""
    credit = await credit_system.get_or_create_credit(artisan_id)
    update_set = {}

    if body.credits is not None:
        update_set["credit_remaining"] = body.credits
    if body.commission_due is not None:
        update_set["commission_due"] = body.commission_due
        # Unblock if commission_due drops below threshold
        if body.commission_due < credit_system.BLOCK_THRESHOLD:
            update_set["is_blocked"] = False

    update_set["updated_at"] = datetime.utcnow()

    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {"$set": update_set},
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="credits.adjust",
        resource_type="artisan_credits",
        resource_id=artisan_id,
        changes={"adjustment": body.dict(), "reason": body.reason},
        ip_address=request.client.host if request.client else None,
    )

    return {"message": "Credits adjusted", "changes": update_set}
