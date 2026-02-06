"""
Audit Log Helper for ChapChap Admin
=====================================
Logs admin actions to the audit_log collection.
"""

from datetime import datetime
from typing import Any, Dict, Optional
import database as db_module
import logging

logger = logging.getLogger(__name__)


async def log_action(
    actor_id: str,
    actor_email: str,
    action: str,
    resource_type: str,
    resource_id: str,
    changes: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Persist an audit entry.

    Parameters
    ----------
    actor_id : ObjectId string of the admin who performed the action.
    actor_email : Email of the admin.
    action : e.g. "artisan.create", "status.change", "credit.adjust"
    resource_type : e.g. "user", "service_request", "dispute"
    resource_id : The _id of the affected resource.
    changes : Before/after or free-form description of what changed.
    ip_address : Client IP (from request.client.host).
    """
    entry = {
        "actor_id": actor_id,
        "actor_email": actor_email,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "changes": changes,
        "ip_address": ip_address,
        "timestamp": datetime.utcnow(),
    }

    try:
        await db_module.db.audit_log.insert_one(entry)
    except Exception:
        logger.exception("Failed to write audit log entry")
