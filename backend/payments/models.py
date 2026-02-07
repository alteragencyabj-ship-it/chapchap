"""
Payment Pydantic models for request/response validation.
"""

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class PaymentStatus(str, Enum):
    PENDING = "pending"
    UNKNOWN = "unknown"
    INITIATED = "initiated"
    CAPTURED = "captured"
    RELEASED = "released"
    REFUNDED = "refunded"
    FAILED = "failed"


class PaymentProvider(str, Enum):
    WAVE = "wave"
    PAIEMENTPRO = "paiementpro"
    MOCK = "mock"


# Canal de paiement — permet au client de choisir le mode de paiement
class PaymentChannel(str, Enum):
    WAVE = "wave"
    ORANGE_MONEY = "orange_money"
    MTN = "mtn"
    MOOV = "moov"
    VISA = "visa"
    MASTERCARD = "mastercard"
    PAYPAL = "paypal"
    ALL = "all"


class PaymentInitiateRequest(BaseModel):
    request_id: str = Field(..., description="Service request ID")
    amount: int = Field(..., gt=0, description="Amount in FCFA")
    idempotency_key: str = Field(..., min_length=8, max_length=128, description="Unique key to prevent double charges")
    payment_channel: PaymentChannel = Field(default=PaymentChannel.ALL, description="Canal de paiement souhaite")


class PaymentInitiateResponse(BaseModel):
    payment_intent_id: str
    checkout_url: Optional[str] = None
    status: PaymentStatus
    amount: int
    commission_amount: int
    artisan_payout: int
    provider: PaymentProvider


class PaymentStatusResponse(BaseModel):
    payment_intent_id: str
    request_id: Optional[str] = None
    status: PaymentStatus
    amount: int
    commission_amount: int
    artisan_payout: int
    provider: PaymentProvider
    provider_ref: Optional[str] = None
    payment_type: Optional[str] = None
    payment_channel: Optional[str] = None
    checkout_url: Optional[str] = None
    created_at: Optional[str] = None
    captured_at: Optional[str] = None
    released_at: Optional[str] = None
    refunded_at: Optional[str] = None


class PaymentReleaseResponse(BaseModel):
    payment_intent_id: str
    status: PaymentStatus
    artisan_payout: int
    commission_amount: int
    duplicate: Optional[bool] = False
    credit: Optional[Dict[str, Any]] = None


class PaymentRefundResponse(BaseModel):
    payment_intent_id: str
    status: PaymentStatus
    amount: int
    duplicate: Optional[bool] = False


class CommissionPaymentCheckoutRequest(BaseModel):
    payment_channel: PaymentChannel = Field(default=PaymentChannel.ALL)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=128)


class CommissionPaymentCheckoutResponse(BaseModel):
    payment_intent_id: str
    checkout_url: Optional[str] = None
    status: PaymentStatus
    amount: int
    provider: PaymentProvider


class WebhookPayload(BaseModel):
    # Generic / mock
    id: Optional[str] = None
    provider_ref: Optional[str] = None
    status: Optional[str] = None
    event: Optional[str] = None

    # PaiementPro callback fields
    merchantId: Optional[str] = None
    referenceNumber: Optional[str] = None
    amount: Optional[str] = None
    responsecode: Optional[str] = None
    hashcode: Optional[str] = None
    transactiondt: Optional[str] = None
    customerId: Optional[str] = None
    returnContext: Optional[str] = None

    raw: Optional[Dict[str, Any]] = None

    class Config:
        extra = "allow"
