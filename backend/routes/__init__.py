"""
ARTISAN Route Modules
======================
All API route modules are registered here and mounted in server.py.
"""

from fastapi import APIRouter

from .requests import router as requests_router
from .conversations import router as conversations_router
from .notifications import router as notifications_router
from .admin_artisans import router as admin_artisans_router
from .admin_finance import router as admin_finance_router
from .admin_missions import router as admin_missions_router
from .admin_disputes import router as admin_disputes_router
from .admin_users import router as admin_users_router
from .admin_notifications import router as admin_notifications_router
from .payments import router as payments_router
from .health import router as health_router
from .artisan_routes import router as artisan_routes_router
from .client_addresses import router as client_addresses_router
from .wallets import router as wallets_router

all_routers = [
    health_router,
    client_addresses_router,
    wallets_router,
    payments_router,
    artisan_routes_router,
    requests_router,
    conversations_router,
    notifications_router,
    admin_artisans_router,
    admin_finance_router,
    admin_missions_router,
    admin_disputes_router,
    admin_users_router,
    admin_notifications_router,
]

