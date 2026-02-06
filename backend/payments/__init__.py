"""
ChapChap Payments Module
========================
Escrow-based payment system with pluggable provider adapters.

Design decision: Payment intent is created at REQUEST ACCEPTANCE.
- Client pays into escrow when artisan accepts.
- Funds are released to artisan after client CONFIRMS satisfaction.
- Platform commission is deducted at release time.

Providers: Wave (primary), Mock (dev/test).
"""

from .adapter import get_payment_adapter, MockPaymentAdapter, WavePaymentAdapter
from .service import PaymentService

__all__ = [
    "PaymentService",
    "get_payment_adapter",
    "MockPaymentAdapter",
    "WavePaymentAdapter",
]
