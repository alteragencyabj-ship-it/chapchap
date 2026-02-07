from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import socketio
import os
import logging
import json
from pathlib import Path
from dotenv import load_dotenv
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
import bcrypt

import database as db_module
from database import connect_to_mongo, close_mongo_connection
from models import (
    User, UserCreate, ServiceRequest, ServiceRequestCreate,
    Message, MessageCreate, Rating, RatingCreate,
    LoginRequest, TokenResponse, GeoLocation,
    Booking, BookingCreate
)
from auth import get_current_user, create_access_token, get_optional_user
from socketio_server import sio
from notification_service import seed_notification_templates
from middleware import CorrelationIdMiddleware, RateLimitMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Environment config
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]


def _validate_secrets():
    """Fail fast if critical secrets are missing or default in production."""
    jwt_secret = os.getenv("JWT_SECRET", "")
    bad_defaults = {"", "change-me", "chapchap-2026-secret-key-change-in-production", "your-super-secret-jwt-key"}
    if ENVIRONMENT == "production":
        if jwt_secret in bad_defaults:
            raise RuntimeError("FATAL: JWT_SECRET must be set to a secure random value in production")
        if len(jwt_secret) < 32:
            raise RuntimeError("FATAL: JWT_SECRET must be at least 32 characters in production")
        if ALLOWED_ORIGINS == ["*"]:
            raise RuntimeError("FATAL: ALLOWED_ORIGINS must not be '*' in production")
    elif jwt_secret in bad_defaults:
        logging.getLogger(__name__).warning(
            "JWT_SECRET is set to a default value. Change it before going to production."
        )


# Lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _validate_secrets()
    await connect_to_mongo()
    # Register event handlers (must import AFTER db init)
    import event_handlers  # noqa: F401
    # Seed notification templates
    await seed_notification_templates()
    print(f"[OK] Application startup complete (env={ENVIRONMENT})")
    yield
    # Shutdown
    await close_mongo_connection()
    print("[OK] Application shutdown complete")

app = FastAPI(title="Servicio API", lifespan=lifespan)

# Middleware stack (order matters: first added = outermost)
app.add_middleware(RateLimitMiddleware, requests_per_minute=60)
app.add_middleware(CorrelationIdMiddleware)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Router (for legacy inline routes)
api_router = APIRouter(prefix="/api")

# ==================== AUTH ROUTES ====================

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    """Register a new user"""
    existing_user = await db_module.db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_dict = user_data.dict(exclude={"password"}, exclude_none=True)
    user_dict["created_at"] = datetime.utcnow()

    if user_data.role == "artisan":
        user_dict["verified"] = False
        user_dict["average_rating"] = 0.0
        user_dict["total_missions"] = 0

    if user_data.password:
        hashed = bcrypt.hashpw(user_data.password.encode(), bcrypt.gensalt())
        user_dict["password_hash"] = hashed.decode()

    result = await db_module.db.users.insert_one(user_dict)
    user_dict["_id"] = str(result.inserted_id)

    token = create_access_token(user_dict["_id"], user_data.email)

    user_obj = User(**user_dict)
    return TokenResponse(access_token=token, user=user_obj)

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(login_data: LoginRequest):
    """Login with email and password"""
    user = await db_module.db.users.find_one({"email": login_data.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if "password_hash" in user:
        if not bcrypt.checkpw(login_data.password.encode(), user["password_hash"].encode()):
            raise HTTPException(status_code=401, detail="Invalid credentials")
    else:
        raise HTTPException(status_code=401, detail="Password not set for this account")

    user["_id"] = str(user["_id"])
    admin_role = user.get("admin_role")
    token = create_access_token(user["_id"], user["email"], admin_role=admin_role)
    user_obj = User(**user)

    return TokenResponse(access_token=token, user=user_obj)

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user info"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])

    # Update last_seen_at
    await db_module.db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {"last_seen_at": datetime.utcnow()}},
    )

    return User(**user)

# ==================== USER ROUTES ====================

@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    """Get user by ID"""
    user = await db_module.db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return User(**user)

