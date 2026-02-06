"""
Payment provider adapters.

Each adapter implements the same interface so the service layer
is provider-agnostic. Add new providers by subclassing PaymentAdapter.

Currently implemented:
- MockPaymentAdapter: deterministic responses for dev/test (no credentials needed)
- WavePaymentAdapter: Wave CI production adapter (requires WAVE_API_KEY)
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class PaymentAdapter(ABC):
    """Base class for all payment provider adapters."""

    @abstractmethod
    async def initiate_payment(
        self,
        amount: int,
        currency: str,
        description: str,
        idempotency_key: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Start a payment. Returns {provider_ref, checkout_url, status}."""

    @abstractmethod
    async def check_status(self, provider_ref: str) -> Dict[str, Any]:
        """Query provider for payment status. Returns {status, raw}."""

    @abstractmethod
    def verify_webhook_signature(
        self, payload_bytes: bytes, signature: str
    ) -> bool:
        """Verify that the webhook payload was signed by the provider."""


# ---------------------------------------------------------------------------
# Mock adapter -- deterministic, no network, no credentials
# ---------------------------------------------------------------------------

class MockPaymentAdapter(PaymentAdapter):
    """Mock adapter for local dev and automated tests.

    Special behaviours:
    - idempotency_key starting with "fail-" triggers a failure.
    - All other calls succeed immediately.
    """

    MOCK_SECRET = "mock-webhook-secret"

    async def initiate_payment(
        self,
        amount: int,
        currency: str,
        description: str,
        idempotency_key: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if idempotency_key.startswith("fail-"):
            return {
                "provider_ref": f"mock_fail_{uuid.uuid4().hex[:8]}",
                "checkout_url": None,
                "status": "failed",
                "error": "Simulated failure for testing",
            }

        ref = f"mock_{uuid.uuid4().hex[:12]}"
        return {
            "provider_ref": ref,
            "checkout_url": f"https://mock-pay.chapchap.local/checkout/{ref}",
            "status": "initiated",
        }

    async def check_status(self, provider_ref: str) -> Dict[str, Any]:
        if "fail" in provider_ref:
            return {"status": "failed", "raw": {"provider_ref": provider_ref}}
        return {"status": "captured", "raw": {"provider_ref": provider_ref}}

    def verify_webhook_signature(
        self, payload_bytes: bytes, signature: str
    ) -> bool:
        expected = hmac.new(
            self.MOCK_SECRET.encode(), payload_bytes, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# Wave CI adapter -- real provider (credentials required)
# ---------------------------------------------------------------------------

class WavePaymentAdapter(PaymentAdapter):
    """Wave CI payment adapter.

    Required env vars:
    - WAVE_API_KEY
    - WAVE_WEBHOOK_SECRET

    Wave API docs: https://docs.wave.com/
    """

    def __init__(self) -> None:
        self.api_key = os.getenv("WAVE_API_KEY", "")
        self.webhook_secret = os.getenv("WAVE_WEBHOOK_SECRET", "")
        self.base_url = os.getenv("WAVE_API_URL", "https://api.wave.com/v1")
        if not self.api_key:
            logger.warning("WAVE_API_KEY not set -- Wave payments will fail")

    async def initiate_payment(
        self,
        amount: int,
        currency: str,
        description: str,
        idempotency_key: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        import httpx

        payload = {
            "amount": str(amount),
            "currency": currency,
            "error_url": metadata.get("error_url", "") if metadata else "",
            "success_url": metadata.get("success_url", "") if metadata else "",
            "client_reference": idempotency_key,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.base_url}/checkout/sessions",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Idempotency-Key": idempotency_key,
                    },
                )
                data = resp.json()
                if resp.status_code in (200, 201):
                    return {
                        "provider_ref": data.get("id", ""),
                        "checkout_url": data.get("wave_launch_url", ""),
                        "status": "initiated",
                    }
                else:
                    logger.error(f"Wave initiate failed: {resp.status_code} {data}")
                    return {
                        "provider_ref": "",
                        "checkout_url": None,
                        "status": "failed",
                        "error": data.get("message", "Unknown Wave error"),
                    }
        except Exception as e:
            logger.exception("Wave API call failed")
            return {"provider_ref": "", "checkout_url": None, "status": "failed", "error": str(e)}

    async def check_status(self, provider_ref: str) -> Dict[str, Any]:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{self.base_url}/checkout/sessions/{provider_ref}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                data = resp.json()
                wave_status = data.get("payment_status", "unknown")
                status_map = {
                    "succeeded": "captured",
                    "pending": "initiated",
                    "failed": "failed",
                    "cancelled": "failed",
                }
                return {
                    "status": status_map.get(wave_status, "initiated"),
                    "raw": data,
                }
        except Exception as e:
            logger.exception("Wave status check failed")
            return {"status": "unknown", "raw": {"error": str(e)}}

    def verify_webhook_signature(
        self, payload_bytes: bytes, signature: str
    ) -> bool:
        if not self.webhook_secret:
            logger.error("WAVE_WEBHOOK_SECRET not configured")
            return False
        expected = hmac.new(
            self.webhook_secret.encode(), payload_bytes, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_payment_adapter() -> PaymentAdapter:
    """Return the appropriate adapter based on PAYMENT_PROVIDER env var."""
    provider = os.getenv("PAYMENT_PROVIDER", "mock").lower()
    if provider == "wave":
        return WavePaymentAdapter()
    return MockPaymentAdapter()
