from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
import os
from pathlib import Path
from dotenv import load_dotenv
from pymongo.errors import OperationFailure

# Load environment variables from .env file
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
MONGODB_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DB_NAME", "artisan_connect")

client: AsyncIOMotorClient = None
db: AsyncIOMotorDatabase = None

async def _ensure_ttl_index(collection, field: str, expire_after_seconds: int) -> None:
    """Ensure a TTL index exists on `field` with the desired expireAfterSeconds.

    MongoDB does not allow two equivalent indexes (same key spec) with different
    options. If a non-TTL (or different TTL) index already exists on the same
    field, we drop it and recreate with the correct TTL options.
    """
    try:
        idx_info = await collection.index_information()
        for idx_name, info in idx_info.items():
            if info.get("key") == [(field, 1)]:
                if info.get("expireAfterSeconds") == expire_after_seconds:
                    return
                # Equivalent index exists but with different options -> drop it.
                await collection.drop_index(idx_name)
                break

        await collection.create_index(field, expireAfterSeconds=expire_after_seconds)
    except OperationFailure:
        # Let callers see the error; this is only here to keep the helper narrow.
        raise

async def connect_to_mongo():
    global client, db
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[DATABASE_NAME]

    # ===== EXISTING INDEXES =====
    # Users
    await db.users.create_index("email", unique=True)
    await db.users.create_index("firebase_uid")
    await db.users.create_index("role")
    await db.users.create_index([("location", "2dsphere")])
    await db.users.create_index("admin_role")
    await db.users.create_index("status")
    await db.users.create_index("referral_id", unique=True, sparse=True)
    await db.users.create_index("referred_by_artisan_id")
    await db.users.create_index("affiliated_clients_count")

    # Service requests
    await db.service_requests.create_index("client_id")
    await db.service_requests.create_index("assigned_artisan_id")
    await db.service_requests.create_index("artisan_id")
    await db.service_requests.create_index("status")
    await db.service_requests.create_index([("location", "2dsphere")])
    await db.service_requests.create_index("financials_applied_at")

    # Messages
    await db.messages.create_index([("sender_id", 1), ("receiver_id", 1)])
    await db.messages.create_index("request_id")
    await db.messages.create_index("conversation_id")
    await db.messages.create_index("timestamp")

    # ===== NEW INDEXES =====

    # Conversations
    try:
        await db.conversations.drop_index("request_id_1")
    except Exception:
        pass
    await db.conversations.create_index("request_id", unique=True, sparse=True)
    await db.conversations.create_index("participants")
    await db.conversations.create_index("last_message_at")

    # Notifications (TTL 90 days)
    await db.notifications.create_index([("recipient_id", 1), ("read", 1)])
    await db.notifications.create_index([("recipient_id", 1), ("created_at", -1)])
    await _ensure_ttl_index(
        db.notifications,
        field="created_at",
        expire_after_seconds=90 * 24 * 3600,  # 90 days TTL
    )

    # Audit log (TTL 365 days)
    await db.audit_log.create_index("actor_id")
    await db.audit_log.create_index([("resource_type", 1), ("resource_id", 1)])
    await _ensure_ttl_index(
        db.audit_log,
        field="timestamp",
        expire_after_seconds=365 * 24 * 3600,  # 365 days TTL
    )

    # Disputes
    await db.disputes.create_index("request_id")
    await db.disputes.create_index([("status", 1), ("created_at", -1)])
    await db.disputes.create_index("assigned_admin")

    # Notification templates
    await db.notification_templates.create_index("key", unique=True)

    # Admin campaigns
    await db.admin_campaigns.create_index("created_at")

    # Payment intents
    await db.payment_intents.create_index("request_id")
    await db.payment_intents.create_index("client_id")
    await db.payment_intents.create_index("artisan_id")
    await db.payment_intents.create_index("idempotency_key", unique=True)
    await db.payment_intents.create_index("provider_ref", sparse=True)
    await db.payment_intents.create_index([("status", 1), ("created_at", -1)])

    # Payment events
    await db.payment_events.create_index("payment_intent_id")
    await db.payment_events.create_index("created_at")

    # Artisan credits
    await db.artisan_credits.create_index("artisan_id", unique=True)
    await db.artisan_credits.create_index([("is_blocked", 1), ("blocked_since", 1)])
    await db.artisan_credits.create_index("commission_due")

    # Credit/commission history
    await db.mission_transactions.create_index([("artisan_id", 1), ("created_at", -1)])
    await db.mission_transactions.create_index([("booking_id", 1), ("artisan_id", 1)])
    await db.commission_payments.create_index([("artisan_id", 1), ("created_at", -1)])
    await db.wallet_transactions.create_index([("artisanId", 1), ("createdAt", -1)])
    await db.wallet_transactions.create_index(
        [("missionId", 1)],
        unique=True,
        partialFilterExpression={"type": "MISSION_COMPLETED"},
    )
    await db.wallet_transactions.create_index(
        [("paymentId", 1)],
        unique=True,
        partialFilterExpression={"type": "REPAYMENT"},
    )
    await db.wallet_transactions.create_index(
        [("settlementId", 1)],
        unique=True,
        partialFilterExpression={"type": "COMMISSION_SETTLEMENT"},
    )

    # Client saved addresses
    await db.client_addresses.create_index([("client_id", 1), ("address_normalized", 1)], unique=True)
    await db.client_addresses.create_index([("client_id", 1), ("is_default", -1), ("last_used_at", -1)])

    # Artisan profiles (rich profile collection)
    await db.artisan_profiles.create_index("user_id", unique=True)
    await db.artisan_profiles.create_index("metier_principal")
    await db.artisan_profiles.create_index("ville")
    await db.artisan_profiles.create_index("specialites")
    await db.artisan_profiles.create_index("score_confiance")
    await db.artisan_profiles.create_index("affiliated_clients_count")
    await db.artisan_profiles.create_index([("ville", 1), ("metier_principal", 1)])

    print("[OK] Connected to MongoDB")

async def close_mongo_connection():
    global client
    if client:
        client.close()
        print("[OK] Disconnected from MongoDB")

# Helper function to convert ObjectId to string
class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError(f"Invalid ObjectId: {v}")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, field_schema):
        field_schema.update(type="string")
