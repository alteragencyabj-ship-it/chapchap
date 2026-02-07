"""
Payment Service -- orchestrates escrow flow.

Flow:
1. Client initiates payment after artisan accepts request.
2. Adapter calls provider -> returns checkout_url.
3. Client pays -> provider sends webhook -> status becomes "captured".
4. Client confirms service -> release_to_artisan() is called.
5. Commission fixe est appliquee une seule fois.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Dict, Optional

from bson import ObjectId

import credit_system
import database as db_module
from payments.adapter import PaymentAdapter

logger = logging.getLogger(__name__)


TERMINAL_WEBHOOK_STATUSES = {"captured", "released", "refunded"}


class PaymentService:
    def __init__(self, adapter: PaymentAdapter) -> None:
        self.adapter = adapter

    @staticmethod
    def _now_utc() -> datetime:
        return datetime.now(UTC)

    async def initiate_escrow(
        self,
        request_id: str,
        client_id: str,
        artisan_id: str,
        amount: int,
        idempotency_key: str,
        payment_channel: str = "all",
    ) -> Dict[str, Any]:
        """Create an escrow payment intent and call the provider."""

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

        commission_amount = int(credit_system.COMMISSION_PER_MISSION)
        if amount <= commission_amount:
            return {
                "status": "failed",
                "error": f"Amount must be greater than fixed commission ({commission_amount} XOF)",
                "amount": amount,
                "commission_amount": commission_amount,
                "artisan_payout": 0,
                "provider": self._provider_name(),
            }

        artisan_payout = amount - commission_amount
        payment_channel_value = str(payment_channel or "all")

        now = self._now_utc()
        intent_doc = {
            "request_id": request_id,
            "client_id": client_id,
            "artisan_id": artisan_id,
            "amount": amount,
            "currency": "XOF",
            "commission_type": "fixed",
            "commission_per_mission": commission_amount,
            "commission_amount": commission_amount,
            "artisan_payout": artisan_payout,
            "status": "pending",
            "provider": self._provider_name(),
            "provider_ref": None,
            "checkout_url": None,
            "idempotency_key": idempotency_key,
            "payment_channel": payment_channel_value,
            "payment_type": "escrow",
            "metadata": {
                "channel": payment_channel_value,
                "payment_channel": payment_channel_value,
                "payment_type": "escrow",
            },
            "created_at": now,
            "updated_at": now,
        }

        result = await db_module.db.payment_intents.insert_one(intent_doc)
        intent_id = str(result.inserted_id)

        adapter_result = await self.adapter.initiate_payment(
            amount=amount,
            currency="XOF",
            description=f"Servicio mission {request_id}",
            idempotency_key=idempotency_key,
            metadata={"channel": payment_channel_value},
        )

        new_status = adapter_result.get("status", "failed")
        update_fields = {
            "provider_ref": adapter_result.get("provider_ref"),
            "checkout_url": adapter_result.get("checkout_url"),
            "status": new_status,
            "updated_at": self._now_utc(),
        }

        await db_module.db.payment_intents.update_one(
            {"_id": ObjectId(intent_id)},
            {"$set": update_fields},
        )

        await self._log_event(intent_id, "initiated", adapter_result)

        return {
            "payment_intent_id": intent_id,
            "checkout_url": adapter_result.get("checkout_url"),
            "status": new_status,
            "amount": amount,
            "commission_amount": commission_amount,
            "artisan_payout": artisan_payout,
            "provider": self._provider_name(),
            "error": adapter_result.get("error"),
        }

    async def initiate_commission_payment(
        self,
        artisan_id: str,
        amount: int,
        idempotency_key: Optional[str] = None,
        payment_channel: str = "all",
    ) -> Dict[str, Any]:
        """Create a dedicated payment intent to settle blocked artisan commission."""

        if amount <= 0:
            return {
                "status": "failed",
                "error": "Invalid commission amount",
            }

        idem = idempotency_key or f"commission-{artisan_id}-{uuid.uuid4().hex[:12]}"
        payment_channel_value = str(payment_channel or "all")

        existing = await db_module.db.payment_intents.find_one({"idempotency_key": idem})
        if existing:
            existing["_id"] = str(existing["_id"])
            return {
                "payment_intent_id": existing["_id"],
                "checkout_url": existing.get("checkout_url"),
                "status": existing["status"],
                "amount": existing.get("amount", amount),
                "provider": existing.get("provider", self._provider_name()),
                "duplicate": True,
            }

        now = self._now_utc()
        intent_doc = {
            "request_id": None,
            "client_id": None,
            "artisan_id": artisan_id,
            "amount": amount,
            "currency": "XOF",
            "commission_type": "cycle_settlement",
            "commission_per_mission": credit_system.COMMISSION_PER_MISSION,
            "commission_amount": amount,
            "artisan_payout": 0,
            "status": "pending",
            "provider": self._provider_name(),
            "provider_ref": None,
            "checkout_url": None,
            "idempotency_key": idem,
            "payment_channel": payment_channel_value,
            "payment_type": "commission_payment",
            "metadata": {
                "channel": payment_channel_value,
                "payment_channel": payment_channel_value,
                "payment_type": "commission_payment",
            },
            "created_at": now,
            "updated_at": now,
        }

        result = await db_module.db.payment_intents.insert_one(intent_doc)
        intent_id = str(result.inserted_id)

        adapter_result = await self.adapter.initiate_payment(
            amount=amount,
            currency="XOF",
            description=f"Reglement commission artisan {artisan_id}",
            idempotency_key=idem,
            metadata={"channel": payment_channel_value},
        )

        new_status = adapter_result.get("status", "failed")
        await db_module.db.payment_intents.update_one(
            {"_id": ObjectId(intent_id)},
            {
                "$set": {
                    "provider_ref": adapter_result.get("provider_ref"),
                    "checkout_url": adapter_result.get("checkout_url"),
                    "status": new_status,
                    "updated_at": self._now_utc(),
                }
            },
        )

        await self._log_event(intent_id, "commission_payment_initiated", adapter_result)

        return {
            "payment_intent_id": intent_id,
            "checkout_url": adapter_result.get("checkout_url"),
            "status": new_status,
            "amount": amount,
            "provider": self._provider_name(),
            "error": adapter_result.get("error"),
        }

    async def process_webhook(
        self,
        payload_bytes: bytes,
        signature: str,
        parsed_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Process incoming webhook from provider."""

        if not self.adapter.verify_webhook_signature(payload_bytes, signature, parsed_payload):
            logger.warning("Webhook signature verification failed")
            return {"error": "Invalid signature", "processed": False}

        provider_ref = self._extract_provider_ref(parsed_payload)
        if not provider_ref:
            logger.warning("Webhook missing provider reference")
            return {"error": "Missing provider reference", "processed": False}

        intent = await db_module.db.payment_intents.find_one({"provider_ref": provider_ref})
        if not intent:
            logger.warning("No payment intent found for provider_ref=%s", provider_ref)
            return {"error": "Unknown payment", "processed": False}

        intent_id = str(intent["_id"])

        current_status = intent.get("status", "pending")
        if current_status in TERMINAL_WEBHOOK_STATUSES:
            await self._log_event(
                intent_id,
                "webhook_duplicate",
                {
                    "raw_payload": parsed_payload,
                    "status": current_status,
                },
            )
            return {
                "payment_intent_id": intent_id,
                "status": current_status,
                "processed": True,
                "duplicate": True,
            }

        new_status = await self._resolve_webhook_status(provider_ref, parsed_payload)

        now = self._now_utc()
        update_fields: Dict[str, Any] = {
            "status": new_status,
            "updated_at": now,
            "last_webhook_payload": parsed_payload,
        }
        if new_status == "captured":
            update_fields["captured_at"] = now
        elif new_status == "failed":
            update_fields["failed_at"] = now

        await db_module.db.payment_intents.update_one(
            {"_id": intent["_id"]},
            {"$set": update_fields},
        )

        extra: Dict[str, Any] = {}
        if new_status == "captured" and intent.get("payment_type") == "commission_payment":
            commission_result = await credit_system.pay_commission(
                artisan_id=intent["artisan_id"],
                amount=float(intent.get("amount", 0)),
                payment_method=intent.get("payment_channel", "paiementpro"),
                transaction_id=provider_ref,
            )
            extra["commission_result"] = commission_result
            await self._log_event(intent_id, "commission_payment_applied", commission_result)

        await self._log_event(
            intent_id,
            "webhook_received",
            {
                "raw_payload": parsed_payload,
                "resolved_status": new_status,
                **extra,
            },
        )

        return {
            "payment_intent_id": intent_id,
            "status": new_status,
            "processed": True,
            **extra,
        }

    async def release_to_artisan(self, payment_intent_id: str) -> Dict[str, Any]:
        """Release escrowed funds to artisan after client confirmation."""

        intent = await db_module.db.payment_intents.find_one(
            {"_id": ObjectId(payment_intent_id)}
        )
        if not intent:
            return {"error": "Payment intent not found"}

        if intent["status"] == "released":
            return {
                "payment_intent_id": payment_intent_id,
                "status": "released",
                "artisan_payout": intent.get("artisan_payout", 0),
                "commission_amount": intent.get("commission_amount", 0),
                "duplicate": True,
            }

        if intent["status"] != "captured":
            return {"error": f"Cannot release: status is {intent['status']}, expected captured"}

        now = self._now_utc()
        await db_module.db.payment_intents.update_one(
            {"_id": intent["_id"]},
            {"$set": {"status": "released", "released_at": now, "updated_at": now}},
        )

        await self._log_event(
            str(intent["_id"]),
            "released",
            {
                "artisan_payout": intent.get("artisan_payout", 0),
                "commission_amount": intent.get("commission_amount", 0),
            },
        )

        credit_result: Dict[str, Any] = {}
        try:
            # Important: pass gross amount. Commission fixe is handled inside credit_system.
            credit_result = await credit_system.consume_credit(
                intent["artisan_id"],
                intent.get("request_id") or payment_intent_id,
                float(intent.get("amount", 0)),
            )
            await self._log_event(str(intent["_id"]), "credit_consumed", credit_result)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Erreur lors de la consommation de credit: %s", exc)
            await self._log_event(
                str(intent["_id"]),
                "credit_consume_error",
                {"error": str(exc)},
            )

        return {
            "payment_intent_id": payment_intent_id,
            "status": "released",
            "artisan_payout": intent.get("artisan_payout", 0),
            "commission_amount": intent.get("commission_amount", 0),
            "credit": credit_result,
        }

    async def refund_payment(self, payment_intent_id: str) -> Dict[str, Any]:
        """Rembourser un paiement capture."""

        intent = await db_module.db.payment_intents.find_one(
            {"_id": ObjectId(payment_intent_id)}
        )
        if not intent:
            return {"error": "Payment intent not found"}

        if intent["status"] == "refunded":
            return {
                "payment_intent_id": payment_intent_id,
                "status": "refunded",
                "amount": intent.get("amount", 0),
                "duplicate": True,
            }

        if intent["status"] != "captured":
            return {"error": f"Cannot refund: status is {intent['status']}, expected captured"}

        now = self._now_utc()
        await db_module.db.payment_intents.update_one(
            {"_id": intent["_id"]},
            {"$set": {"status": "refunded", "refunded_at": now, "updated_at": now}},
        )

        await self._log_event(
            str(intent["_id"]),
            "refunded",
            {
                "amount": intent["amount"],
                "refunded_at": now.isoformat(),
            },
        )

        return {
            "payment_intent_id": payment_intent_id,
            "status": "refunded",
            "amount": intent["amount"],
        }

    async def get_status(self, payment_intent_id: str) -> Optional[Dict[str, Any]]:
        """Get current payment intent status."""

        intent = await db_module.db.payment_intents.find_one(
            {"_id": ObjectId(payment_intent_id)}
        )
        if not intent:
            return None

        intent["_id"] = str(intent["_id"])
        for dt_field in (
            "created_at",
            "updated_at",
            "captured_at",
            "released_at",
            "refunded_at",
            "failed_at",
        ):
            if intent.get(dt_field) and isinstance(intent[dt_field], datetime):
                intent[dt_field] = intent[dt_field].isoformat()

        return intent

    async def get_by_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        """Find payment intent for a service request."""

        intent = await db_module.db.payment_intents.find_one(
            {"request_id": request_id},
            sort=[("created_at", -1)],
        )
        if intent:
            intent["_id"] = str(intent["_id"])
            for dt_field in (
                "created_at",
                "updated_at",
                "captured_at",
                "released_at",
                "refunded_at",
                "failed_at",
            ):
                if intent.get(dt_field) and isinstance(intent[dt_field], datetime):
                    intent[dt_field] = intent[dt_field].isoformat()
        return intent

    async def _resolve_webhook_status(
        self,
        provider_ref: str,
        parsed_payload: Dict[str, Any],
    ) -> str:
        response_code = parsed_payload.get("responsecode")
        if response_code is not None:
            rc = str(response_code).strip()
            if rc == "0":
                return "captured"
            if rc == "-1":
                return "failed"

        status = str(parsed_payload.get("status", "")).strip().lower()
        if status in {"captured", "paid", "success", "succeeded", "completed"}:
            return "captured"
        if status in {"failed", "error", "cancelled", "canceled"}:
            return "failed"

        event_name = str(parsed_payload.get("event", "")).strip().lower()
        if event_name in {
            "checkout.session.completed",
            "payment.succeeded",
            "payment_intent.succeeded",
            "captured",
        }:
            return "captured"
        if event_name in {
            "checkout.session.expired",
            "payment.failed",
            "payment_intent.payment_failed",
            "failed",
        }:
            return "failed"

        status_result = await self.adapter.check_status(provider_ref)
        return status_result.get("status", "pending")

    @staticmethod
    def _extract_provider_ref(parsed_payload: Dict[str, Any]) -> str:
        return (
            str(parsed_payload.get("referenceNumber") or "").strip()
            or str(parsed_payload.get("id") or "").strip()
            or str(parsed_payload.get("provider_ref") or "").strip()
        )

    def _provider_name(self) -> str:
        adapter_name = type(self.adapter).__name__.lower()
        if "paiementpro" in adapter_name:
            return "paiementpro"
        if "mock" in adapter_name:
            return "mock"
        return "mock"

    async def _log_event(self, intent_id: str, event_type: str, data: Dict[str, Any]) -> None:
        await db_module.db.payment_events.insert_one(
            {
                "payment_intent_id": intent_id,
                "event_type": event_type,
                "data": data,
                "created_at": self._now_utc(),
            }
        )
