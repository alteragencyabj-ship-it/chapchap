"""
Event Handlers -- Business logic triggered by state machine transitions
========================================================================
Wires together: notifications, conversations, credits, scheduling.
Import this module at startup to register all handlers.
"""

import logging
from datetime import datetime
from bson import ObjectId

import database as db_module
import credit_system
from events import on

logger = logging.getLogger(__name__)


# ===== request.created =====
@on("request.created")
async def on_request_created(request_id: str, client_id: str, artisan_id: str = None, **kwargs):
    """Notify the targeted artisan that a new request was created."""
    if not artisan_id:
        return
    # Lazy import to avoid circular
    from notification_service import send_notification
    client = await db_module.db.users.find_one({"_id": ObjectId(client_id)})
    client_name = client.get("name", "Client") if client else "Client"
    service_type = kwargs.get("service_type", "un service")

    await send_notification(
        recipient_id=artisan_id,
        notif_type="request_new",
        data={"request_id": request_id},
        template_vars={"client_name": client_name, "service_type": service_type},
    )

    # Schedule reminder if no response in 2h
    from scheduler import schedule_notification
    await schedule_notification(
        key=f"no_response:{request_id}",
        delay_seconds=2 * 3600,
        notif_type="request_no_response",
        recipient_id=artisan_id,
        data={"request_id": request_id},
        template_vars={"client_name": client_name},
    )


# ===== request.accepted =====
@on("request.accepted")
async def on_request_accepted(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Create conversation, notify client, cancel reminders."""
    # 1. Create conversation
    conv_doc = {
        "request_id": request_id,
        "participants": [client_id, artisan_id],
        "last_message": None,
        "last_message_at": datetime.utcnow(),
        "unread_count": {client_id: 0, artisan_id: 0},
        "created_at": datetime.utcnow(),
    }
    try:
        result = await db_module.db.conversations.insert_one(conv_doc)
        conv_id = str(result.inserted_id)
    except Exception:
        # Conversation already exists (unique index on request_id)
        existing = await db_module.db.conversations.find_one({"request_id": request_id})
        conv_id = str(existing["_id"]) if existing else None

    # 2. System message in conversation
    if conv_id:
        sys_msg = {
            "conversation_id": conv_id,
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": client_id,
            "message": "L'artisan a accepte votre demande. Vous pouvez maintenant echanger.",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)

    # 3. Notify client
    from notification_service import send_notification
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    artisan_name = artisan.get("name", "Artisan") if artisan else "Artisan"

    await send_notification(
        recipient_id=client_id,
        notif_type="request_accepted",
        data={"request_id": request_id, "conversation_id": conv_id},
        template_vars={"artisan_name": artisan_name},
    )

    # 4. Cancel the no-response reminder
    from scheduler import cancel_scheduled
    await cancel_scheduled(f"no_response:{request_id}")


# ===== request.refused =====
@on("request.refused")
async def on_request_refused(request_id: str, client_id: str, artisan_id: str, reason: str = None, **kwargs):
    from notification_service import send_notification
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    artisan_name = artisan.get("name", "Artisan") if artisan else "Artisan"

    await send_notification(
        recipient_id=client_id,
        notif_type="request_refused",
        data={"request_id": request_id},
        template_vars={"artisan_name": artisan_name, "reason": reason or ""},
    )

    from scheduler import cancel_scheduled
    await cancel_scheduled(f"no_response:{request_id}")


# ===== request.started =====
@on("request.started")
async def on_request_started(request_id: str, client_id: str, artisan_id: str, **kwargs):
    from notification_service import send_notification
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    artisan_name = artisan.get("name", "Artisan") if artisan else "Artisan"

    await send_notification(
        recipient_id=client_id,
        notif_type="work_started",
        data={"request_id": request_id},
        template_vars={"artisan_name": artisan_name},
    )


# ===== request.completed =====
@on("request.completed")
async def on_request_completed(request_id: str, client_id: str, artisan_id: str, **kwargs):
    from notification_service import send_notification

    await send_notification(
        recipient_id=client_id,
        notif_type="work_completed",
        data={"request_id": request_id},
        template_vars={},
    )

    # Schedule reminder if client doesn't confirm in 24h
    from scheduler import schedule_notification
    await schedule_notification(
        key=f"confirm_remind:{request_id}",
        delay_seconds=24 * 3600,
        notif_type="confirm_reminder",
        recipient_id=client_id,
        data={"request_id": request_id},
        template_vars={},
    )


# ===== request.confirmed =====
@on("request.confirmed")
async def on_request_confirmed(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Notify artisan and block reminders after client confirmation.

    Le credit est desormais consomme au moment du release paiement (escrow).
    """
    payment_intent = await db_module.db.payment_intents.find_one(
        {"request_id": request_id},
        sort=[("created_at", -1)],
    )
    earning = 0
    if payment_intent and payment_intent.get("status") == "captured":
        from payments.adapter import get_payment_adapter
        from payments.service import PaymentService

        svc = PaymentService(get_payment_adapter())
        release_result = await svc.release_to_artisan(str(payment_intent["_id"]))
        earning = release_result.get("artisan_payout", payment_intent.get("artisan_payout", 0))
    elif payment_intent and payment_intent.get("status") == "released":
        earning = payment_intent.get("artisan_payout", 0)

    # 1. Notify artisan
    from notification_service import send_notification
    await send_notification(
        recipient_id=artisan_id,
        notif_type="mission_confirmed",
        data={"request_id": request_id},
        template_vars={"earning": f"{earning:,.0f}"},
    )

    # 2. Check if artisan is now blocked
    credit_status = await credit_system.check_can_accept_mission(artisan_id)
    if not credit_status["can_accept"]:
        await send_notification(
            recipient_id=artisan_id,
            notif_type="account_blocked",
            data={},
            template_vars={"amount": f"{credit_status['commission_due']:,.0f}"},
        )

    # 3. Cancel confirm reminder
    from scheduler import cancel_scheduled
    await cancel_scheduled(f"confirm_remind:{request_id}")


# ===== request.cancelled =====
@on("request.cancelled")
async def on_request_cancelled(request_id: str, client_id: str, artisan_id: str = None, actor_id: str = None, **kwargs):
    from notification_service import send_notification
    from scheduler import cancel_all_for_request

    # Notify the other party
    if actor_id == client_id and artisan_id:
        await send_notification(
            recipient_id=artisan_id,
            notif_type="request_cancelled",
            data={"request_id": request_id},
            template_vars={"by": "client"},
        )
    elif actor_id == artisan_id and client_id:
        await send_notification(
            recipient_id=client_id,
            notif_type="request_cancelled",
            data={"request_id": request_id},
            template_vars={"by": "artisan"},
        )

    await cancel_all_for_request(request_id)


# ===== request.disputed =====
@on("request.disputed")
async def on_request_disputed(request_id: str, client_id: str, artisan_id: str = None, **kwargs):
    from notification_service import send_notification

    # Notify admins
    admin_cursor = db_module.db.users.find({"role": "admin"})
    async for admin in admin_cursor:
        await send_notification(
            recipient_id=str(admin["_id"]),
            notif_type="dispute_new",
            data={"request_id": request_id},
            template_vars={"id": request_id[:8]},
        )
