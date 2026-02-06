"""
Payment routes -- escrow-based payment flow.

POST /api/payments/initiate   -- Create payment intent (client)
POST /api/payments/webhook     -- Receive provider webhook (no auth, signature-verified)
GET  /api/payments/status/{id} -- Get payment status (authenticated)
GET  /api/payments/by-request/{request_id} -- Get payment for a request (authenticated)
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Request

from auth import get_current_user
from payments.adapter import get_payment_adapter
from payments.service import PaymentService
from payments.models import (
    PaymentInitiateRequest,
    PaymentInitiateResponse,
    PaymentStatusResponse,
)
import database as db_module
from bson import ObjectId

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments", tags=["payments"])


def _get_service() -> PaymentService:
    return PaymentService(get_payment_adapter())


@router.post("/initiate", response_model=PaymentInitiateResponse)
async def initiate_payment(
    data: PaymentInitiateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Initiate escrow payment for a service request."""

    # Verify the request exists and belongs to the client
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user_id = str(user["_id"])

    service_req = await db_module.db.service_requests.find_one(
        {"_id": ObjectId(data.request_id)}
    )
    if not service_req:
        raise HTTPException(status_code=404, detail="Service request not found")

    if service_req.get("client_id") != user_id:
        raise HTTPException(status_code=403, detail="Not the client for this request")

    if service_req.get("status") not in ("accepted", "in_progress"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pay for request in status: {service_req.get('status')}",
        )

    artisan_id = service_req.get("assigned_artisan_id") or service_req.get("artisan_id")
    if not artisan_id:
        raise HTTPException(status_code=400, detail="No artisan assigned")

    svc = _get_service()
    result = await svc.initiate_escrow(
        request_id=data.request_id,
        client_id=user_id,
        artisan_id=artisan_id,
        amount=data.amount,
        idempotency_key=data.idempotency_key,
    )

    if result.get("status") == "failed":
        raise HTTPException(status_code=502, detail="Payment provider error")

    return PaymentInitiateResponse(
        payment_intent_id=result["payment_intent_id"],
        checkout_url=result.get("checkout_url"),
        status=result["status"],
        amount=result["amount"],
        commission_amount=result["commission_amount"],
        artisan_payout=result["artisan_payout"],
        provider=result["provider"],
    )


@router.post("/webhook")
async def payment_webhook(request: Request):
    """Receive webhook from payment provider. No JWT auth -- verified via signature."""

    body = await request.body()
    signature = request.headers.get("X-Wave-Signature", "") or request.headers.get("X-Webhook-Signature", "")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    svc = _get_service()
    result = await svc.process_webhook(body, signature, payload)

    if result.get("error"):
        logger.warning(f"Webhook processing error: {result['error']}")
        raise HTTPException(status_code=400, detail=result["error"])

    return {"status": "ok", "payment_intent_id": result.get("payment_intent_id")}


@router.get("/status/{payment_intent_id}")
async def get_payment_status(
    payment_intent_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get payment intent status."""

    svc = _get_service()
    intent = await svc.get_status(payment_intent_id)

    if not intent:
        raise HTTPException(status_code=404, detail="Payment intent not found")

    # Only client, artisan, or admin can view
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    user_id = str(user["_id"]) if user else ""
    if intent.get("client_id") != user_id and intent.get("artisan_id") != user_id:
        if not user.get("admin_role"):
            raise HTTPException(status_code=403, detail="Not authorized")

    return intent


@router.get("/by-request/{request_id}")
async def get_payment_by_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get payment intent for a service request."""

    svc = _get_service()
    intent = await svc.get_by_request(request_id)

    if not intent:
        raise HTTPException(status_code=404, detail="No payment found for this request")

    user = await db_module.db.users.find_one({"email": current_user["email"]})
    user_id = str(user["_id"]) if user else ""
    if intent.get("client_id") != user_id and intent.get("artisan_id") != user_id:
        if not user.get("admin_role"):
            raise HTTPException(status_code=403, detail="Not authorized")

    return intent
