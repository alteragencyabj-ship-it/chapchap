"""
Payment Service -- orchestrates escrow flow.

Flow:
1. Client initiates payment after artisan accepts request.
2. Adapter calls provider -> returns checkout_url.
3. Client pays -> provider sends webhook -> status becomes "captured".
4. Client confirms service -> release_to_artisan() is called.
5. Commission is deducted, artisan gets payout.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from bson import ObjectId

import database as db_module
import credit_system
from payments.adapter import PaymentAdapter

logger = logging.getLogger(__name__)


class PaymentService:
    def __init__(self, adapter: PaymentAdapter) -> None:
        self.adapter = adapter

    async def initiate_escrow(
        self,
        request_id: str,
        client_id: str,
        artisan_id: str,
        amount: int,
        idempotency_key: str,
    ) -> Dict[str, Any]:
        """Create a payment intent and call the provider."""

        # Idempotency check
        existing = await db_module.db.payment_intents.find_one(
            {"idempotency_key": idempotency_key}
        )
        if existing:
            existing["_id"] = str(existing["_id"])
            return {
                "payment_intent_id": existing["_id"],
                "checkout_url": existing.get("checkout_url"),
                "status": existing["status"],
                "amount": existing["amount"],
                "commission_amount": existing.get("commission_amount", 0),
                "artisan_payout": existing.get("artisan_payout", 0),
                "provider": existing.get("provider", "mock"),
                "duplicate": True,
            }

        # Calculate commission from artisan's credit level
        credit = await credit_system.get_or_create_credit(artisan_id)
        level = credit.get("level", "bronze")
        commission_rates = {"bronze": 0.15, "silver": 0.12, "gold": 0.10, "diamond": 0.08}
        rate = commission_rates.get(level, 0.15)
        commission_amount = int(amount * rate)
        artisan_payout = amount - commission_amount

        # Create payment intent in DB
        now = datetime.utcnow()
        intent_doc = {
            "request_id": request_id,
            "client_id": client_id,
            "artisan_id": artisan_id,
            "amount": amount,
            "currency": "XOF",
            "commission_rate": rate,
            "commission_amount": commission_amount,
            "artisan_payout": artisan_payout,
            "status": "pending",
            "provider": self._provider_name(),
            "provider_ref": None,
            "checkout_url": None,
            "idempotency_key": idempotency_key,
            "metadata": {},
            "created_at": now,
            "updated_at": now,
        }

        result = await db_module.db.payment_intents.insert_one(intent_doc)
        intent_id = str(result.inserted_id)

        # Call provider
        adapter_result = await self.adapter.initiate_payment(
            amount=amount,
            currency="XOF",
            description=f"ChapChap service #{request_id}",
            idempotency_key=idempotency_key,
        )

        new_status = adapter_result.get("status", "failed")
        update_fields = {
            "provider_ref": adapter_result.get("provider_ref"),
            "checkout_url": adapter_result.get("checkout_url"),
            "status": new_status,
            "updated_at": datetime.utcnow(),
        }

        await db_module.db.payment_intents.update_one(
            {"_id": ObjectId(intent_id)}, {"$set": update_fields}
        )

        # Log event
        await self._log_event(intent_id, "initiated", adapter_result)

        return {
            "payment_intent_id": intent_id,
            "checkout_url": adapter_result.get("checkout_url"),
            "status": new_status,
            "amount": amount,
            "commission_amount": commission_amount,
            "artisan_payout": artisan_payout,
            "provider": self._provider_name(),
        }

    async def process_webhook(
        self, payload_bytes: bytes, signature: str, parsed_payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process incoming webhook from provider."""

        # Verify signature
        if not self.adapter.verify_webhook_signature(payload_bytes, signature):
            logger.warning("Webhook signature verification failed")
            return {"error": "Invalid signature", "processed": False}

        provider_ref = parsed_payload.get("id") or parsed_payload.get("provider_ref", "")

        # Find payment intent
        intent = await db_module.db.payment_intents.find_one(
            {"provider_ref": provider_ref}
        )
        if not intent:
            logger.warning(f"No payment intent found for provider_ref={provider_ref}")
            return {"error": "Unknown payment", "processed": False}

        intent_id = str(intent["_id"])

        # Check adapter for real status
        status_result = await self.adapter.check_status(provider_ref)
        new_status = status_result.get("status", "initiated")

        update_fields: Dict[str, Any] = {
            "status": new_status,
            "updated_at": datetime.utcnow(),
        }
        if new_status == "captured":
            update_fields["captured_at"] = datetime.utcnow()

        await db_module.db.payment_intents.update_one(
            {"_id": intent["_id"]}, {"$set": update_fields}
        )

        # Log event
        await self._log_event(intent_id, "webhook_received", {
            "raw_payload": parsed_payload,
            "resolved_status": new_status,
        })

        return {
            "payment_intent_id": intent_id,
            "status": new_status,
            "processed": True,
        }

    async def release_to_artisan(self, payment_intent_id: str) -> Dict[str, Any]:
        """Release escrowed funds to artisan after client confirmation."""

        intent = await db_module.db.payment_intents.find_one(
            {"_id": ObjectId(payment_intent_id)}
        )
        if not intent:
            return {"error": "Payment intent not found"}

        if intent["status"] != "captured":
            return {"error": f"Cannot release: status is {intent['status']}, expected captured"}

        now = datetime.utcnow()
        await db_module.db.payment_intents.update_one(
            {"_id": intent["_id"]},
            {"$set": {"status": "released", "released_at": now, "updated_at": now}},
        )

        await self._log_event(str(intent["_id"]), "released", {
            "artisan_payout": intent["artisan_payout"],
            "commission_amount": intent["commission_amount"],
        })

        return {
            "payment_intent_id": payment_intent_id,
            "status": "released",
            "artisan_payout": intent["artisan_payout"],
            "commission_amount": intent["commission_amount"],
        }

    async def get_status(self, payment_intent_id: str) -> Optional[Dict[str, Any]]:
        """Get current payment intent status."""

        intent = await db_module.db.payment_intents.find_one(
            {"_id": ObjectId(payment_intent_id)}
        )
        if not intent:
            return None

        intent["_id"] = str(intent["_id"])
        for dt_field in ("created_at", "updated_at", "captured_at", "released_at"):
            if intent.get(dt_field) and isinstance(intent[dt_field], datetime):
                intent[dt_field] = intent[dt_field].isoformat()

        return intent

    async def get_by_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        """Find payment intent for a service request."""

        intent = await db_module.db.payment_intents.find_one(
            {"request_id": request_id}, sort=[("created_at", -1)]
        )
        if intent:
            intent["_id"] = str(intent["_id"])
            for dt_field in ("created_at", "updated_at", "captured_at", "released_at"):
                if intent.get(dt_field) and isinstance(intent[dt_field], datetime):
                    intent[dt_field] = intent[dt_field].isoformat()
        return intent

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _provider_name(self) -> str:
        return type(self.adapter).__name__.replace("PaymentAdapter", "").lower() or "mock"

    async def _log_event(
        self, intent_id: str, event_type: str, data: Dict[str, Any]
    ) -> None:
        await db_module.db.payment_events.insert_one({
            "payment_intent_id": intent_id,
            "event_type": event_type,
            "data": data,
            "created_at": datetime.utcnow(),
        })
