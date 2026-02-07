"""
RBAC Permission System for ARTISAN Admin
==========================================
Roles: super_admin, staff, finance, support
"""

from fastapi import Depends, HTTPException, status
from typing import List, Optional
from auth import get_current_user
import database as db_module
from bson import ObjectId

# Permission matrix: role -> list of permissions
ROLE_PERMISSIONS = {
    "super_admin": [
        "artisan.create", "artisan.read", "artisan.update", "artisan.verify", "artisan.manage_status",
        "user.read", "user.create", "user.manage_role",
        "mission.read", "mission.intervene",
        "finance.read", "finance.export",
        "credits.read", "credits.adjust",
        "support.read", "support.manage", "support.resolve",
        "notification.read", "notification.manage", "notification.campaign",
        "audit.read",
    ],
    "staff": [
        "artisan.create", "artisan.read", "artisan.update", "artisan.verify", "artisan.manage_status",
        "user.read",
        "mission.read", "mission.intervene",
        "credits.read",
        "support.read",
    ],
    "finance": [
        "mission.read",
        "finance.read", "finance.export",
        "credits.read", "credits.adjust",
        "audit.read",
    ],
    "support": [
        "user.read",
        "mission.read",
        "notification.read",
        "support.read", "support.manage", "support.resolve",
    ],
}

ADMIN_ROLES = list(ROLE_PERMISSIONS.keys())


def get_permissions_for_role(role: str) -> List[str]:
    """Get all permissions for a given role."""
    return ROLE_PERMISSIONS.get(role, [])


def has_permission(role: str, permission: str, custom_permissions: Optional[List[str]] = None) -> bool:
    """Check if a role (plus optional custom permissions) grants a given permission."""
    perms = set(get_permissions_for_role(role))
    if custom_permissions:
        perms.update(custom_permissions)
    return permission in perms


async def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: get the full admin user document. Raises 403 if not admin."""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user["_id"] = str(user["_id"])
    admin_role = user.get("admin_role")

    if user.get("role") != "admin" or not admin_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    if admin_role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Unknown admin role: {admin_role}",
        )

    return user


def require_permission(permission: str):
    """FastAPI dependency factory: require a specific permission.

    Usage:
        @router.get("/something", dependencies=[Depends(require_permission("artisan.read"))])
    or:
        async def endpoint(admin: dict = Depends(require_permission("artisan.read"))):
    """

    async def _check(admin: dict = Depends(get_admin_user)) -> dict:
        role = admin.get("admin_role", "")
        custom = admin.get("permissions", [])
        if not has_permission(role, permission, custom):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission} required",
            )
        return admin

    return _check

