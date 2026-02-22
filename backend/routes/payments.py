"""
Payment routes -- escrow-based payment flow.

POST /api/payments/initiate   -- Create payment intent (client)
POST /api/payments/webhook    -- Receive provider webhook (no auth, signature-verified)
GET  /api/payments/status/{id} -- Get payment status (authenticated)
GET  /api/payments/by-request/{request_id} -- Get payment for a request (authenticated)
"""

from __future__ import annotations

import logging
from functools import lru_cache

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request

import database as db_module
from auth import get_current_user
from payments.adapter import get_payment_adapter
from payments.models import (
    PaymentInitiateRequest,
    PaymentInitiateResponse,
    PaymentRefundResponse,
    PaymentReleaseResponse,
    PaymentStatusResponse,
    WebhookPayload,
)
from payments.service import PaymentService
from models import RequestStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments", tags=["payments"])


@lru_cache(maxsize=1)
def _get_service() -> PaymentService:
    """Singleton service to reuse adapter internals (notably SOAP client cache)."""
    return PaymentService(get_payment_adapter())


def _to_payment_status_response(intent: dict) -> PaymentStatusResponse:
    provider_raw = str(intent.get("provider", "mock")).lower()
    if "paiementpro" in provider_raw:
        provider_value = "paiementpro"
    elif "wave" in provider_raw:
        provider_value = "wave"
    else:
        provider_value = "mock"

    return PaymentStatusResponse(
        payment_intent_id=intent["_id"],
        request_id=intent.get("request_id"),
        status=intent["status"],
        amount=int(intent.get("amount", 0)),
        commission_amount=int(intent.get("commission_amount", 0)),
        artisan_payout=int(intent.get("artisan_payout", 0)),
        provider=provider_value,
        provider_ref=intent.get("provider_ref"),
        payment_type=intent.get("payment_type"),
        payment_channel=intent.get("payment_channel"),
        checkout_url=intent.get("checkout_url"),
        created_at=intent.get("created_at"),
        captured_at=intent.get("captured_at"),
        released_at=intent.get("released_at"),
        refunded_at=intent.get("refunded_at"),
    )


