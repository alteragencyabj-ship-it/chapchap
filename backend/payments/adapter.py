"""
Payment provider adapters.

Each adapter implements the same interface so the service layer
is provider-agnostic. Add new providers by subclassing PaymentAdapter.

Currently implemented:
- MockPaymentAdapter: deterministic responses for dev/test (no credentials needed)
- PaiementProAdapter: PaiementPro.net SOAP API v1.3 (Wave, Orange Money, MTN, Moov, Visa/MC)
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
        self,
        payload_bytes: bytes,
        signature: str,
        parsed_payload: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Verify that the webhook payload was signed by the provider."""


# ---------------------------------------------------------------------------
# Mock adapter -- deterministic, no network, no credentials
# ---------------------------------------------------------------------------

class MockPaymentAdapter(PaymentAdapter):
    """Mock adapter for local dev and automated tests."""

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
            "checkout_url": f"https://mock-pay.artisan.local/checkout/{ref}",
            "status": "initiated",
        }

    async def check_status(self, provider_ref: str) -> Dict[str, Any]:
        if "fail" in provider_ref:
            return {"status": "failed", "raw": {"provider_ref": provider_ref}}
        return {"status": "captured", "raw": {"provider_ref": provider_ref}}

    def verify_webhook_signature(
        self,
        payload_bytes: bytes,
        signature: str,
        parsed_payload: Optional[Dict[str, Any]] = None,
    ) -> bool:
        expected = hmac.HMAC(
            self.MOCK_SECRET.encode(), payload_bytes, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# PaiementPro adapter -- SOAP API v1.3 via zeep
# ---------------------------------------------------------------------------

class PaiementProAdapter(PaymentAdapter):
    """PaiementPro.net SOAP-based payment adapter (API v1.3).

    Flow:
    1. Call initTransact() via SOAP → get sessionid
    2. Redirect user to processing page with sessionid
    3. PaiementPro POSTs notification to notificationURL

    Supports: Orange Money, MTN, Moov, Visa/MC, PayPal.
    Supports: Wave, Orange Money, MTN, Moov, Visa/MC, PayPal.

    Required env vars:
    - PAIEMENTPRO_MERCHANT_ID  (e.g. "PP-F6917")
    - PAIEMENTPRO_WEBHOOK_SECRET  (for HMAC-SHA256 hashcode signing/verification)

    Optional:
    - PAIEMENTPRO_WSDL_URL  (default: production WSDL)
    - PAIEMENTPRO_CURRENCY_CODE  (default: "952" for CFA)
    """

    WSDL_URL = "https://www.paiementpro.net/webservice/OnlineServicePayment_v2.php?wsdl"
    CHECKOUT_BASE = "https://www.paiementpro.net/webservice/onlinepayment/processing_v2.php"

    # Map our internal channel names → PaiementPro channel codes
    CHANNEL_MAP: Dict[str, str] = {
        "wave": "WAVE",
        "orange_money": "OM CIV2",
        "mtn": "MOMO",
        "visa": "CARD",
        "mastercard": "CARD",
        "moov": "FLOOZ",
        "paypal": "PAYPAL",
        "all": "",  # empty = user chooses on PP page
    }

    # Channels we explicitly don't support (none currently)
    UNSUPPORTED_CHANNELS: set = set()

    def __init__(self) -> None:
        self.merchant_id = os.getenv("PAIEMENTPRO_MERCHANT_ID", "")
        self.webhook_secret = os.getenv("PAIEMENTPRO_WEBHOOK_SECRET", "")
        self.wsdl_url = os.getenv("PAIEMENTPRO_WSDL_URL", self.WSDL_URL)
        self.currency_code = os.getenv("PAIEMENTPRO_CURRENCY_CODE", "952")
        self._soap_client = None  # lazy-init

        if not self.merchant_id:
            logger.warning(
                "PAIEMENTPRO_MERCHANT_ID not set — payments will fail"
            )

    def _get_soap_client(self):
        """Lazily create the zeep SOAP client."""
        if self._soap_client is None:
            from zeep import Client
            from zeep.transports import Transport
            from requests import Session

            session = Session()
            session.timeout = 30
            transport = Transport(session=session)
            self._soap_client = Client(wsdl=self.wsdl_url, transport=transport)
        return self._soap_client

    def _generate_hashcode(self, merchant_id: str, reference: str, amount: str) -> str:
        """Generate HMAC-SHA256 hashcode for initTransact / verification."""
        if not self.webhook_secret:
            return ""
        message = f"{merchant_id}{reference}{amount}"
        return hmac.HMAC(
            self.webhook_secret.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    async def initiate_payment(
        self,
        amount: int,
        currency: str,
        description: str,
        idempotency_key: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        import asyncio

        metadata = metadata or {}

        # Determine channel
        channel_key = metadata.get("channel", metadata.get("payment_channel", "all")).lower()
        if channel_key in self.UNSUPPORTED_CHANNELS:
            return {
                "provider_ref": "",
                "checkout_url": None,
                "status": "failed",
                "error": f"Channel '{channel_key}' is not supported by PaiementPro. Use a dedicated adapter.",
            }
        channel = self.CHANNEL_MAP.get(channel_key, "")

        # Build reference
        reference = idempotency_key or uuid.uuid4().hex

        # Required customer fields
        customer_email = metadata.get("customer_email", "")
        customer_first_name = metadata.get("customer_first_name", "")
        customer_last_name = metadata.get("customer_last_name", "")
        customer_phone = metadata.get("customer_phone", "")

        # Callback URLs
        notify_url = metadata.get("notify_url", "")
        return_url = metadata.get("return_url", "")
        return_context = metadata.get("return_context", "")
        customer_id = metadata.get("customer_id", "")

        amount_str = str(amount)
        hashcode = self._generate_hashcode(self.merchant_id, reference, amount_str)

        soap_params = {
            "merchantId": self.merchant_id,
            "countryCurrencyCode": self.currency_code,
            "referenceNumber": reference,
            "amount": amount_str,
            "channel": channel,
            "customerId": customer_id,
            "customerEmail": customer_email,
            "customerFirstName": customer_first_name,
            "customerLastname": customer_last_name,
            "customerPhoneNumber": customer_phone,
            "description": description or "",
            "notificationURL": notify_url,
            "returnURL": return_url,
            "returnContext": return_context,
            "hashcode": hashcode,
        }

        try:
            loop = asyncio.get_running_loop()
            client = self._get_soap_client()
            response = await loop.run_in_executor(
                None, lambda: client.service.initTransact(**soap_params)
            )

            code = getattr(response, "Code", None)
            session_id = getattr(response, "Sessionid", None)
            desc = getattr(response, "Description", "")

            if code == 0 and session_id:
                checkout_url = f"{self.CHECKOUT_BASE}?sessionid={session_id}"
                return {
                    "provider_ref": reference,
                    "checkout_url": checkout_url,
                    "status": "initiated",
                    "session_id": session_id,
                }
            else:
                error_msg = f"PaiementPro initTransact error (code={code}): {desc}"
                logger.error(error_msg)
                return {
                    "provider_ref": reference,
                    "checkout_url": None,
                    "status": "failed",
                    "error": error_msg,
                }
        except Exception as e:
            logger.exception("PaiementPro SOAP initTransact call failed")
            return {
                "provider_ref": reference,
                "checkout_url": None,
                "status": "failed",
                "error": str(e),
            }

    async def check_status(self, provider_ref: str) -> Dict[str, Any]:
        """PaiementPro has no status-check endpoint.

        Status is updated only via the notification callback (webhook).
        Return unknown and log a warning so callers know to rely on webhooks.
        """
        logger.warning(
            "PaiementPro does not provide a status-check API. "
            "Payment status for ref=%s must come from the notification webhook.",
            provider_ref,
        )
        return {
            "status": "unknown",
            "raw": {
                "provider_ref": provider_ref,
                "note": "PaiementPro has no status query endpoint; rely on webhook notifications.",
            },
        }

    def verify_webhook_signature(
        self,
        payload_bytes: bytes,
        signature: str,
        parsed_payload: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Verify the hashcode from a PaiementPro notification callback.

        The expected hashcode is HMAC-SHA256(merchantId + referenceNumber + amount)
        using PAIEMENTPRO_WEBHOOK_SECRET as the key.

        For this to work, the caller must pass the hashcode from the notification
        as ``signature``, and ``payload_bytes`` must be the concatenation of
        merchantId + referenceNumber + amount (the same fields used to generate it).
        """
        if not self.webhook_secret:
            logger.error("PAIEMENTPRO_WEBHOOK_SECRET not configured — cannot verify webhook")
            return False

        if parsed_payload:
            merchant_id = str(parsed_payload.get("merchantId", ""))
            reference = str(parsed_payload.get("referenceNumber", ""))
            amount = str(parsed_payload.get("amount", ""))
            if merchant_id and reference and amount:
                payload_bytes = f"{merchant_id}{reference}{amount}".encode("utf-8")

        if not signature:
            return False

        expected = hmac.HMAC(
            self.webhook_secret.encode("utf-8"),
            payload_bytes,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected.lower(), str(signature).lower())


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_payment_adapter() -> PaymentAdapter:
    """Return the appropriate adapter based on PAYMENT_PROVIDER env var."""
    provider = os.getenv("PAYMENT_PROVIDER", "mock").lower()
    if provider == "paiementpro":
        return PaiementProAdapter()
    if provider == "wave":
        logger.info("PAYMENT_PROVIDER=wave is deprecated, use paiementpro instead")
        return PaiementProAdapter()
    return MockPaymentAdapter()

