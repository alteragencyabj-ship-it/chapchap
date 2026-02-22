"""
Event Handlers -- Business logic triggered by state machine transitions (V2)
==============================================================================
Handles all 13-state transitions:
  request.created, request.quote_sent, request.accepted, request.escrow_paid,
  request.artisan_departed, request.work_started, request.work_completed,
  request.validated, request.cancelled, request.expired, request.disputed

Wires together: notifications, conversations, credits, scheduling, refunds.
Import this module at startup to register all handlers.
"""

import logging
from datetime import datetime
import re
from bson import ObjectId
from pymongo import ReturnDocument

import database as db_module
import credit_system
from events import on
from referral_system import mark_client_affiliation_if_qualified

logger = logging.getLogger(__name__)


# =====================================================================
# Helpers
# =====================================================================

async def _get_user_name(user_id: str, fallback: str = "Utilisateur") -> str:
    """Fetch a user's display name by ID."""
    if not user_id:
        return fallback
    try:
        user = await db_module.db.users.find_one({"_id": ObjectId(user_id)})
        return user.get("name", fallback) if user else fallback
    except Exception:
        return fallback


async def _notify(recipient_id: str, notif_type: str, data: dict = None,
                  template_vars: dict = None) -> None:
    """Send a notification (lazy import to avoid circular deps)."""
    if not recipient_id:
        return
    from notification_service import send_notification
    await send_notification(
        recipient_id=recipient_id,
        notif_type=notif_type,
        data=data or {},
        template_vars=template_vars or {},
    )


def _parse_fcfa_amount(raw_value) -> float:
    """Extract a numeric amount from mixed values like '7000', '7 000 FCFA', or '5000-7000'."""
    if raw_value is None:
        return 0.0
    if isinstance(raw_value, (int, float)):
        return float(raw_value)

    text = str(raw_value)
    matches = re.findall(r"\d+", text)
    if not matches:
        return 0.0
    # Use the first amount when a range is provided ("5000-7000").
    return float(matches[0])


async def _resolve_mission_amount(request_id: str, request_doc: dict, kwargs: dict) -> float:
    """
    Resolve a trusted mission amount for financial settlement.
    Priority: escrow/payment intent -> explicit quote -> budget -> service_price text.
    """
    payment_intent = await db_module.db.payment_intents.find_one(
        {"request_id": request_id},
        sort=[("created_at", -1)],
    )
    if payment_intent and payment_intent.get("amount"):
        return float(payment_intent.get("amount", 0))

    for key in ("quote_amount", "budget", "service_price"):
        from_event = kwargs.get(key)
        parsed = _parse_fcfa_amount(from_event)
        if parsed > 0:
            return parsed

    for key in ("quote_amount", "budget", "service_price"):
        parsed = _parse_fcfa_amount(request_doc.get(key))
        if parsed > 0:
            return parsed

    return 0.0


