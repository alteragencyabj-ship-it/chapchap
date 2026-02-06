"""
Payment Pydantic models for request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from enum import Enum


class PaymentStatus(str, Enum):
    PENDING = "pending"
    INITIATED = "initiated"
    CAPTURED = "captured"
    RELEASED = "released"
    REFUNDED = "refunded"
    FAILED = "failed"


class PaymentProvider(str, Enum):
    WAVE = "wave"
    MOCK = "mock"


class PaymentInitiateRequest(BaseModel):
    request_id: str = Field(..., description="Service request ID")
    amount: int = Field(..., gt=0, description="Amount in FCFA")
    idempotency_key: str = Field(..., min_length=8, max_length=128, description="Unique key to prevent double charges")


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
    request_id: str
    status: PaymentStatus
    amount: int
    commission_amount: int
    artisan_payout: int
    provider: PaymentProvider
    checkout_url: Optional[str] = None
    created_at: Optional[str] = None
    captured_at: Optional[str] = None
    released_at: Optional[str] = None


class WebhookPayload(BaseModel):
    provider_ref: Optional[str] = None
    status: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None
