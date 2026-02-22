"""
Wallet Service
==============
Critical, server-side wallet updates with idempotence guarantees.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any, Dict, Optional

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

import credit_system
import database as db_module

logger = logging.getLogger(__name__)


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_fcfa_amount(raw_value: Any) -> float:
    if raw_value is None:
        return 0.0
    if isinstance(raw_value, (int, float)):
        return float(raw_value)

    text = str(raw_value)
    matches = re.findall(r"\d+", text)
    if not matches:
        return 0.0
    return float(matches[0])


def _supports_tx_error(exc: Exception) -> bool:
    if not isinstance(exc, OperationFailure):
        return False
    message = str(exc).lower()
    return (
        "transaction numbers are only allowed on a replica set member or mongos" in message
        or "transactions are not supported" in message
        or getattr(exc, "code", None) in {20, 251}
    )


async def _resolve_mission_amount(mission_id: str, mission_doc: Dict[str, Any]) -> float:
    payment_intent = await db_module.db.payment_intents.find_one(
        {"request_id": mission_id},
        sort=[("created_at", -1)],
    )
    if payment_intent and payment_intent.get("amount") is not None:
        return float(payment_intent.get("amount", 0))

    for key in ("quote_amount", "budget", "service_price"):
        parsed = _parse_fcfa_amount(mission_doc.get(key))
        if parsed > 0:
            return parsed

    return 0.0


def _default_credit_doc(artisan_id: str, now: datetime) -> Dict[str, Any]:
    return {
        "artisan_id": artisan_id,
        "level": "fixed",
        "credit_remaining": credit_system.MISSIONS_PER_CYCLE,
        "credit_max": credit_system.MISSIONS_PER_CYCLE,
        "missions_completed_in_cycle": 0,
        "commission_due": 0,
        "commission_per_mission": credit_system.COMMISSION_PER_MISSION,
        "is_blocked": False,
        "blocked_since": None,
        "blocked_at": None,
        "last_reminder_sent": None,
        "total_earned": 0.0,
        "total_paid": 0.0,
        "last_payment_at": None,
        "created_at": now,
        "updated_at": now,
    }


async def _apply_mission_completion_once(
    *,
    mission_id: str,
    artisan_id: str,
    client_id: str,
    mission_price: float,
    session=None,
) -> Dict[str, Any]:
    now = datetime.utcnow()
    delta = {
        "commission_due": credit_system.COMMISSION_PER_MISSION,
        "credits": -1,
        "earnings": float(mission_price),
    }

    wallet_tx_inserted = False
    try:
        try:
            await db_module.db.wallet_transactions.insert_one(
                {
                    "missionId": mission_id,
                    "artisanId": artisan_id,
                    "clientId": client_id,
                    "type": "MISSION_COMPLETED",
                    "delta": delta,
                    "createdAt": now,
                },
                session=session,
            )
            wallet_tx_inserted = True
            logger.info(
                "WALLET_TX_INSERTED missionId=%s artisanId=%s delta=%s",
                mission_id,
                artisan_id,
                delta,
            )
        except DuplicateKeyError:
            status = await credit_system.get_credit_status(artisan_id)
            logger.info("WALLET_TX_DUPLICATE missionId=%s artisanId=%s", mission_id, artisan_id)
            return {
                "duplicate": True,
                "mission_id": mission_id,
                "artisan_id": artisan_id,
                "client_id": client_id,
                "mission_price": float(mission_price),
                "credits_before": status.get("credit_remaining"),
                "credits_after": status.get("credit_remaining"),
                "earnings_before": float(status.get("total_earned", 0.0)),
                "earnings_after": float(status.get("total_earned", 0.0)),
                "commission_before": _coerce_int(status.get("commission_due"), 0),
                "commission_after": _coerce_int(status.get("commission_due"), 0),
                "credit_remaining": status.get("credit_remaining"),
                "commission_due": _coerce_int(status.get("commission_due"), 0),
                "artisan_earning_added": 0.0,
                "is_blocked": bool(status.get("is_blocked")),
            }

        await db_module.db.artisan_credits.update_one(
            {"artisan_id": artisan_id},
            {"$setOnInsert": _default_credit_doc(artisan_id, now)},
            upsert=True,
            session=session,
        )
        before_wallet = await db_module.db.artisan_credits.find_one(
            {"artisan_id": artisan_id},
            session=session,
        ) or _default_credit_doc(artisan_id, now)

        credits_before = _coerce_int(before_wallet.get("credit_remaining"), credit_system.MISSIONS_PER_CYCLE)
        earnings_before = float(before_wallet.get("total_earned", 0.0))
        commission_before = _coerce_int(before_wallet.get("commission_due"), 0)

        updated_wallet = await db_module.db.artisan_credits.find_one_and_update(
            {"artisan_id": artisan_id},
            {
                "$inc": {
                    "commission_due": credit_system.COMMISSION_PER_MISSION,
                    "credit_remaining": -1,
                    "total_earned": float(mission_price),
                },
                "$set": {
                    "credit_max": credit_system.MISSIONS_PER_CYCLE,
                    "commission_per_mission": credit_system.COMMISSION_PER_MISSION,
                    "updated_at": now,
                    "level": "fixed",
                },
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if not updated_wallet:
            raise RuntimeError("Wallet update returned no document")

        commission_after = _coerce_int(updated_wallet.get("commission_due"), 0)
        credits_after = _coerce_int(updated_wallet.get("credit_remaining"), credits_before - 1)
        earnings_after = float(updated_wallet.get("total_earned", earnings_before + float(mission_price)))
        is_blocked = commission_after >= credit_system.CYCLE_COMMISSION_DUE

        await db_module.db.artisan_credits.update_one(
            {"artisan_id": artisan_id},
            {
                "$set": {
                    "is_blocked": is_blocked,
                    "blocked_since": now if is_blocked else None,
                    "blocked_at": now if is_blocked else None,
                    "missions_completed_in_cycle": max(
                        0,
                        credit_system.MISSIONS_PER_CYCLE - credits_after,
                    ),
                    "updated_at": now,
                }
            },
            session=session,
        )

        await db_module.db.mission_transactions.update_one(
            {"artisan_id": artisan_id, "booking_id": mission_id},
            {
                "$setOnInsert": {
                    "_id": ObjectId(),
                    "artisan_id": artisan_id,
                    "booking_id": mission_id,
                    "client_id": client_id,
                    "service_name": "",
                    "amount": float(mission_price),
                    "commission": credit_system.COMMISSION_PER_MISSION,
                    "artisan_earning": float(mission_price),
                    "status": "completed",
                    "created_at": now,
                }
            },
            upsert=True,
            session=session,
        )

        result = {
            "duplicate": False,
            "mission_id": mission_id,
            "artisan_id": artisan_id,
            "client_id": client_id,
            "mission_price": float(mission_price),
            "credits_before": credits_before,
            "credits_after": credits_after,
            "earnings_before": earnings_before,
            "earnings_after": earnings_after,
            "commission_before": commission_before,
            "commission_after": commission_after,
            "credit_remaining": credits_after,
            "commission_due": commission_after,
            "artisan_earning_added": float(mission_price),
            "is_blocked": is_blocked,
        }

        logger.info(
            "WALLET_UPDATED missionId=%s artisanId=%s creditsBefore=%s creditsAfter=%s earningsBefore=%s earningsAfter=%s commissionBefore=%s commissionAfter=%s",
            mission_id,
            artisan_id,
            credits_before,
            credits_after,
            earnings_before,
            earnings_after,
            commission_before,
            commission_after,
        )
        logger.info(
            "BLOCK_STATUS_UPDATED missionId=%s artisanId=%s isBlocked=%s commissionDue=%s",
            mission_id,
            artisan_id,
            is_blocked,
            commission_after,
        )
        return result
    except Exception:
        if session is None and wallet_tx_inserted:
            await db_module.db.wallet_transactions.delete_one(
                {"missionId": mission_id, "type": "MISSION_COMPLETED"}
            )
        raise


async def apply_mission_completion(mission_id: str) -> Dict[str, Any]:
    """Apply mission completion wallet impacts exactly once."""
    mission = await db_module.db.service_requests.find_one({"_id": ObjectId(mission_id)})
    if not mission:
        raise ValueError("Mission not found")

    status = str(mission.get("status", "")).strip().lower()
    # Accept both "terminee" and "validee_client":
    # - "terminee" = normal flow (artisan just declared complete)
    # - "validee_client" = retroactive fix for missions that passed through
    #   terminee before the wallet code was deployed.
    if status not in ("terminee", "validee_client"):
        raise ValueError(
            f"Mission status must be TERMINEE or VALIDEE_CLIENT before wallet update (got '{status}')"
        )

    artisan_id = mission.get("assigned_artisan_id") or mission.get("artisan_id")
    client_id = mission.get("client_id")
    if not artisan_id or not client_id:
        raise ValueError("Mission participants are incomplete")

    mission_price = await _resolve_mission_amount(mission_id, mission)

    logger.info(
        "MISSION_COMPLETED missionId=%s artisanId=%s clientId=%s missionPrice=%s",
        mission_id,
        artisan_id,
        client_id,
        mission_price,
    )

    current_status = await credit_system.get_credit_status(artisan_id)
    logger.info(
        "WALLET_UPDATE_START missionId=%s artisanId=%s creditsBefore=%s earningsBefore=%s commissionBefore=%s",
        mission_id,
        artisan_id,
        current_status.get("credit_remaining"),
        current_status.get("total_earned", 0.0),
        current_status.get("commission_due", 0),
    )

    try:
        if db_module.client is not None:
            try:
                async with await db_module.client.start_session() as session:
                    async with session.start_transaction():
                        result = await _apply_mission_completion_once(
                            mission_id=mission_id,
                            artisan_id=artisan_id,
                            client_id=client_id,
                            mission_price=mission_price,
                            session=session,
                        )
            except Exception as tx_exc:
                if _supports_tx_error(tx_exc):
                    result = await _apply_mission_completion_once(
                        mission_id=mission_id,
                        artisan_id=artisan_id,
                        client_id=client_id,
                        mission_price=mission_price,
                        session=None,
                    )
                else:
                    raise
        else:
            result = await _apply_mission_completion_once(
                mission_id=mission_id,
                artisan_id=artisan_id,
                client_id=client_id,
                mission_price=mission_price,
                session=None,
            )
    except Exception:
        logger.exception("WALLET_UPDATE_FAIL missionId=%s artisanId=%s", mission_id, artisan_id)
        raise

    if not result.get("duplicate", False):
        await db_module.db.service_requests.update_one(
            {"_id": ObjectId(mission_id)},
            {
                "$set": {
                    "financials_applied_at": datetime.utcnow(),
                    "financials_snapshot": {
                        "applied_at": datetime.utcnow(),
                        "gross_amount": mission_price,
                        "commission_added": credit_system.COMMISSION_PER_MISSION,
                        "credits_before": result.get("credits_before"),
                        "credits_after": result.get("credits_after"),
                        "credits_consumed": 1,
                        "commission_due": result.get("commission_due"),
                        "earnings_before": result.get("earnings_before"),
                        "earnings_after": result.get("earnings_after"),
                        "artisan_earning_added": result.get("artisan_earning_added"),
                        "duplicate": False,
                    },
                    "financials_trigger_status": "terminee",
                    "updated_at": datetime.utcnow(),
                },
                "$unset": {"financials_lock_at": ""},
            },
        )

    logger.info(
        "WALLET_UPDATE_SUCCESS missionId=%s artisanId=%s creditsBefore=%s creditsAfter=%s earningsBefore=%s earningsAfter=%s duplicate=%s",
        mission_id,
        artisan_id,
        result.get("credits_before"),
        result.get("credits_after"),
        result.get("earnings_before"),
        result.get("earnings_after"),
        result.get("duplicate", False),
    )
    return result


async def repay_wallet(artisan_id: str, amount: int, payment_id: str) -> Dict[str, Any]:
    """Apply a repayment transaction with idempotence by payment_id."""
    if amount != credit_system.CYCLE_COMMISSION_DUE:
        raise ValueError(f"Montant invalide: {credit_system.CYCLE_COMMISSION_DUE} FCFA requis")
    if not payment_id:
        raise ValueError("paymentId est obligatoire")

    now = datetime.utcnow()

    try:
        await db_module.db.wallet_transactions.insert_one(
            {
                "paymentId": payment_id,
                "missionId": None,
                "artisanId": artisan_id,
                "clientId": None,
                "type": "REPAYMENT",
                "delta": {"commission_due": -amount, "credits": credit_system.MISSIONS_PER_CYCLE, "earnings": 0},
                "createdAt": now,
            }
        )
    except DuplicateKeyError:
        status = await credit_system.get_credit_status(artisan_id)
        return {
            "duplicate": True,
            "artisan_id": artisan_id,
            "commission_due": _coerce_int(status.get("commission_due"), 0),
            "is_blocked": bool(status.get("is_blocked")),
            "credit_remaining": _coerce_int(status.get("credit_remaining"), credit_system.MISSIONS_PER_CYCLE),
            "total_earned": float(status.get("total_earned", 0.0)),
        }

    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {"$setOnInsert": _default_credit_doc(artisan_id, now)},
        upsert=True,
    )
    before_wallet = await db_module.db.artisan_credits.find_one({"artisan_id": artisan_id}) or _default_credit_doc(
        artisan_id, now
    )
    commission_before = _coerce_int(before_wallet.get("commission_due"), 0)

    updated_wallet = await db_module.db.artisan_credits.find_one_and_update(
        {"artisan_id": artisan_id},
        {
            "$inc": {
                "commission_due": -amount,
                "credit_remaining": credit_system.MISSIONS_PER_CYCLE,
                "total_paid": float(amount),
            },
            "$set": {
                "last_payment_at": now,
                "updated_at": now,
            },
        },
        return_document=ReturnDocument.AFTER,
    ) or before_wallet

    commission_after = _coerce_int(updated_wallet.get("commission_due"), 0)
    if commission_after < 0:
        commission_after = 0
        await db_module.db.artisan_credits.update_one(
            {"artisan_id": artisan_id},
            {"$set": {"commission_due": 0, "updated_at": now}},
        )

    is_blocked = commission_after >= credit_system.CYCLE_COMMISSION_DUE
    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {
            "$set": {
                "is_blocked": is_blocked,
                "blocked_since": now if is_blocked else None,
                "blocked_at": now if is_blocked else None,
                "updated_at": now,
            }
        },
    )

    status = await credit_system.get_credit_status(artisan_id)
    return {
        "duplicate": False,
        "artisan_id": artisan_id,
        "commission_before": commission_before,
        "commission_due": _coerce_int(status.get("commission_due"), 0),
        "is_blocked": bool(status.get("is_blocked")),
        "credit_remaining": _coerce_int(status.get("credit_remaining"), credit_system.MISSIONS_PER_CYCLE),
        "total_earned": float(status.get("total_earned", 0.0)),
    }


async def settle_commissions(artisan_id: str, admin_id: str, note: str = None) -> Dict[str, Any]:
    """Admin settlement: reset commission_due to 0, unblock artisan, reset cycle.

    Idempotent via unique settlementId and early-return when commission_due <= 0.
    """
    now = datetime.utcnow()
    settlement_id = f"settle_{artisan_id}_{int(time.time() * 1000)}"

    # Ensure credit doc exists
    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {"$setOnInsert": _default_credit_doc(artisan_id, now)},
        upsert=True,
    )

    before_wallet = await db_module.db.artisan_credits.find_one(
        {"artisan_id": artisan_id}
    ) or _default_credit_doc(artisan_id, now)

    commission_before = _coerce_int(before_wallet.get("commission_due"), 0)

    # Idempotent: nothing to settle
    if commission_before <= 0:
        return {
            "already_settled": True,
            "artisan_id": artisan_id,
            "commission_before": 0,
            "commission_after": 0,
            "is_blocked": bool(before_wallet.get("is_blocked")),
        }

    # Insert settlement transaction (idempotent via unique partial index on settlementId)
    try:
        await db_module.db.wallet_transactions.insert_one(
            {
                "settlementId": settlement_id,
                "missionId": None,
                "artisanId": artisan_id,
                "clientId": None,
                "type": "COMMISSION_SETTLEMENT",
                "delta": {
                    "commission_due": -commission_before,
                    "credits": credit_system.MISSIONS_PER_CYCLE,
                    "earnings": 0,
                },
                "amountSettled": commission_before,
                "performedByAdminId": admin_id,
                "note": note,
                "createdAt": now,
            }
        )
    except DuplicateKeyError:
        status = await credit_system.get_credit_status(artisan_id)
        return {
            "already_settled": True,
            "artisan_id": artisan_id,
            "commission_before": commission_before,
            "commission_after": _coerce_int(status.get("commission_due"), 0),
            "is_blocked": bool(status.get("is_blocked")),
        }

    # Atomic wallet reset
    updated_wallet = await db_module.db.artisan_credits.find_one_and_update(
        {"artisan_id": artisan_id},
        {
            "$set": {
                "commission_due": 0,
                "credit_remaining": credit_system.MISSIONS_PER_CYCLE,
                "credit_max": credit_system.MISSIONS_PER_CYCLE,
                "missions_completed_in_cycle": 0,
                "is_blocked": False,
                "blocked_since": None,
                "blocked_at": None,
                "last_payment_at": now,
                "updated_at": now,
                "level": "fixed",
            },
            "$inc": {
                "total_paid": float(commission_before),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    commission_after = _coerce_int(
        (updated_wallet or {}).get("commission_due"), 0
    )

    logger.info(
        "COMMISSION_SETTLED artisanId=%s adminId=%s amountSettled=%s commissionBefore=%s commissionAfter=%s",
        artisan_id,
        admin_id,
        commission_before,
        commission_before,
        commission_after,
    )

    return {
        "already_settled": False,
        "artisan_id": artisan_id,
        "amount_settled": commission_before,
        "commission_before": commission_before,
        "commission_after": commission_after,
        "is_blocked": False,
        "credit_remaining": credit_system.MISSIONS_PER_CYCLE,
        "note": note,
    }
