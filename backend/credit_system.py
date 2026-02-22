"""
CREDIT SYSTEM - Systeme de Credit Artisan
==========================================
Commission fixe par mission avec cycle de blocage/deblocage.

Regles:
- Commission fixe: 2 000 FCFA par mission
- Cycle: 5 missions
- A la 5e mission: compte bloque, commission due = 10 000 FCFA
- Deblocage: paiement exact du montant du (pas de partiel)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Dict, Optional

from bson import ObjectId
from pymongo import ReturnDocument

import database as db_module

# Configuration fixe du nouveau systeme
COMMISSION_PER_MISSION = 2000
MISSIONS_PER_CYCLE = 5
CYCLE_COMMISSION_DUE = COMMISSION_PER_MISSION * MISSIONS_PER_CYCLE
REMINDER_INTERVAL = timedelta(hours=24)

# Compat legacy (utilise dans quelques routes admin)
BLOCK_THRESHOLD = CYCLE_COMMISSION_DUE

SUSPENSION_MESSAGE_TEMPLATE = (
    "Votre compte est suspendu. Reglez {amount} FCFA pour reprendre vos missions."
)


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _format_fcfa(amount: int) -> str:
    return f"{amount:,}".replace(",", " ")


def _build_suspension_message(amount: int) -> str:
    return SUSPENSION_MESSAGE_TEMPLATE.format(amount=_format_fcfa(amount))


def _default_credit_doc(artisan_id: str, now: datetime) -> Dict[str, Any]:
    return {
        "artisan_id": artisan_id,
        "level": "fixed",  # champ conserve pour compat admin/legacy
        "credit_remaining": MISSIONS_PER_CYCLE,
        "credit_max": MISSIONS_PER_CYCLE,
        "missions_completed_in_cycle": 0,
        "commission_due": 0,
        "commission_per_mission": COMMISSION_PER_MISSION,
        "is_blocked": False,
        "blocked_since": None,
        "blocked_at": None,  # champ legacy
        "last_reminder_sent": None,
        "total_earned": 0.0,
        "total_paid": 0.0,
        "last_payment_at": None,
        "created_at": now,
        "updated_at": now,
    }


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def get_or_create_credit(artisan_id: str) -> Dict[str, Any]:
    """Recupere ou cree le profil de credit d'un artisan (upsert atomique)."""
    now = _now_utc()
    defaults = _default_credit_doc(artisan_id, now)

    credit = await db_module.db.artisan_credits.find_one_and_update(
        {"artisan_id": artisan_id},
        {"$setOnInsert": defaults},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    # Migration douce des anciens documents
    update_set: Dict[str, Any] = {}

    if "credit_max" not in credit:
        update_set["credit_max"] = MISSIONS_PER_CYCLE
    credit_max = _coerce_int(credit.get("credit_max"), MISSIONS_PER_CYCLE)
    if credit_max <= 0:
        credit_max = MISSIONS_PER_CYCLE
        update_set["credit_max"] = credit_max

    credit_remaining = _coerce_int(credit.get("credit_remaining"), credit_max)
    if credit_remaining > credit_max:
        credit_remaining = credit_max
        update_set["credit_remaining"] = credit_max

    commission_due = _coerce_int(credit.get("commission_due"), 0)
    if commission_due < 0:
        commission_due = 0
        update_set["commission_due"] = 0

    blocked_since = credit.get("blocked_since") or credit.get("blocked_at")
    if credit.get("blocked_since") != blocked_since:
        update_set["blocked_since"] = blocked_since
    if credit.get("blocked_at") != blocked_since:
        update_set["blocked_at"] = blocked_since

    if "commission_per_mission" not in credit:
        update_set["commission_per_mission"] = COMMISSION_PER_MISSION

    if "missions_completed_in_cycle" not in credit:
        update_set["missions_completed_in_cycle"] = max(0, credit_max - credit_remaining)

    if "last_reminder_sent" not in credit:
        update_set["last_reminder_sent"] = None

    if "level" not in credit:
        update_set["level"] = "fixed"

    if update_set:
        update_set["updated_at"] = now
        await db_module.db.artisan_credits.update_one(
            {"_id": credit["_id"]},
            {"$set": update_set},
        )
        credit.update(update_set)

    credit["_id"] = str(credit["_id"])
    return credit


async def check_can_accept_mission(artisan_id: str) -> Dict[str, Any]:
    """Verifie si l'artisan peut accepter une nouvelle mission."""
    credit = await get_or_create_credit(artisan_id)

    commission_due = _coerce_int(credit.get("commission_due"), 0)
    is_blocked = bool(credit.get("is_blocked")) or commission_due >= CYCLE_COMMISSION_DUE
    can_accept = commission_due < CYCLE_COMMISSION_DUE and not is_blocked
    reason = None
    if not can_accept:
        reason = "Remboursez 10 000 FCFA pour continuer"

    return {
        "can_accept": can_accept,
        "credit_remaining": credit["credit_remaining"],
        "credit_max": credit["credit_max"],
        "commission_due": commission_due,
        "commission_per_mission": COMMISSION_PER_MISSION,
        "commission_rate_percent": f"{_format_fcfa(COMMISSION_PER_MISSION)} FCFA / mission",
        "commission_model": "fixed_per_mission",
        "is_blocked": is_blocked,
        "reason": reason,
    }


async def consume_credit(
    artisan_id: str,
    booking_id: str,
    amount: float,
    client_id: Optional[str] = None,
    service_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Consomme 1 mission de credit et ajoute la commission fixe.
    Appele quand une mission est liberee/terminee.
    """
    # Idempotency guard: a mission can impact credits/commission only once.
    existing_tx = await db_module.db.mission_transactions.find_one(
        {"artisan_id": artisan_id, "booking_id": booking_id},
        sort=[("created_at", -1)],
    )
    if existing_tx:
        status = await get_credit_status(artisan_id)
        return {
            "duplicate": True,
            "credits_before": status["credit_remaining"],
            "credits_after": status["credit_remaining"],
            "credit_remaining": status["credit_remaining"],
            "credit_max": status["credit_max"],
            "earnings_before": float(status.get("total_earned", 0.0)),
            "earnings_after": float(status.get("total_earned", 0.0)),
            "commission_due": status["commission_due"],
            "commission_this_mission": _coerce_int(existing_tx.get("commission"), COMMISSION_PER_MISSION),
            "artisan_earning": float(existing_tx.get("artisan_earning", existing_tx.get("amount", 0))),
            "is_blocked": status["is_blocked"],
            "message": "Already applied",
        }

    credit = await get_or_create_credit(artisan_id)

    now = _now_utc()
    gross_amount = float(amount)
    commission = COMMISSION_PER_MISSION
    # Product requirement: artisan dashboard shows gross mission gains.
    artisan_earning = max(0.0, gross_amount)

    credits_before = _coerce_int(credit.get("credit_remaining"), MISSIONS_PER_CYCLE)
    earnings_before = float(credit.get("total_earned", 0.0))
    # Wallet updates must always apply on mission completion, even if account is already blocked.
    # Blocking only prevents accepting NEW missions (checked in check_can_accept_mission/accept endpoint).
    new_credit_remaining = credits_before - 1
    new_commission_due = _coerce_int(credit.get("commission_due"), 0) + commission
    should_block = new_commission_due >= CYCLE_COMMISSION_DUE
    blocked_since = now if should_block else None
    earnings_after = earnings_before + artisan_earning

    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {
            "$set": {
                "credit_remaining": new_credit_remaining,
                "credit_max": MISSIONS_PER_CYCLE,
                "missions_completed_in_cycle": max(0, MISSIONS_PER_CYCLE - new_credit_remaining),
                "commission_due": new_commission_due,
                "commission_per_mission": COMMISSION_PER_MISSION,
                "total_earned": earnings_after,
                "is_blocked": should_block,
                "blocked_since": blocked_since,
                "blocked_at": blocked_since,
                "updated_at": now,
                "level": "fixed",
            }
        },
    )

    transaction = {
        "_id": ObjectId(),
        "artisan_id": artisan_id,
        "booking_id": booking_id,
        "client_id": client_id,
        "service_name": service_name,
        "amount": gross_amount,
        "commission": commission,
        "artisan_earning": artisan_earning,
        "status": "completed",
        "created_at": now,
    }
    await db_module.db.mission_transactions.insert_one(transaction)

    message = "OK"
    if should_block:
        message = _build_suspension_message(new_commission_due)

    return {
        "credits_before": credits_before,
        "credits_after": new_credit_remaining,
        "credit_remaining": new_credit_remaining,
        "credit_max": MISSIONS_PER_CYCLE,
        "earnings_before": earnings_before,
        "earnings_after": earnings_after,
        "commission_due": new_commission_due,
        "commission_this_mission": commission,
        "artisan_earning": artisan_earning,
        "is_blocked": should_block,
        "message": message,
    }


async def pay_commission(
    artisan_id: str,
    amount: float,
    payment_method: str,
    transaction_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Enregistre un paiement de commission.
    Regle stricte: paiement exact uniquement (pas de paiement partiel).
    """
    credit = await get_or_create_credit(artisan_id)

    expected_amount = _coerce_int(credit.get("commission_due"), 0)
    if expected_amount <= 0:
        return {
            "success": False,
            "error": "Aucune commission due",
            "commission_due": 0,
        }

    if not credit.get("is_blocked"):
        return {
            "success": False,
            "error": "Le compte n'est pas bloque",
            "commission_due": expected_amount,
        }

    paid_amount = _coerce_int(amount, -1)
    if paid_amount != expected_amount:
        return {
            "success": False,
            "error": "Montant invalide: paiement exact requis",
            "expected_amount": expected_amount,
            "received_amount": paid_amount,
        }

    now = _now_utc()
    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {
            "$set": {
                "credit_remaining": MISSIONS_PER_CYCLE,
                "credit_max": MISSIONS_PER_CYCLE,
                "missions_completed_in_cycle": 0,
                "commission_due": 0,
                "commission_per_mission": COMMISSION_PER_MISSION,
                "is_blocked": False,
                "blocked_since": None,
                "blocked_at": None,
                "last_reminder_sent": None,
                "last_payment_at": now,
                "updated_at": now,
                "level": "fixed",
            },
            "$inc": {
                "total_paid": float(paid_amount),
            },
        },
    )

    payment = {
        "_id": ObjectId(),
        "artisan_id": artisan_id,
        "amount": paid_amount,
        "payment_method": payment_method,
        "transaction_id": transaction_id,
        "credits_unlocked": MISSIONS_PER_CYCLE,
        "status": "completed",
        "created_at": now,
        "completed_at": now,
    }
    await db_module.db.commission_payments.insert_one(payment)

    return {
        "success": True,
        "amount_paid": paid_amount,
        "commission_remaining": 0,
        "credits_unlocked": MISSIONS_PER_CYCLE,
        "is_blocked": False,
        "message": "Paiement recu ! Votre compte est debloque.",
    }


async def update_level(artisan_id: str) -> Dict[str, Any]:
    """Compat legacy: les niveaux sont desactives dans le nouveau modele."""
    return {
        "level_changed": False,
        "current_level": "fixed",
        "message": "Niveaux desactives: commission fixe active",
    }


async def mark_reminder_sent(artisan_id: str, at: Optional[datetime] = None) -> None:
    """Met a jour l'horodatage du dernier rappel de paiement."""
    reminder_at = at or _now_utc()
    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {"$set": {"last_reminder_sent": reminder_at, "updated_at": _now_utc()}},
    )


