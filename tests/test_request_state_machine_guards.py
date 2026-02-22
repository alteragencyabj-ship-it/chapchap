from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
import server  # noqa: E402


def _pick(d: Dict[str, Any], *keys: str) -> Optional[Any]:
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register_pair(c: TestClient, ts: int) -> tuple[str, str, str, str]:
    password = "Passw0rd!"
    client_email = f"guard_client_{ts}@example.com"
    artisan_email = f"guard_artisan_{ts}@example.com"

    r = c.post(
        "/api/auth/register",
        json={
            "name": "Guard Client",
            "email": client_email,
            "phone": "+22507000001",
            "role": "client",
            "password": password,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    client_token = r.json()["access_token"]

    r = c.post(
        "/api/auth/register",
        json={
            "name": "Guard Artisan",
            "email": artisan_email,
            "phone": "+22507000002",
            "role": "artisan",
            "password": password,
            "specialties": ["plomberie"],
            "verified": True,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    artisan_token = r.json()["access_token"]
    artisan_id = _pick(r.json()["user"], "_id", "id")
    assert artisan_id

    return client_email, artisan_email, client_token, artisan_token


def _register_client(c: TestClient, email: str) -> str:
    r = c.post(
        "/api/auth/register",
        json={
            "name": "Other Client",
            "email": email,
            "phone": "+22507000009",
            "role": "client",
            "password": "Passw0rd!",
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    return r.json()["access_token"]


def _create_request(c: TestClient, client_token: str, artisan_id: str) -> str:
    r = c.post(
        "/api/requests",
        headers=_auth(client_token),
        json={
            "service_type": "plomberie",
            "description": "Test guards",
            "photos": [],
            "address": "Abidjan, Cocody",
            "location": {"type": "Point", "coordinates": [-3.996, 5.356]},
            "budget": 10000,
            "artisan_id": artisan_id,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    request_id = _pick(r.json(), "_id", "id")
    assert request_id
    return request_id


def test_cancel_blocked_after_en_route_and_phone_gate() -> None:
    ts = int(time.time())
    client_email = None
    artisan_email = None
    request_id = None

    try:
        with TestClient(server.app) as c:
            client_email, artisan_email, client_token, artisan_token = _register_pair(c, ts)

            # Resolve artisan_id from /me for deterministic flow
            r = c.get("/api/auth/me", headers=_auth(artisan_token))
            artisan_id = _pick(r.json(), "_id", "id")
            assert artisan_id

            request_id = _create_request(c, client_token, artisan_id)

            # Accept request
            r = c.post(f"/api/requests/{request_id}/accept", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "acceptee"

            # Phone hidden before departure
            r = c.get(f"/api/requests/{request_id}/contact", headers=_auth(client_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("artisan_phone_visible") is False
            assert r.json().get("artisan_phone") is None

            # Artisan declares departure (generic transition endpoint)
            r = c.post(
                f"/api/requests/{request_id}/transition",
                headers=_auth(artisan_token),
                json={
                    "target_status": "artisan_en_route",
                    "expected_current_status": "acceptee",
                    "reason": "depart_confirme",
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "artisan_en_route"

            # Phone visible after departure
            r = c.get(f"/api/requests/{request_id}/contact", headers=_auth(client_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("artisan_phone_visible") is True
            assert r.json().get("artisan_phone")

            # Cancel is blocked after departure
            r = c.post(
                f"/api/requests/{request_id}/cancel",
                headers=_auth(client_token),
                json={"reason": "changement_plan"},
            )
            assert r.status_code == 409, (r.status_code, r.text)
            assert "Annulation impossible" in r.text
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if client_email or artisan_email:
            db.users.delete_many({"email": {"$in": [x for x in [client_email, artisan_email] if x]}})
        if request_id:
            db.service_requests.delete_one({"_id": ObjectId(request_id)})
            db.conversations.delete_many({"request_id": request_id})
            db.disputes.delete_many({"request_id": request_id})
            db.payment_intents.delete_many({"request_id": request_id})
            db.notifications.delete_many({"data.request_id": request_id})
        sync.close()


def test_transition_validation_requires_warning_ack() -> None:
    ts = int(time.time()) + 1
    client_email = None
    artisan_email = None
    request_id = None

    try:
        with TestClient(server.app) as c:
            client_email, artisan_email, client_token, artisan_token = _register_pair(c, ts)

            r = c.get("/api/auth/me", headers=_auth(artisan_token))
            artisan_id = _pick(r.json(), "_id", "id")
            assert artisan_id

            request_id = _create_request(c, client_token, artisan_id)

            # Progress to TERMINEE
            assert c.post(f"/api/requests/{request_id}/accept", headers=_auth(artisan_token)).status_code == 200
            assert c.post(f"/api/requests/{request_id}/en-route", headers=_auth(artisan_token)).status_code == 200
            assert c.post(f"/api/requests/{request_id}/arrive", headers=_auth(artisan_token)).status_code == 200
            assert c.post(f"/api/requests/{request_id}/complete", headers=_auth(artisan_token)).status_code == 200

            # Missing warning_ack -> blocked
            r = c.post(
                f"/api/requests/{request_id}/transition",
                headers=_auth(client_token),
                json={"target_status": "validee_client"},
            )
            assert r.status_code == 400, (r.status_code, r.text)
            assert "warning_ack" in r.text

            # Wrong expected status -> optimistic lock reject
            r = c.post(
                f"/api/requests/{request_id}/transition",
                headers=_auth(client_token),
                json={
                    "target_status": "validee_client",
                    "expected_current_status": "acceptee",
                    "warning_ack": True,
                },
            )
            assert r.status_code == 409, (r.status_code, r.text)

            # Correct validation
            r = c.post(
                f"/api/requests/{request_id}/transition",
                headers=_auth(client_token),
                json={
                    "target_status": "validee_client",
                    "expected_current_status": "terminee",
                    "warning_ack": True,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "validee_client"
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if client_email or artisan_email:
            db.users.delete_many({"email": {"$in": [x for x in [client_email, artisan_email] if x]}})
        if request_id:
            db.service_requests.delete_one({"_id": ObjectId(request_id)})
            db.conversations.delete_many({"request_id": request_id})
            db.disputes.delete_many({"request_id": request_id})
            db.payment_intents.delete_many({"request_id": request_id})
            db.notifications.delete_many({"data.request_id": request_id})
        sync.close()


def test_non_participant_cannot_transition_request() -> None:
    ts = int(time.time()) + 2
    client_email = None
    artisan_email = None
    outsider_email = f"guard_outsider_{ts}@example.com"
    request_id = None

    try:
        with TestClient(server.app) as c:
            client_email, artisan_email, client_token, artisan_token = _register_pair(c, ts)
            outsider_token = _register_client(c, outsider_email)

            r = c.get("/api/auth/me", headers=_auth(artisan_token))
            artisan_id = _pick(r.json(), "_id", "id")
            assert artisan_id

            request_id = _create_request(c, client_token, artisan_id)

            # Outsider tries to cancel someone else's request
            r = c.post(
                f"/api/requests/{request_id}/cancel",
                headers=_auth(outsider_token),
                json={"reason": "malicious_try"},
            )
            assert r.status_code == 403, (r.status_code, r.text)
            assert "participants" in r.text.lower()
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if client_email or artisan_email or outsider_email:
            db.users.delete_many(
                {"email": {"$in": [x for x in [client_email, artisan_email, outsider_email] if x]}}
            )
        if request_id:
            db.service_requests.delete_one({"_id": ObjectId(request_id)})
            db.conversations.delete_many({"request_id": request_id})
            db.disputes.delete_many({"request_id": request_id})
            db.payment_intents.delete_many({"request_id": request_id})
            db.notifications.delete_many({"data.request_id": request_id})
        sync.close()
