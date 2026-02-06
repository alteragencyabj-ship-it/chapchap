"""
Notification Routes (User-facing)
===================================
List, read, preferences, push token registration.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from bson import ObjectId

import database as db_module
from auth import get_current_user
from models import Notification, NotificationPreferences, RegisterTokenRequest

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


async def _get_user(current_user: dict) -> dict:
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return user


@router.get("", response_model=List[Notification])
async def list_notifications(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Get paginated notifications for the current user."""
    user = await _get_user(current_user)
    skip = (page - 1) * limit

    results = []
    async for n in db_module.db.notifications.find(
        {"recipient_id": user["_id"]}
    ).sort("created_at", -1).skip(skip).limit(limit):
        n["_id"] = str(n["_id"])
        results.append(Notification(**n))
    return results


@router.get("/unread-count")
async def unread_count(current_user: dict = Depends(get_current_user)):
    """Get unread notification count for badge display."""
    user = await _get_user(current_user)
    count = await db_module.db.notifications.count_documents(
        {"recipient_id": user["_id"], "read": False}
    )
    return {"unread": count}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark a single notification as read."""
    user = await _get_user(current_user)
    result = await db_module.db.notifications.update_one(
        {"_id": ObjectId(notification_id), "recipient_id": user["_id"]},
        {"$set": {"read": True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Marked as read"}


@router.post("/read-all")
async def mark_all_read(current_user: dict = Depends(get_current_user)):
    """Mark all notifications as read."""
    user = await _get_user(current_user)
    result = await db_module.db.notifications.update_many(
        {"recipient_id": user["_id"], "read": False},
        {"$set": {"read": True}},
    )
    return {"marked": result.modified_count}


@router.put("/preferences")
async def update_preferences(
    prefs: NotificationPreferences,
    current_user: dict = Depends(get_current_user),
):
    """Update notification preferences."""
    user = await _get_user(current_user)
    await db_module.db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {"notification_preferences": prefs.dict()}},
    )
    return {"message": "Preferences updated"}


@router.post("/register-token")
async def register_push_token(
    body: RegisterTokenRequest,
    current_user: dict = Depends(get_current_user),
):
    """Register an Expo push token for the current user."""
    user = await _get_user(current_user)
    await db_module.db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {"push_token": body.token}},
    )
    return {"message": "Push token registered"}
