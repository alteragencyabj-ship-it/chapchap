"""
Payment system tests -- deterministic, no network, no credentials needed.

Uses the Mock adapter exclusively.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Force mock provider
import os
os.environ["PAYMENT_PROVIDER"] = "mock"

import server  # noqa: E402
import database  # noqa: E402


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_payment_initiate_and_idempotency():
    """Test payment initiation + idempotency key blocks double charges."""
    ts = int(time.time())
    client_email = f"pay_client_{ts}@test.com"
    artisan_email = f"pay_artisan_{ts}@test.com"
    password = "TestPass1!"

    client_id = None
    artisan_id = None
    request_id = None
    payment_intent_id = None

    try:
        with TestClient(server.app) as c:
            # Register client
            r = c.post("/api/auth/register", json={
                "name": "Pay Client", "email": client_email,
                "phone": "+22501000001", "role": "client", "password": password,
            })
            assert r.status_code == 200
            client_token = r.json()["access_token"]
            client_id = r.json()["user"].get("_id") or r.json()["user"].get("id")

            # Register artisan
            r = c.post("/api/auth/register", json={
                "name": "Pay Artisan", "email": artisan_email,
                "phone": "+22501000002", "role": "artisan", "password": password,
                "specialties": ["plomberie"], "verified": True,
            })
            assert r.status_code == 200
            artisan_token = r.json()["access_token"]
            artisan_id = r.json()["user"].get("_id") or r.json()["user"].get("id")

            # Create request
            r = c.post("/api/requests", headers=_auth(client_token), json={
                "service_type": "plomberie",
                "description": "Payment test request",
                "photos": [], "address": "Test addr",
                "location": {"type": "Point", "coordinates": [-3.9, 5.3]},
                "budget": 15000, "artisan_id": artisan_id,
            })
            assert r.status_code == 200
            request_id = r.json().get("_id") or r.json().get("id")

            # Accept request
            r = c.post(f"/api/requests/{request_id}/accept", headers=_auth(artisan_token))
            assert r.status_code == 200

            # Initiate payment
            idem_key = f"test-idem-{ts}"
            r = c.post("/api/payments/initiate", headers=_auth(client_token), json={
                "request_id": request_id,
                "amount": 15000,
                "idempotency_key": idem_key,
            })
            assert r.status_code == 200, (r.status_code, r.text)
            pay = r.json()
            payment_intent_id = pay["payment_intent_id"]
            assert pay["status"] == "initiated"
            assert pay["amount"] == 15000
            assert pay["commission_amount"] > 0
            assert pay["artisan_payout"] == 15000 - pay["commission_amount"]
            assert pay["checkout_url"] is not None

            # Idempotency: same key returns same intent, no double charge
            r2 = c.post("/api/payments/initiate", headers=_auth(client_token), json={
                "request_id": request_id,
                "amount": 15000,
                "idempotency_key": idem_key,
            })
            assert r2.status_code == 200
            assert r2.json()["payment_intent_id"] == payment_intent_id

            # Check status
            r = c.get(f"/api/payments/status/{payment_intent_id}", headers=_auth(client_token))
            assert r.status_code == 200
            assert r.json()["status"] in ("initiated", "captured")

            # Check by-request
            r = c.get(f"/api/payments/by-request/{request_id}", headers=_auth(client_token))
            assert r.status_code == 200
            assert r.json()["request_id"] == request_id

    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        db.users.delete_many({"email": {"$in": [client_email, artisan_email]}})
        if request_id:
            db.service_requests.delete_one({"_id": ObjectId(request_id)})
            db.conversations.delete_many({"request_id": request_id})
        if payment_intent_id:
            db.payment_intents.delete_many({"_id": ObjectId(payment_intent_id)})
            db.payment_events.delete_many({"payment_intent_id": payment_intent_id})
        if client_id or artisan_id:
            ids = [x for x in [client_id, artisan_id] if x]
            db.notifications.delete_many({"recipient_id": {"$in": ids}})
            db.artisan_credits.delete_many({"artisan_id": {"$in": ids}})
        db.messages.delete_many({})
        sync.close()


def test_payment_webhook_mock():
    """Test webhook processing with mock adapter."""
    ts = int(time.time())
    client_email = f"wh_client_{ts}@test.com"
    artisan_email = f"wh_artisan_{ts}@test.com"
    password = "TestPass1!"

    client_id = None
    artisan_id = None
    request_id = None
    payment_intent_id = None
    provider_ref = None

    try:
        with TestClient(server.app) as c:
            # Setup: register users + create + accept request
            r = c.post("/api/auth/register", json={
                "name": "WH Client", "email": client_email,
                "phone": "+22502000001", "role": "client", "password": password,
            })
            client_token = r.json()["access_token"]
            client_id = r.json()["user"].get("_id") or r.json()["user"].get("id")

            r = c.post("/api/auth/register", json={
                "name": "WH Artisan", "email": artisan_email,
                "phone": "+22502000002", "role": "artisan", "password": password,
                "specialties": ["electricite"], "verified": True,
            })
            artisan_token = r.json()["access_token"]
            artisan_id = r.json()["user"].get("_id") or r.json()["user"].get("id")

            r = c.post("/api/requests", headers=_auth(client_token), json={
                "service_type": "electricite", "description": "Webhook test",
                "photos": [], "address": "Test",
                "location": {"type": "Point", "coordinates": [-3.9, 5.3]},
                "budget": 10000, "artisan_id": artisan_id,
            })
            request_id = r.json().get("_id") or r.json().get("id")
            c.post(f"/api/requests/{request_id}/accept", headers=_auth(artisan_token))

            # Initiate payment
            r = c.post("/api/payments/initiate", headers=_auth(client_token), json={
                "request_id": request_id, "amount": 10000,
                "idempotency_key": f"wh-test-{ts}",
            })
            assert r.status_code == 200
            pay = r.json()
            payment_intent_id = pay["payment_intent_id"]

            # Get provider_ref from DB
            sync_client = MongoClient(database.MONGODB_URL)
            db = sync_client[database.DATABASE_NAME]
            intent = db.payment_intents.find_one({"_id": ObjectId(payment_intent_id)})
            provider_ref = intent["provider_ref"]
            sync_client.close()

            # Send mock webhook
            webhook_body = json.dumps({"id": provider_ref, "status": "succeeded"})
            sig = hmac.new(
                b"mock-webhook-secret",
                webhook_body.encode(),
                hashlib.sha256,
            ).hexdigest()

            r = c.post(
                "/api/payments/webhook",
                content=webhook_body,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": sig,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json()["status"] == "ok"

            # Verify status is now captured
            r = c.get(f"/api/payments/status/{payment_intent_id}", headers=_auth(client_token))
            assert r.status_code == 200
            assert r.json()["status"] == "captured"

    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        db.users.delete_many({"email": {"$in": [client_email, artisan_email]}})
        if request_id:
            db.service_requests.delete_one({"_id": ObjectId(request_id)})
            db.conversations.delete_many({"request_id": request_id})
        if payment_intent_id:
            db.payment_intents.delete_many({"_id": ObjectId(payment_intent_id)})
            db.payment_events.delete_many({"payment_intent_id": payment_intent_id})
        if client_id or artisan_id:
            ids = [x for x in [client_id, artisan_id] if x]
            db.notifications.delete_many({"recipient_id": {"$in": ids}})
            db.artisan_credits.delete_many({"artisan_id": {"$in": ids}})
        db.messages.delete_many({})
        sync.close()