async def _parse_webhook_payload(request: Request) -> dict:
    content_type = (request.headers.get("content-type") or "").lower()

    payload: dict
    if "application/json" in content_type:
        try:
            payload = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc
    else:
        try:
            form_data = await request.form()
            payload = {k: str(v) for k, v in form_data.items()}
        except Exception:
            try:
                payload = await request.json()
            except Exception as exc:
                raise HTTPException(status_code=400, detail="Invalid webhook payload") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    try:
        model = WebhookPayload(**payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid webhook schema: {exc}") from exc

    normalized = model.model_dump(exclude_none=True)
    normalized["raw"] = payload
    return normalized


@router.post("/initiate", response_model=PaymentInitiateResponse)
async def initiate_payment(
    data: PaymentInitiateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Initiate escrow payment for a service request."""

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

    from state_machine import normalize_status

    try:
        req_status = normalize_status(service_req.get("status", ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unknown request status") from exc

    if req_status not in {
        RequestStatus.ACCEPTEE,
        RequestStatus.PAIEMENT_ESCROW,   # idempotent retries
        RequestStatus.MISSION_EN_COURS,  # backward compatibility
    }:
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
        payment_channel=data.payment_channel.value,
    )

    if result.get("status") == "failed":
        detail = result.get("error", "Payment provider error")
        if "greater than fixed commission" in detail:
            raise HTTPException(status_code=400, detail=detail)
        raise HTTPException(status_code=502, detail=detail)

    return PaymentInitiateResponse(
        payment_intent_id=result["payment_intent_id"],
        checkout_url=result.get("checkout_url"),
        status=result["status"],
        amount=result["amount"],
        commission_amount=result["commission_amount"],
        artisan_payout=result["artisan_payout"],
        provider=("paiementpro" if "paiementpro" in str(result["provider"]).lower() else "mock"),
    )


@router.post("/webhook")
async def payment_webhook(request: Request):
    """Receive webhook from provider. No JWT auth -- verified via signature/hashcode."""

    body = await request.body()
    parsed_payload = await _parse_webhook_payload(request)

    header_signature = (
        request.headers.get("X-Wave-Signature")
        or request.headers.get("X-PaiementPro-Signature")
        or request.headers.get("X-Webhook-Signature")
        or ""
    )

    signature = header_signature
    payload_bytes = body

    # PaiementPro hashcode verification is based on merchantId+referenceNumber+amount.
    merchant_id = parsed_payload.get("merchantId")
    reference = parsed_payload.get("referenceNumber")
    amount = parsed_payload.get("amount")
    hashcode = parsed_payload.get("hashcode")
    if merchant_id and reference and amount and hashcode:
        signature = str(hashcode)
        payload_bytes = f"{merchant_id}{reference}{amount}".encode("utf-8")

    svc = _get_service()
    result = await svc.process_webhook(payload_bytes, signature, parsed_payload)

    if result.get("error"):
        logger.warning("Webhook processing error: %s", result["error"])
        raise HTTPException(status_code=400, detail=result["error"])

    # If escrow payment is captured, advance request to PAIEMENT_ESCROW.
    if result.get("status") == "captured":
        try:
            from state_machine import transition

            intent = await svc.get_status(result.get("payment_intent_id"))
            if intent and intent.get("payment_type") == "escrow" and intent.get("request_id"):
                actor_id = intent.get("client_id") or "system"
                actor_role = "client" if intent.get("client_id") else "system"
                await transition(
                    request_id=intent["request_id"],
                    new_status=RequestStatus.PAIEMENT_ESCROW,
                    actor_id=actor_id,
                    actor_role=actor_role,
                    reason="payment_captured_webhook",
                )
        except HTTPException as exc:
            # Ignore transitions that are already outdated/non-applicable.
            if exc.status_code not in (400, 409):
                raise
            logger.info(
                "Skipped request transition after webhook capture: status=%s detail=%s",
                exc.status_code,
                exc.detail,
            )
        except Exception:
            logger.exception("Failed to transition request to paiement_escrow after capture")

    return {
        "status": "ok",
        "payment_intent_id": result.get("payment_intent_id"),
        "processed": result.get("processed", True),
        "duplicate": result.get("duplicate", False),
    }


@router.get("/status/{payment_intent_id}", response_model=PaymentStatusResponse)
async def get_payment_status(
    payment_intent_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get payment intent status."""

    svc = _get_service()
    intent = await svc.get_status(payment_intent_id)

    if not intent:
        raise HTTPException(status_code=404, detail="Payment intent not found")

    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_id = str(user["_id"])
    if intent.get("client_id") != user_id and intent.get("artisan_id") != user_id:
        if not user.get("admin_role"):
            raise HTTPException(status_code=403, detail="Not authorized")

    return _to_payment_status_response(intent)


@router.post("/release/{payment_intent_id}", response_model=PaymentReleaseResponse)
async def release_payment(
    payment_intent_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Release escrow to artisan (client owner or admin)."""

    svc = _get_service()
    intent = await svc.get_status(payment_intent_id)
    if not intent:
        raise HTTPException(status_code=404, detail="Payment intent not found")

    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_id = str(user["_id"])
    if intent.get("client_id") != user_id and not user.get("admin_role"):
        raise HTTPException(status_code=403, detail="Only client owner or admin can release")

    result = await svc.release_to_artisan(payment_intent_id)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return PaymentReleaseResponse(
        payment_intent_id=result["payment_intent_id"],
        status=result["status"],
        artisan_payout=int(result.get("artisan_payout", 0)),
        commission_amount=int(result.get("commission_amount", 0)),
        duplicate=bool(result.get("duplicate", False)),
        credit=result.get("credit"),
    )


@router.post("/refund/{payment_intent_id}", response_model=PaymentRefundResponse)
async def refund_payment(
    payment_intent_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Rembourser un paiement capture (admin uniquement)."""

    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user or not user.get("admin_role"):
        raise HTTPException(status_code=403, detail="Admin access required")

    svc = _get_service()
    result = await svc.refund_payment(payment_intent_id)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return PaymentRefundResponse(
        payment_intent_id=result["payment_intent_id"],
        status=result["status"],
        amount=int(result["amount"]),
        duplicate=bool(result.get("duplicate", False)),
    )


@router.get("/by-request/{request_id}", response_model=PaymentStatusResponse)
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
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_id = str(user["_id"])
    if intent.get("client_id") != user_id and intent.get("artisan_id") != user_id:
        if not user.get("admin_role"):
            raise HTTPException(status_code=403, detail="Not authorized")

    return _to_payment_status_response(intent)