@api_router.get("/artisans", response_model=List[User])
async def get_artisans(
    specialty: Optional[str] = None,
    city: Optional[str] = None,
    verified_only: bool = True
):
    """Get list of artisans with optional filters"""
    query = {"role": "artisan"}
    if specialty:
        query["specialties"] = {"$in": [specialty]}
    if city:
        query["city"] = city
    if verified_only:
        query["verified"] = True

    artisans = []
    async for artisan in db_module.db.users.find(query).limit(50):
        artisan["_id"] = str(artisan["_id"])
        artisans.append(User(**artisan))

    return artisans

@api_router.put("/users/{user_id}", response_model=User)
async def update_user(
    user_id: str,
    user_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Update user profile"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if str(user["_id"]) != user_id:
        raise HTTPException(status_code=403, detail="Cannot update other users")

    await db_module.db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": user_data}
    )

    updated_user = await db_module.db.users.find_one({"_id": ObjectId(user_id)})
    updated_user["_id"] = str(updated_user["_id"])
    return User(**updated_user)

# ==================== LEGACY SERVICE REQUEST ROUTES ====================
# (Kept for backward compatibility -- new flow is in routes/requests.py)

@api_router.get("/requests/available", response_model=List[ServiceRequest])
async def get_available_requests(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get available service requests for artisans"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})

    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can view available requests")

    query = {"status": {"$in": ["pending", "published"]}}

    if lat and lng:
        query["location"] = {
            "$near": {
                "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                "$maxDistance": radius_km * 1000
            }
        }

    if user.get("specialties"):
        query["service_type"] = {"$in": user["specialties"]}

    requests = []
    async for req in db_module.db.service_requests.find(query).limit(20):
        req["_id"] = str(req["_id"])
        requests.append(ServiceRequest(**req))

    return requests

# ==================== BOOKING ROUTES (Legacy alias) ====================

@api_router.post("/bookings", response_model=Booking)
async def create_booking(
    booking_data: BookingCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new booking/reservation"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})

    booking_dict = booking_data.dict()
    booking_dict["client_id"] = str(user["_id"])
    booking_dict["client_name"] = user.get("name", "Client")
    booking_dict["status"] = "pending_artisan"
    booking_dict["created_at"] = datetime.utcnow()

    result = await db_module.db.bookings.insert_one(booking_dict)
    booking_dict["_id"] = str(result.inserted_id)

    return Booking(**booking_dict)

@api_router.get("/bookings", response_model=List[Booking])
async def get_bookings(
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get bookings for current user"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    user_id = str(user["_id"])

    query = {}
    if user["role"] == "client":
        query["client_id"] = user_id
    elif user["role"] == "artisan":
        query["artisan_id"] = user_id

    if status:
        query["status"] = status

    bookings = []
    async for booking in db_module.db.bookings.find(query).sort("created_at", -1):
        booking["_id"] = str(booking["_id"])
        bookings.append(Booking(**booking))

    return bookings

@api_router.get("/bookings/{booking_id}", response_model=Booking)
async def get_booking(booking_id: str):
    """Get booking by ID"""
    booking = await db_module.db.bookings.find_one({"_id": ObjectId(booking_id)})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    booking["_id"] = str(booking["_id"])
    return Booking(**booking)

@api_router.post("/bookings/{booking_id}/accept")
async def accept_booking(
    booking_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Accept a booking (artisan only)"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can accept bookings")

    booking = await db_module.db.bookings.find_one({"_id": ObjectId(booking_id)})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "pending_artisan":
        raise HTTPException(status_code=400, detail="Booking is not available")

    await db_module.db.bookings.update_one(
        {"_id": ObjectId(booking_id)},
        {"$set": {"status": "accepted", "updated_at": datetime.utcnow()}}
    )
    return {"message": "Booking accepted successfully"}

@api_router.post("/bookings/{booking_id}/complete")
async def complete_booking(
    booking_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Mark booking as completed"""
    booking = await db_module.db.bookings.find_one({"_id": ObjectId(booking_id)})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    await db_module.db.bookings.update_one(
        {"_id": ObjectId(booking_id)},
        {"$set": {"status": "completed", "completed_at": datetime.utcnow(), "updated_at": datetime.utcnow()}}
    )
    return {"message": "Booking completed"}

# ==================== RATING ROUTES ====================

@api_router.post("/ratings", response_model=Rating)
async def create_rating(
    rating_data: RatingCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a rating for an artisan"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})

    rating_dict = rating_data.dict()
    rating_dict["client_id"] = str(user["_id"])
    rating_dict["created_at"] = datetime.utcnow()

    result = await db_module.db.ratings.insert_one(rating_dict)
    rating_dict["_id"] = str(result.inserted_id)

    # Update artisan's average rating
    artisan_ratings = []
    async for r in db_module.db.ratings.find({"artisan_id": rating_data.artisan_id}):
        artisan_ratings.append(r["rating"])

    if artisan_ratings:
        avg_rating = sum(artisan_ratings) / len(artisan_ratings)
        await db_module.db.users.update_one(
            {"_id": ObjectId(rating_data.artisan_id)},
            {"$set": {"average_rating": avg_rating, "total_missions": len(artisan_ratings)}}
        )

    return Rating(**rating_dict)

@api_router.get("/ratings/artisan/{artisan_id}", response_model=List[Rating])
async def get_artisan_ratings(artisan_id: str):
    """Get all ratings for an artisan"""
    ratings = []
    async for rating in db_module.db.ratings.find({"artisan_id": artisan_id}).sort("created_at", -1):
        rating["_id"] = str(rating["_id"])
        ratings.append(Rating(**rating))
    return ratings

# ==================== MESSAGE ROUTES (Legacy) ====================

@api_router.get("/messages/conversation/{other_user_id}", response_model=List[Message])
async def get_conversation(
    other_user_id: str,
    request_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get conversation between current user and another user"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    user_id = str(user["_id"])

    query = {
        "$or": [
            {"sender_id": user_id, "receiver_id": other_user_id},
            {"sender_id": other_user_id, "receiver_id": user_id}
        ]
    }

    if request_id:
        query["request_id"] = request_id

    messages = []
    async for msg in db_module.db.messages.find(query).sort("timestamp", 1):
        msg["_id"] = str(msg["_id"])
        messages.append(Message(**msg))

    return messages

# ==================== ADMIN ROUTES (Legacy stats) ====================

@api_router.get("/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    """Get admin dashboard statistics"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    total_users = await db_module.db.users.count_documents({})
    total_clients = await db_module.db.users.count_documents({"role": "client"})
    total_artisans = await db_module.db.users.count_documents({"role": "artisan"})
    verified_artisans = await db_module.db.users.count_documents({"role": "artisan", "verified": True})

    total_requests = await db_module.db.service_requests.count_documents({})
    pending_requests = await db_module.db.service_requests.count_documents({"status": {"$in": ["pending", "published"]}})
    completed_requests = await db_module.db.service_requests.count_documents({"status": {"$in": ["completed", "confirmed"]}})

    return {
        "users": {
            "total": total_users,
            "clients": total_clients,
            "artisans": total_artisans,
            "verified_artisans": verified_artisans
        },
        "requests": {
            "total": total_requests,
            "pending": pending_requests,
            "completed": completed_requests
        }
    }

@api_router.get("/admin/artisans/pending", response_model=List[User])
async def get_pending_artisans(current_user: dict = Depends(get_current_user)):
    """Get artisans pending verification"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    artisans = []
    async for artisan in db_module.db.users.find({"role": "artisan", "verified": False}):
        artisan["_id"] = str(artisan["_id"])
        artisans.append(User(**artisan))
    return artisans

@api_router.post("/admin/artisans/{artisan_id}/verify")
async def verify_artisan(
    artisan_id: str,
    verified: bool,
    current_user: dict = Depends(get_current_user)
):
    """Verify or reject an artisan"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    await db_module.db.users.update_one(
        {"_id": ObjectId(artisan_id)},
        {"$set": {"verified": verified}}
    )
    return {"message": f"Artisan {'verified' if verified else 'rejected'}"}

# ==================== HEALTH CHECK (legacy -- kept for backward compat) ====================
# Full health suite is in routes/health.py (/api/health, /api/health/db, /api/health/version)

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ==================== CREDIT SYSTEM ROUTES ====================

import credit_system
from models import CommissionPaymentCreate, CreditStatus

@api_router.get("/credit/status", response_model=CreditStatus)
async def get_credit_status(current_user: dict = Depends(get_current_user)):
    """Get current artisan's credit status"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans have credit accounts")
    status = await credit_system.get_credit_status(str(user["_id"]))
    return status

@api_router.get("/credit/can-accept")
async def check_can_accept(current_user: dict = Depends(get_current_user)):
    """Check if artisan can accept a new mission"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans have credit accounts")
    result = await credit_system.check_can_accept_mission(str(user["_id"]))
    return result

@api_router.post("/credit/pay")
async def pay_commission(
    payment: CommissionPaymentCreate,
    current_user: dict = Depends(get_current_user)
):
    """Pay commission to unlock account"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can pay commissions")
    if payment.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    result = await credit_system.pay_commission(
        artisan_id=str(user["_id"]),
        amount=payment.amount,
        payment_method=payment.payment_method
    )
    return result

@api_router.get("/credit/transactions")
async def get_transactions(
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get artisan's transaction history"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans have transactions")

    transactions = []
    async for tx in db_module.db.mission_transactions.find(
        {"artisan_id": str(user["_id"])}
    ).sort("created_at", -1).limit(limit):
        tx["_id"] = str(tx["_id"])
        transactions.append(tx)
    return transactions

@api_router.get("/credit/payments")
async def get_payments(
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get artisan's payment history"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans have payments")

    payments = []
    async for p in db_module.db.commission_payments.find(
        {"artisan_id": str(user["_id"])}
    ).sort("created_at", -1).limit(limit):
        p["_id"] = str(p["_id"])
        payments.append(p)
    return payments

# ==================== ADMIN CREDIT ROUTES ====================

@api_router.get("/admin/credits/blocked")
async def get_blocked_artisans(current_user: dict = Depends(get_current_user)):
    """Get all blocked artisans (admin only)"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    blocked = []
    async for credit in db_module.db.artisan_credits.find({"is_blocked": True}):
        credit["_id"] = str(credit["_id"])
        artisan = await db_module.db.users.find_one({"_id": ObjectId(credit["artisan_id"])})
        if artisan:
            credit["artisan_name"] = artisan.get("name", "Unknown")
            credit["artisan_phone"] = artisan.get("phone", "N/A")
        blocked.append(credit)
    return blocked

@api_router.get("/admin/credits/stats")
async def get_credit_stats(current_user: dict = Depends(get_current_user)):
    """Get overall credit system stats (admin only)"""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    total_commission_due = 0
    total_paid = 0
    blocked_count = 0

    async for credit in db_module.db.artisan_credits.find({}):
        total_commission_due += credit.get("commission_due", 0)
        total_paid += credit.get("total_paid", 0)
        if credit.get("is_blocked"):
            blocked_count += 1

    return {
        "total_commission_due": total_commission_due,
        "total_commission_paid": total_paid,
        "blocked_artisans": blocked_count,
        "total_artisans_with_credit": await db_module.db.artisan_credits.count_documents({})
    }

# ==================== AI DRIVEN ROUTES ====================

import ai_logic

@api_router.post("/ai/analyze")
async def analyze_request(data: dict):
    """Analyse IA d'une demande client"""
    result = await ai_logic.analyze_service_request(data.get("description", ""))
    return result

# ==================== MOUNT ROUTERS ====================

# Legacy inline router
app.include_router(api_router)

# New modular routers
from routes import all_routers
for r in all_routers:
    app.include_router(r)

# Mount Socket.IO
socket_app = socketio.ASGIApp(sio, app, socketio_path="/socket.io/")

# Structured logging
_log_level = logging.DEBUG if ENVIRONMENT == "development" else logging.INFO
logging.basicConfig(
    level=_log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(socket_app, host=host, port=port)