async def get_credit_status(artisan_id: str) -> Dict[str, Any]:
    """Retourne le statut complet du credit pour l'UI artisan."""
    credit = await get_or_create_credit(artisan_id)
    now = _now_utc()

    blocked_since = credit.get("blocked_since") or credit.get("blocked_at")
    last_reminder_sent = credit.get("last_reminder_sent")
    commission_due = _coerce_int(credit.get("commission_due"), 0)
    is_blocked = bool(credit.get("is_blocked")) or commission_due >= CYCLE_COMMISSION_DUE

    needs_payment_reminder = False
    if is_blocked:
        if not last_reminder_sent:
            needs_payment_reminder = True
        else:
            needs_payment_reminder = (now - last_reminder_sent) >= REMINDER_INTERVAL

    credit_remaining = _coerce_int(credit.get("credit_remaining"), MISSIONS_PER_CYCLE)
    credit_max = _coerce_int(credit.get("credit_max"), MISSIONS_PER_CYCLE)
    missions_completed = max(0, credit_max - credit_remaining)

    suspension_message = _build_suspension_message(commission_due) if is_blocked else None

    return {
        "artisan_id": artisan_id,
        "level": "fixed",  # compat legacy
        "level_name": "Plan fixe",
        "credit_remaining": credit_remaining,
        "credit_max": credit_max,
        "missions_completed_in_cycle": missions_completed,
        "missions_remaining_in_cycle": credit_remaining,
        "commission_due": commission_due,
        "commission_per_mission": COMMISSION_PER_MISSION,
        "commission_rate_percent": f"{_format_fcfa(COMMISSION_PER_MISSION)} FCFA / mission",
        "commission_model": "fixed_per_mission",
        "cycle_commission_due": CYCLE_COMMISSION_DUE,
        "is_blocked": is_blocked,
        "can_accept_mission": commission_due < CYCLE_COMMISSION_DUE and not is_blocked,
        "blocked_since": blocked_since,
        "last_reminder_sent": last_reminder_sent,
        "needs_payment_reminder": needs_payment_reminder,
        "suspension_message": suspension_message,
        "pay_button_label": (
            f"Regler ma commission ({_format_fcfa(commission_due)} FCFA)"
            if is_blocked
            else None
        ),
        "total_earned": float(credit.get("total_earned", 0.0)),
        "total_paid": float(credit.get("total_paid", 0.0)),
        "last_payment_at": credit.get("last_payment_at"),
        "next_level": None,
        "next_level_name": None,
        "missions_to_next_level": None,
    }
