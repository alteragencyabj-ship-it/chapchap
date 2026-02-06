"""
Admin User Routes
==================
Manage users and admin roles. Audit log access.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime
from bson import ObjectId
import bcrypt

import database as db_module
from permissions import require_permission, ADMIN_ROLES
from audit import log_action
from auth import create_access_token

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


@router.get("/users")
async def list_users(
    role: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_permission("user.read")),
):
    """List users with optional filters."""
    query = {}
    if role:
        query["role"] = role
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
        ]

    skip = (page - 1) * limit
    users = []
    async for u in db_module.db.users.find(query).sort("created_at", -1).skip(skip).limit(limit):
        u["_id"] = str(u["_id"])
        u.pop("password_hash", None)  # Never expose
        users.append(u)

    total = await db_module.db.users.count_documents(query)
    return {"users": users, "total": total, "page": page}


@router.post("/users")
async def create_admin_user(
    body: dict,
    request: Request,
    admin: dict = Depends(require_permission("user.create")),
):
    """Create an admin/staff account."""
    required = ["name", "email", "password", "admin_role"]
    for field in required:
        if field not in body:
            raise HTTPException(status_code=400, detail=f"Missing field: {field}")

    if body["admin_role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid admin role. Choose from: {ADMIN_ROLES}")

    existing = await db_module.db.users.find_one({"email": body["email"]})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed = bcrypt.hashpw(body["password"].encode(), bcrypt.gensalt())

    user_doc = {
        "name": body["name"],
        "email": body["email"],
        "phone": body.get("phone", ""),
        "role": "admin",
        "admin_role": body["admin_role"],
        "permissions": body.get("permissions", []),
        "password_hash": hashed.decode(),
        "is_active": True,
        "status": "active",
        "created_at": datetime.utcnow(),
    }

    result = await db_module.db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="user.create",
        resource_type="user",
        resource_id=user_id,
        changes={"name": body["name"], "email": body["email"], "admin_role": body["admin_role"]},
        ip_address=request.client.host if request.client else None,
    )

    user_doc["_id"] = user_id
    user_doc.pop("password_hash")
    return user_doc


@router.put("/users/{user_id}/role")
async def change_role(
    user_id: str,
    body: dict,
    request: Request,
    admin: dict = Depends(require_permission("user.manage_role")),
):
    """Change user role (super_admin only)."""
    # Only super_admin can change roles
    if admin.get("admin_role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can change roles")

    new_role = body.get("admin_role")
    new_permissions = body.get("permissions")

    if new_role and new_role not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {ADMIN_ROLES}")

    user = await db_module.db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = user.get("admin_role")
    update_set = {}
    if new_role:
        update_set["admin_role"] = new_role
    if new_permissions is not None:
        update_set["permissions"] = new_permissions

    if not update_set:
        raise HTTPException(status_code=400, detail="No changes provided")

    await db_module.db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": update_set},
    )

    await log_action(
        actor_id=admin["_id"],
        actor_email=admin["email"],
        action="user.role_change",
        resource_type="user",
        resource_id=user_id,
        changes={"old_role": old_role, "new_role": new_role, "permissions": new_permissions},
        ip_address=request.client.host if request.client else None,
    )

    return {"message": f"Role updated to {new_role}", "user_id": user_id}


@router.get("/audit-log")
async def get_audit_log(
    actor_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    action: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_permission("audit.read")),
):
    """Browse audit log entries."""
    query = {}
    if actor_id:
        query["actor_id"] = actor_id
    if resource_type:
        query["resource_type"] = resource_type
    if action:
        query["action"] = action

    skip = (page - 1) * limit
    entries = []
    async for entry in db_module.db.audit_log.find(query).sort("timestamp", -1).skip(skip).limit(limit):
        entry["_id"] = str(entry["_id"])
        entries.append(entry)

    total = await db_module.db.audit_log.count_documents(query)
    return {"entries": entries, "total": total, "page": page}