async def _apply_completion_financials(
    *,
    request_id: str,
    client_id: str,
    artisan_id: str,
    kwargs: dict,
) -> dict:
    """
    Apply mission completion financial impacts exactly once when status becomes TERMINEE.
    """
    logger.info(
        "Financial settlement start request=%s client=%s artisan=%s",
        request_id,
        client_id,
        artisan_id,
    )

    lock_now = datetime.utcnow()
    locked_request = await db_module.db.service_requests.find_one_and_update(
        {
            "_id": ObjectId(request_id),
            "$and": [
                {
                    "$or": [
                        {"financials_applied_at": {"$exists": False}},
                        {"financials_applied_at": None},
                    ]
                },
                {
                    "$or": [
                        {"financials_lock_at": {"$exists": False}},
                        {"financials_lock_at": None},
                    ]
                }
            ],
        },
        {
            "$set": {
                "financials_lock_at": lock_now,
                "updated_at": lock_now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if not locked_request:
        # Already applied previously; return current credit state for observability.
        logger.info(
            "Financial settlement skipped (duplicate) request=%s artisan=%s",
            request_id,
            artisan_id,
        )
        try:
            return {"duplicate": True, **await credit_system.get_credit_status(artisan_id)}
        except Exception:
            return {"duplicate": True}

    amount = await _resolve_mission_amount(request_id, locked_request, kwargs)
    logger.info(
        "Financial settlement amount resolved request=%s amount=%s",
        request_id,
        amount,
    )
    try:
        settlement = await credit_system.consume_credit(
            artisan_id=artisan_id,
            booking_id=request_id,
            amount=amount,
            client_id=client_id,
            service_name=locked_request.get("service_name") or locked_request.get("service_type"),
        )
    except Exception:
        # Release lock so a subsequent retry can apply financials.
        logger.exception("Financial settlement failed request=%s artisan=%s", request_id, artisan_id)
        await db_module.db.service_requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$unset": {"financials_lock_at": ""}, "$set": {"updated_at": datetime.utcnow()}},
        )
        raise

    snapshot = {
        "applied_at": datetime.utcnow(),
        "gross_amount": amount,
        "credits_before": settlement.get("credits_before"),
        "credits_after": settlement.get("credits_after", settlement.get("credit_remaining")),
        "commission_added": settlement.get("commission_this_mission", credit_system.COMMISSION_PER_MISSION),
        "credits_consumed": 1,
        "credit_remaining": settlement.get("credit_remaining"),
        "commission_due": settlement.get("commission_due"),
        "earnings_before": settlement.get("earnings_before"),
        "earnings_after": settlement.get("earnings_after"),
        "artisan_earning_added": settlement.get("artisan_earning", amount),
        "duplicate": settlement.get("duplicate", False),
    }
    await db_module.db.service_requests.update_one(
        {"_id": ObjectId(request_id)},
        {
            "$set": {
                "financials_snapshot": snapshot,
                "financials_applied_at": datetime.utcnow(),
                "financials_trigger_status": "terminee",
                "updated_at": datetime.utcnow(),
            },
            "$unset": {"financials_lock_at": ""},
        },
    )
    logger.info(
        "Financial settlement applied request=%s commission_due=%s credit_remaining=%s artisan_earning_added=%s duplicate=%s",
        request_id,
        snapshot.get("commission_due"),
        snapshot.get("credit_remaining"),
        snapshot.get("artisan_earning_added"),
        snapshot.get("duplicate"),
    )
    return snapshot


# =====================================================================
# request.created -- DEMANDE_ENVOYEE
# =====================================================================

@on("request.created")
async def on_request_created(request_id: str, client_id: str, artisan_id: str = None, **kwargs):
    """Notify the targeted artisan that a new request was created."""
    if not artisan_id:
        return
    client_name = await _get_user_name(client_id, "Client")
    service_type = kwargs.get("service_type", "un service")

    await _notify(
        artisan_id, "request_new",
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


# =====================================================================
# request.quote_sent -- DEVIS_ENVOYE
# =====================================================================

@on("request.quote_sent")
async def on_quote_sent(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Create conversation, notify client that a quote was received."""
    # 1. Create conversation (chat opens at DEVIS_ENVOYE)
    conv_id = await _ensure_conversation(request_id, client_id, artisan_id)

    # 2. System message
    if conv_id:
        sys_msg = {
            "conversation_id": conv_id,
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": client_id,
            "message": "L'artisan a envoye un devis. Consultez-le et repondez.",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)

    # 3. Notify client
    artisan_name = await _get_user_name(artisan_id, "Artisan")
    quote_amount = kwargs.get("quote_amount", "")

    await _notify(
        client_id, "quote_received",
        data={"request_id": request_id, "conversation_id": conv_id},
        template_vars={"artisan_name": artisan_name, "amount": str(quote_amount)},
    )

    # 4. Cancel the no-response reminder
    from scheduler import cancel_scheduled
    await cancel_scheduled(f"no_response:{request_id}")


# =====================================================================
# request.accepted -- ACCEPTEE
# =====================================================================

@on("request.accepted")
async def on_request_accepted(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Handle acceptance -- works for both fast-path (artisan accepts directly)
    and quote-flow (client accepts quote)."""
    # Ensure conversation exists
    conv_id = await _ensure_conversation(request_id, client_id, artisan_id)

    previous_status = kwargs.get("previous_status", "")
    is_fast_path = previous_status == "demande_envoyee"

    # System messages
    if conv_id:
        if is_fast_path:
            # Fast-path: artisan accepted the request directly
            artisan_msg = {
                "conversation_id": conv_id,
                "request_id": request_id,
                "sender_id": "system",
                "receiver_id": client_id,
                "message": "L'artisan a accepte votre demande. Vous pouvez maintenant echanger.",
                "message_type": "system",
                "timestamp": datetime.utcnow(),
                "read": False,
            }
            await db_module.db.messages.insert_one(artisan_msg)
            mission_msg = {
                "conversation_id": conv_id,
                "request_id": request_id,
                "sender_id": "system",
                "receiver_id": artisan_id,
                "message": "Mission acceptee ! Vous pouvez discuter des details.",
                "message_type": "system",
                "timestamp": datetime.utcnow(),
                "read": False,
            }
            await db_module.db.messages.insert_one(mission_msg)
        else:
            # Quote flow: client accepted the quote
            sys_msg = {
                "conversation_id": conv_id,
                "request_id": request_id,
                "sender_id": "system",
                "receiver_id": artisan_id,
                "message": "Le client a accepte votre devis. En attente du paiement.",
                "message_type": "system",
                "timestamp": datetime.utcnow(),
                "read": False,
            }
            await db_module.db.messages.insert_one(sys_msg)

    # Mark artisan as occupied
    if artisan_id:
        await db_module.db.users.update_one(
            {"_id": ObjectId(artisan_id)},
            {"$set": {"is_available": False, "current_mission_id": request_id}},
        )

    # Cancel no-response reminder
    from scheduler import cancel_scheduled
    await cancel_scheduled(f"no_response:{request_id}")

    # Notifications
    client_name = await _get_user_name(client_id, "Client")
    artisan_name = await _get_user_name(artisan_id, "Artisan")

    if is_fast_path:
        # Notify client that artisan accepted
        await _notify(
            client_id, "request_accepted",
            data={"request_id": request_id},
            template_vars={"artisan_name": artisan_name},
        )
    else:
        # Notify artisan that client accepted quote
        await _notify(
            artisan_id, "quote_accepted",
            data={"request_id": request_id},
            template_vars={"client_name": client_name},
        )
        # Notify client to proceed to payment
        await _notify(
            client_id, "payment_prompt",
            data={"request_id": request_id},
            template_vars={},
        )


# =====================================================================
# request.escrow_paid -- PAIEMENT_ESCROW
# =====================================================================

@on("request.escrow_paid")
async def on_escrow_paid(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Payment captured in escrow. Notify artisan to depart."""
    artisan_name = await _get_user_name(artisan_id, "Artisan")

    # Notify artisan: funds secured, time to depart
    await _notify(
        artisan_id, "escrow_confirmed",
        data={"request_id": request_id},
        template_vars={},
    )

    # Notify client: payment received, artisan will depart soon
    await _notify(
        client_id, "payment_confirmed",
        data={"request_id": request_id},
        template_vars={"artisan_name": artisan_name},
    )

    # System message in conversation
    conv = await db_module.db.conversations.find_one({"request_id": request_id})
    if conv:
        sys_msg = {
            "conversation_id": str(conv["_id"]),
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": artisan_id,
            "message": "Paiement recu et securise. Confirmez votre depart quand vous etes pret.",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)


# =====================================================================
# request.artisan_departed -- ARTISAN_EN_ROUTE
# =====================================================================

@on("request.artisan_departed")
async def on_artisan_departed(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Artisan confirmed departure. Notify client with artisan phone now visible."""
    artisan_name = await _get_user_name(artisan_id, "Artisan")

    await _notify(
        client_id, "artisan_en_route",
        data={"request_id": request_id},
        template_vars={"artisan_name": artisan_name},
    )

    # System message in conversation
    conv = await db_module.db.conversations.find_one({"request_id": request_id})
    if conv:
        sys_msg = {
            "conversation_id": str(conv["_id"]),
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": client_id,
            "message": "L'artisan est en route vers votre adresse.",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)


# =====================================================================
# request.work_started -- MISSION_EN_COURS
# =====================================================================

@on("request.work_started")
async def on_work_started(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Artisan arrived on-site and started working."""
    artisan_name = await _get_user_name(artisan_id, "Artisan")

    await _notify(
        client_id, "work_started",
        data={"request_id": request_id},
        template_vars={"artisan_name": artisan_name},
    )


# =====================================================================
# request.work_completed -- TERMINEE
# =====================================================================

@on("request.work_completed")
async def on_work_completed(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Artisan declared work complete. Prompt client to validate."""
    settlement_snapshot = kwargs.get("wallet_update")
    try:
        from socketio_server import emit_wallet_update

        await emit_wallet_update(
            client_id=client_id,
            artisan_id=artisan_id,
            payload={
                "request_id": request_id,
                "status": "terminee",
                "event": "wallet_update",
                "financials": settlement_snapshot,
                "updated_at": datetime.utcnow().isoformat(),
            },
        )
        logger.info("Wallet realtime event emitted request=%s", request_id)
    except Exception:
        logger.exception("Failed to emit wallet realtime update for request %s", request_id)

    await _notify(
        client_id, "work_completed",
        data={"request_id": request_id},
        template_vars={},
    )

    # System message in conversation
    conv = await db_module.db.conversations.find_one({"request_id": request_id})
    if conv:
        sys_msg = {
            "conversation_id": str(conv["_id"]),
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": client_id,
            "message": "L'artisan a termine la mission. Veuillez valider le travail.",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)

    # Schedule reminder if client doesn't validate in 24h
    from scheduler import schedule_notification
    await schedule_notification(
        key=f"validate_remind:{request_id}",
        delay_seconds=24 * 3600,
        notif_type="validate_reminder",
        recipient_id=client_id,
        data={"request_id": request_id},
        template_vars={},
    )


# =====================================================================
# request.validated -- VALIDEE_CLIENT
# =====================================================================

@on("request.validated")
async def on_request_validated(request_id: str, client_id: str, artisan_id: str, **kwargs):
    """Handle final validation with strict business rules.

    Financial actions are executed only for direct client validation from TERMINEE.
    """
    previous_status = str(kwargs.get("previous_status") or "")
    actor_role = str(kwargs.get("actor_role") or "")
    is_final_client_validation = previous_status == "terminee" and actor_role == "client"

    # Mark artisan as available again
    if artisan_id:
        await db_module.db.users.update_one(
            {"_id": ObjectId(artisan_id)},
            {"$set": {"is_available": True}, "$unset": {"current_mission_id": ""}},
        )

    earning = 0
    if is_final_client_validation:
        # Release escrow payment
        payment_intent = await db_module.db.payment_intents.find_one(
            {"request_id": request_id},
            sort=[("created_at", -1)],
        )
        if payment_intent and payment_intent.get("status") == "captured":
            try:
                from payments.adapter import get_payment_adapter
                from payments.service import PaymentService

                svc = PaymentService(get_payment_adapter())
                release_result = await svc.release_to_artisan(str(payment_intent["_id"]))
                earning = release_result.get("artisan_payout", payment_intent.get("artisan_payout", 0))
            except Exception:
                logger.exception(f"Failed to release escrow for request {request_id}")
        elif payment_intent and payment_intent.get("status") == "released":
            earning = payment_intent.get("artisan_payout", 0)

        # Notify both sides
        await _notify(
            artisan_id, "mission_confirmed",
            data={"request_id": request_id},
            template_vars={"earning": f"{earning:,.0f}"},
        )
        await _notify(
            client_id, "mission_validated",
            data={"request_id": request_id},
            template_vars={"earning": f"{earning:,.0f}"},
        )

        # Ask client to rate the artisan right after successful final validation.
        await _notify(
            client_id, "rating_prompt",
            data={"request_id": request_id, "artisan_id": artisan_id},
            template_vars={},
        )

        # Qualify referred client after first validated mission
        try:
            affiliation_result = await mark_client_affiliation_if_qualified(client_id)
            if affiliation_result.get("qualified"):
                logger.info(
                    "Affiliation qualified: client=%s artisan=%s referral=%s",
                    client_id,
                    affiliation_result.get("artisan_id"),
                    affiliation_result.get("referral_id", ""),
                )
        except Exception:
            logger.exception("Failed to process affiliation qualification for client %s", client_id)

        # Increment completed mission counters (only true final validations, no dispute path).
        try:
            await db_module.db.users.update_one(
                {"_id": ObjectId(artisan_id)},
                {"$inc": {"total_missions": 1}},
            )
            await db_module.db.artisan_profiles.update_one(
                {"user_id": artisan_id},
                {"$inc": {"missions_completees": 1}},
            )
        except Exception:
            logger.exception("Failed to increment completed mission counters for artisan %s", artisan_id)

        # Refresh score/badges so profile reflects new stats everywhere.
        try:
            from scoring_system import refresh_artisan_scores
            from badge_system import refresh_badges

            await refresh_artisan_scores(artisan_id)
            await refresh_badges(artisan_id)
        except Exception:
            logger.exception("Failed to refresh artisan scoring/badges for %s", artisan_id)

        # Check if artisan is now blocked (credit system)
        try:
            credit_status = await credit_system.check_can_accept_mission(artisan_id)
            if not credit_status["can_accept"]:
                await _notify(
                    artisan_id, "account_blocked",
                    data={},
                    template_vars={"amount": f"{credit_status['commission_due']:,.0f}"},
                )
        except Exception:
            logger.exception(f"Credit check failed for artisan {artisan_id}")
    else:
        # Dispute/admin path: keep mission state change, but no automatic financial side effects.
        await _notify(
            client_id, "mission_validated",
            data={"request_id": request_id},
            template_vars={"earning": "0"},
        )
        await _notify(
            artisan_id, "mission_confirmed",
            data={"request_id": request_id},
            template_vars={"earning": "0"},
        )

    # Cancel validation reminders
    from scheduler import cancel_scheduled
    await cancel_scheduled(f"validate_remind:{request_id}")

    # System message in conversation
    conv = await db_module.db.conversations.find_one({"request_id": request_id})
    if conv:
        auto_tag = " (auto)" if actor_role == "system" else ""
        status_text = (
            "Mission validee. Paiement libere."
            if is_final_client_validation
            else "Mission validee apres resolution. Paiement non libere automatiquement."
        )
        sys_msg = {
            "conversation_id": str(conv["_id"]),
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": artisan_id,
            "message": f"{status_text}{auto_tag}",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)


# =====================================================================
# request.cancelled -- ANNULEE
# =====================================================================

@on("request.cancelled")
async def on_request_cancelled(request_id: str, client_id: str, artisan_id: str = None,
                               actor_id: str = None, **kwargs):
    """Handle cancellation with refund logic based on cancellation_info."""
    # Mark artisan as available again
    if artisan_id:
        await db_module.db.users.update_one(
            {"_id": ObjectId(artisan_id)},
            {"$set": {"is_available": True}, "$unset": {"current_mission_id": ""}},
        )

    from scheduler import cancel_all_for_request

    cancellation_info = kwargs.get("cancellation_info", {})
    refund_type = cancellation_info.get("refund_type", "none")
    previous_status = kwargs.get("previous_status", "")

    # Process refund if applicable
    if refund_type in ("full", "partial"):
        await _process_refund(request_id, refund_type, cancellation_info.get("fee_pct", 0.0))

    # Notify the other party
    by_label = "le systeme"
    if actor_id == client_id:
        by_label = "client"
    elif actor_id == artisan_id:
        by_label = "artisan"
    elif kwargs.get("actor_role") == "admin":
        by_label = "administrateur"

    if artisan_id and actor_id != artisan_id:
        await _notify(
            artisan_id, "request_cancelled",
            data={"request_id": request_id},
            template_vars={"by": by_label},
        )
    if client_id and actor_id != client_id:
        await _notify(
            client_id, "request_cancelled",
            data={"request_id": request_id},
            template_vars={"by": by_label},
        )

    await cancel_all_for_request(request_id)


# =====================================================================
# request.expired -- EXPIREE
# =====================================================================

@on("request.expired")
async def on_request_expired(request_id: str, client_id: str, artisan_id: str = None,
                             reason: str = None, **kwargs):
    """Handle automatic expiration. Notify both parties."""
    from scheduler import cancel_all_for_request

    previous_status = kwargs.get("previous_status", "")

    # Notify client
    await _notify(
        client_id, "request_expired",
        data={"request_id": request_id},
        template_vars={"reason": reason or "Delai depasse"},
    )

    # Notify artisan if assigned
    if artisan_id:
        await _notify(
            artisan_id, "request_expired",
            data={"request_id": request_id},
            template_vars={"reason": reason or "Delai depasse"},
        )

    await cancel_all_for_request(request_id)


# =====================================================================
# request.disputed -- LITIGE
# =====================================================================

@on("request.disputed")
async def on_request_disputed(request_id: str, client_id: str, artisan_id: str = None,
                              actor_id: str = None, reason: str = None, **kwargs):
    """Handle dispute opening. Notify all parties + admins."""
    # Notify the other party
    if actor_id == client_id and artisan_id:
        await _notify(
            artisan_id, "dispute_opened",
            data={"request_id": request_id},
            template_vars={"reason": reason or ""},
        )
    elif actor_id == artisan_id and client_id:
        await _notify(
            client_id, "dispute_opened",
            data={"request_id": request_id},
            template_vars={"reason": reason or ""},
        )

    # Notify all admins
    admin_cursor = db_module.db.users.find({"role": "admin"})
    async for admin in admin_cursor:
        await _notify(
            str(admin["_id"]), "dispute_new",
            data={"request_id": request_id},
            template_vars={"id": request_id[:8]},
        )

    # System message in conversation
    conv = await db_module.db.conversations.find_one({"request_id": request_id})
    if conv:
        sys_msg = {
            "conversation_id": str(conv["_id"]),
            "request_id": request_id,
            "sender_id": "system",
            "receiver_id": client_id,
            "message": "Litige ouvert. Le support ARTISAN suit votre dossier.",
            "message_type": "system",
            "timestamp": datetime.utcnow(),
            "read": False,
        }
        await db_module.db.messages.insert_one(sys_msg)


# =====================================================================
# Internal helpers
# =====================================================================

async def _ensure_conversation(request_id: str, client_id: str, artisan_id: str) -> str | None:
    """Create a conversation if one doesn't already exist. Return conv_id."""
    existing = await db_module.db.conversations.find_one({"request_id": request_id})
    if existing:
        return str(existing["_id"])

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
        return str(result.inserted_id)
    except Exception:
        logger.exception(f"Failed to create conversation for request {request_id}")
        existing = await db_module.db.conversations.find_one({"request_id": request_id})
        return str(existing["_id"]) if existing else None


async def _process_refund(request_id: str, refund_type: str, fee_pct: float = 0.0) -> None:
    """Process a refund for a cancelled request.

    - refund_type "full": 100% refund
    - refund_type "partial": refund minus fee_pct platform fee
    """
    payment_intent = await db_module.db.payment_intents.find_one(
        {"request_id": request_id},
        sort=[("created_at", -1)],
    )
    if not payment_intent:
        logger.warning(f"No payment intent found for refund on request {request_id}")
        return

    if payment_intent.get("status") not in ("captured", "paid"):
        logger.warning(
            f"Payment intent {payment_intent['_id']} status is "
            f"'{payment_intent.get('status')}', cannot refund"
        )
        return

    try:
        from payments.adapter import get_payment_adapter
        from payments.service import PaymentService

        svc = PaymentService(get_payment_adapter())

        if refund_type == "full":
            await svc.refund(str(payment_intent["_id"]), reason="cancellation_full_refund")
        elif refund_type == "partial":
            total = payment_intent.get("amount", 0)
            fee = int(total * fee_pct)
            refund_amount = total - fee
            await svc.refund(
                str(payment_intent["_id"]),
                amount=refund_amount,
                reason=f"cancellation_partial_refund_fee_{int(fee_pct*100)}pct",
            )
        logger.info(f"Refund processed for request {request_id}: type={refund_type}")
    except Exception:
        logger.exception(f"Refund failed for request {request_id}")
