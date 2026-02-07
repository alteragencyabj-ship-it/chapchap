"""
ARTISAN Payments Module
========================
Escrow-based payment system with pluggable provider adapters.

Providers: PaiementPro (Wave, OM, MTN, Moov, Visa/MC), Mock (dev/test).
"""

from .adapter import get_payment_adapter, MockPaymentAdapter, PaiementProAdapter
from .service import PaymentService

__all__ = [
    "PaymentService",
    "get_payment_adapter",
    "MockPaymentAdapter",
    "PaiementProAdapter",
]

