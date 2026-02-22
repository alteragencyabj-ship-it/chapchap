"""
Notification Service -- Multi-channel notification pipeline
=============================================================
Pipeline: build notification -> check preferences -> anti-spam -> persist -> deliver
Channels: in_app, push (Expo), email (future)
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from bson import ObjectId
import httpx

import database as db_module
from socketio_server import sio, connected_users

logger = logging.getLogger(__name__)

# Anti-spam: max notifications per user per minute
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 10

# In-memory rate limiter (per user)
_rate_tracker: Dict[str, List[datetime]] = {}


async def send_notification(
    recipient_id: str,
    notif_type: str,
    data: Optional[Dict[str, Any]] = None,
    template_vars: Optional[Dict[str, Any]] = None,
    channels: Optional[List[str]] = None,
) -> Optional[str]:
    """Build, check, persist, and deliver a notification.

    Returns the notification _id string, or None if suppressed.
    """
    if not recipient_id:
        return None

    # 1. Get template
    template = await db_module.db.notification_templates.find_one({"key": notif_type})
    if template:
        title = _render(template["title_template"], template_vars or {})
        body = _render(template["body_template"], template_vars or {})
        channels = channels or template.get("channels", ["in_app", "push"])
    else:
        # Fallback: use type as title
        title = notif_type.replace("_", " ").title()
        body = _render("{details}", {"details": str(template_vars or "")})
        channels = channels or ["in_app", "push"]

    # 2. Check user preferences
    user = await db_module.db.users.find_one({"_id": ObjectId(recipient_id)})
    if not user:
        return None

    prefs = user.get("notification_preferences") or {}
    disabled_types = prefs.get("disabled_types", [])
    if notif_type in disabled_types:
        return None

    # Quiet hours check
    quiet_start = prefs.get("quiet_hours_start")
    quiet_end = prefs.get("quiet_hours_end")
    if quiet_start is not None and quiet_end is not None:
        current_hour = datetime.utcnow().hour
        if quiet_start <= current_hour < quiet_end:
            # Still persist in-app, just skip push
            channels = [c for c in channels if c != "push"]

    # 3. Anti-spam rate limit
    if _is_rate_limited(recipient_id):
        logger.warning(f"Rate limited notifications for user {recipient_id}")
        return None

    # 4. Persist to DB
    notif_doc = {
        "recipient_id": recipient_id,
        "type": notif_type,
        "title": title,
        "body": body,
        "data": data or {},
        "read": False,
        "channels": channels,
        "created_at": datetime.utcnow(),
    }
    result = await db_module.db.notifications.insert_one(notif_doc)
    notif_id = str(result.inserted_id)
    notif_doc["_id"] = notif_id

    # 5. Deliver
    if "in_app" in channels:
        await _deliver_in_app(recipient_id, notif_doc)

    if "push" in channels:
        push_token = user.get("push_token")
        if push_token and prefs.get("push_enabled", True):
            await _deliver_push(push_token, title, body, data)

    return notif_id


def _render(template: str, vars: Dict[str, Any]) -> str:
    """Simple {var} template rendering."""
    try:
        return template.format(**vars)
    except (KeyError, IndexError):
        return template


def _is_rate_limited(user_id: str) -> bool:
    """Check if user has exceeded notification rate limit."""
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=RATE_LIMIT_WINDOW)

    if user_id not in _rate_tracker:
        _rate_tracker[user_id] = []

    # Clean old entries
    _rate_tracker[user_id] = [t for t in _rate_tracker[user_id] if t > cutoff]

    if len(_rate_tracker[user_id]) >= RATE_LIMIT_MAX:
        return True

    _rate_tracker[user_id].append(now)
    return False


async def _deliver_in_app(recipient_id: str, notif_doc: Dict) -> None:
    """Push notification via Socket.IO to connected user."""
    if recipient_id in connected_users:
        payload = {
            "_id": notif_doc["_id"],
            "type": notif_doc["type"],
            "title": notif_doc["title"],
            "body": notif_doc["body"],
            "data": notif_doc.get("data", {}),
            "created_at": notif_doc["created_at"].isoformat() if isinstance(notif_doc["created_at"], datetime) else notif_doc["created_at"],
        }
        for sid in connected_users[recipient_id]:
            try:
                await sio.emit("notification", payload, to=sid)
            except Exception:
                logger.exception(f"Failed to emit notification to {sid}")


async def _deliver_push(token: str, title: str, body: str, data: Optional[Dict] = None) -> None:
    """Send push notification via Expo Push API."""
    message = {
        "to": token,
        "title": title,
        "body": body,
        "sound": "default",
        "data": data or {},
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://exp.host/--/api/v2/push/send",
                json=message,
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code != 200:
                logger.error(f"Expo push failed: {resp.status_code} {resp.text}")
    except Exception:
        logger.exception("Failed to send Expo push notification")


async def seed_notification_templates() -> None:
    """Seed default notification templates if they don't exist."""
    templates = [
        # === V2 State Machine: New notification types ===

        # Client notifications -- Quote flow
        {
            "key": "quote_received",
            "title_template": "Devis recu",
            "body_template": "{artisan_name} a envoye un devis de {amount} FCFA",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "quote_accepted",
            "title_template": "Devis accepte",
            "body_template": "{client_name} a accepte votre devis",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "payment_prompt",
            "title_template": "Paiement requis",
            "body_template": "Procedez au paiement pour confirmer votre reservation.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "payment_confirmed",
            "title_template": "Paiement confirme",
            "body_template": "Paiement recu. {artisan_name} sera bientot en route.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "escrow_confirmed",
            "title_template": "Paiement securise",
            "body_template": "Le paiement du client est securise. Confirmez votre depart.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "artisan_en_route",
            "title_template": "Artisan en route",
            "body_template": "{artisan_name} est en route vers vous.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },

        # Client notifications -- Legacy compatible
        {
            "key": "request_accepted",
            "title_template": "Demande acceptee",
            "body_template": "{artisan_name} a accepte votre demande",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "request_refused",
            "title_template": "Demande refusee",
            "body_template": "{artisan_name} a refuse votre demande",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "work_started",
            "title_template": "Travail commence",
            "body_template": "{artisan_name} a commence l'intervention",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "work_completed",
            "title_template": "Travail termine",
            "body_template": "Travail termine ! Validez si tout est en ordre.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "validate_reminder",
            "title_template": "Validation en attente",
            "body_template": "N'oubliez pas de valider le travail de l'artisan.",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "confirm_reminder",
            "title_template": "Confirmation en attente",
            "body_template": "N'oubliez pas de confirmer que le travail est satisfaisant.",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "mission_validated",
            "title_template": "Mission validee",
            "body_template": "La mission a ete validee. Merci !",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "rating_prompt",
            "title_template": "Votre avis compte",
            "body_template": "Notez votre artisan pour finaliser l'experience.",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "new_message",
            "title_template": "Nouveau message",
            "body_template": "{sender_name}: {preview}",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },

        # Artisan notifications
        {
            "key": "request_new",
            "title_template": "Nouvelle demande",
            "body_template": "Nouvelle demande de {client_name} pour {service_type}",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "mission_confirmed",
            "title_template": "Mission confirmee",
            "body_template": "Mission confirmee ! +{earning} FCFA",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "credit_low",
            "title_template": "Credits faibles",
            "body_template": "Il vous reste {n} credit(s)",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "account_blocked",
            "title_template": "Compte bloque",
            "body_template": "Compte bloque. Reglez {amount} FCFA pour continuer.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "request_no_response",
            "title_template": "Demande en attente",
            "body_template": "Une demande est en attente depuis 2h",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },

        # Cancellation & Expiration
        {
            "key": "request_cancelled",
            "title_template": "Demande annulee",
            "body_template": "La demande a ete annulee par le {by}",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },
        {
            "key": "request_expired",
            "title_template": "Demande expiree",
            "body_template": "La demande a expire : {reason}",
            "channels": ["in_app", "push"],
            "priority": "normal",
        },

        # Dispute notifications
        {
            "key": "dispute_new",
            "title_template": "Nouveau litige",
            "body_template": "Litige ouvert sur mission #{id}.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
        {
            "key": "dispute_opened",
            "title_template": "Litige ouvert",
            "body_template": "Un litige est en cours. Ouvrez Assistance pour la suite.",
            "channels": ["in_app", "push"],
            "priority": "high",
        },

        # Admin / System
        {
            "key": "anomaly_detected",
            "title_template": "Anomalie detectee",
            "body_template": "Anomalie financiere detectee",
            "channels": ["in_app", "push"],
            "priority": "high",
        },
    ]

    for tmpl in templates:
        await db_module.db.notification_templates.update_one(
            {"key": tmpl["key"]},
            {"$setOnInsert": tmpl},
            upsert=True,
        )

    logger.info(f"Seeded {len(templates)} notification templates")
