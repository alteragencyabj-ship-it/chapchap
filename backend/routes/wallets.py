"""
Wallet routes
=============
Dedicated wallet read/repay endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId

import credit_system
import database as db_module
from auth import get_current_user
from wallet_service import repay_wallet

router = APIRouter(prefix="/api/wallets", tags=["wallets"])


class WalletRepayRequest(BaseModel):
    amount: int = Field(default=10000)
    paymentId: str


async def _get_user(current_user: dict) -> dict:
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return user


@router.get("/{artisan_id}")
async def get_wallet(artisan_id: str, current_user: dict = Depends(get_current_user)):
    """Return up-to-date wallet for an artisan."""
    user = await _get_user(current_user)
    if user["role"] != "admin" and user["_id"] != artisan_id:
        raise HTTPException(status_code=403, detail="Access denied")

    status = await credit_system.get_credit_status(artisan_id)
    return {
        "artisanId": artisan_id,
        "commission_due": status.get("commission_due", 0),
        "credits": status.get("credit_remaining", 0),
        "earnings": status.get("total_earned", 0.0),
        "isBlocked": status.get("is_blocked", False),
        "raw": status,
    }


@router.post("/{artisan_id}/repay")
async def repay_wallet_endpoint(
    artisan_id: str,
    payload: WalletRepayRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Repay one credit cycle (10 000 FCFA).
    Idempotence key is `paymentId` (stored in wallet_transactions).
    """
    user = await _get_user(current_user)
    if user["role"] != "admin" and user["_id"] != artisan_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if not ObjectId.is_valid(artisan_id):
        raise HTTPException(status_code=400, detail="artisan_id invalide")

    try:
        result = await repay_wallet(artisan_id=artisan_id, amount=payload.amount, payment_id=payload.paymentId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    status = await credit_system.get_credit_status(artisan_id)
    return {
        "result": result,
        "wallet": {
            "artisanId": artisan_id,
            "commission_due": status.get("commission_due", 0),
            "credits": status.get("credit_remaining", 0),
            "earnings": status.get("total_earned", 0.0),
            "isBlocked": status.get("is_blocked", False),
        },
    }
