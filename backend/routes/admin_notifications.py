"""
Admin Notification Routes
==========================
Manage notification templates and campaigns.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime
from bson import ObjectId

import database as db_module
from permissions import require_permission
from audit import log_action
from models import NotificationTemplateCreate, CampaignCreate
from notification_service import send_notification

router = APIRouter(prefix="/api/admin/notifications", tags=["admin-notifications"])


# ===== TEMPLATES =====

@router.get("/templates")
async def list_templates(
    admin: dict = Depends(require_permission("notification.read")),
):
    """List all notification templates."""
    templates = []
    async for t in db_module.db.notification_templates.find().sort("key", 1):
        t["_id"] = str(t["_id"])
        templates.append(t)
    return templates


@router.post("/templates")
async def create_template(
    data: NotificationTemplateCreate,
    request: Request,
    admin: dict = Depends(require_permission("notification.manage")),
):
    """Create a new notification template."""
    existing = await db_module.db.notification_templates.find_one({"key": data.key})
    if existing:
        raise HTTPException(status_code=400, detail=f"Template with key '{data.key}' already exists")

    doc = data.dict()
    doc["created_at"] = datetime.utcnow()
    doc["created_by"] = admin["_id"]

    result = await db_module.db.notification_templates.insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="notification.template_create",
        resource_type="notification_template",
        resource_id=doc["_id"],
        changes={"key": data.key},
        ip_address=request.client.host if request.client else None,
    )

    return doc


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str,
    data: dict,
    request: Request,
    admin: dict = Depends(require_permission("notification.manage")),
):
    """Update an existing notification template."""
    allowed_fields = {"title_template", "body_template", "channels", "priority"}
    update_data = {k: v for k, v in data.items() if k in allowed_fields}

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    update_data["updated_at"] = datetime.utcnow()

    result = await db_module.db.notification_templates.update_one(
        {"_id": ObjectId(template_id)},
        {"$set": update_data},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="notification.template_update",
        resource_type="notification_template",
        resource_id=template_id,
        changes=update_data,
        ip_address=request.client.host if request.client else None,
    )

    return {"message": "Template updated"}


# ===== CAMPAIGNS =====

@router.post("/campaigns")
async def create_campaign(
    data: CampaignCreate,
    request: Request,
    admin: dict = Depends(require_permission("notification.campaign")),
):
    """Create a notification campaign."""
    campaign = data.dict()
    campaign["created_by"] = admin["_id"]
    campaign["created_at"] = datetime.utcnow()
    campaign["status"] = "draft"
    campaign["sent_count"] = 0

    result = await db_module.db.admin_campaigns.insert_one(campaign)
    campaign["_id"] = str(result.inserted_id)

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="notification.campaign_create",
        resource_type="admin_campaign",
        resource_id=campaign["_id"],
        changes={"title": data.title, "target": data.target},
        ip_address=request.client.host if request.client else None,
    )

    return campaign


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(
    campaign_id: str,
    request: Request,
    admin: dict = Depends(require_permission("notification.campaign")),
):
    """Send a campaign to all matching users."""
    campaign = await db_module.db.admin_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if campaign.get("status") == "sent":
        raise HTTPException(status_code=400, detail="Campaign already sent")

    # Build user query based on target
    target = campaign.get("target", "all")
    user_query = {}
    if target == "clients":
        user_query["role"] = "client"
    elif target == "artisans":
        user_query["role"] = "artisan"
    elif target == "segment" and campaign.get("segment_filter"):
        user_query = campaign["segment_filter"]
    # "all" = no filter

    sent_count = 0
    async for user in db_module.db.users.find(user_query, {"_id": 1}):
        uid = str(user["_id"])
        await send_notification(
            recipient_id=uid,
            notif_type="campaign",
            data={"campaign_id": campaign_id},
            template_vars={},
            channels=campaign.get("channels", ["push", "in_app"]),
        )
        sent_count += 1

    # Mark campaign as sent
    await db_module.db.admin_campaigns.update_one(
        {"_id": ObjectId(campaign_id)},
        {"$set": {"status": "sent", "sent_at": datetime.utcnow(), "sent_count": sent_count}},
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="notification.campaign_send",
        resource_type="admin_campaign",
        resource_id=campaign_id,
        changes={"sent_count": sent_count, "target": target},
        ip_address=request.client.host if request.client else None,
    )

    return {"message": f"Campaign sent to {sent_count} users", "sent_count": sent_count}


@router.get("/stats")
async def notification_stats(
    admin: dict = Depends(require_permission("notification.read")),
):
    """Basic notification analytics."""
    total = await db_module.db.notifications.count_documents({})
    read = await db_module.db.notifications.count_documents({"read": True})
    unread = total - read

    # Campaigns
    total_campaigns = await db_module.db.admin_campaigns.count_documents({})
    sent_campaigns = await db_module.db.admin_campaigns.count_documents({"status": "sent"})

    return {
        "notifications": {"total": total, "read": read, "unread": unread},
        "read_rate": round(read / total * 100, 1) if total > 0 else 0,
        "campaigns": {"total": total_campaigns, "sent": sent_campaigns},
    }
