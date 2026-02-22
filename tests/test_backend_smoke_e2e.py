from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo import MongoClient


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import server  # noqa: E402
import database  # noqa: E402


def _pick(d: Dict[str, Any], *keys: str) -> Optional[Any]:
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_smoke_e2e_flow() -> None:
    ts = int(time.time())
    client_email = f"client{ts}@example.com"
    artisan_email = f"artisan{ts}@example.com"
    password = "Passw0rd!"

    client_id = None
    artisan_id = None
    request_id = None
    conversation_id = None

    started_at = datetime.utcnow()

    try:
        with TestClient(server.app) as c:
            # 1) Basic health + OpenAPI
            r = c.get("/api/health")
            assert r.status_code == 200, (r.status_code, r.text)

            r = c.get("/openapi.json")
            assert r.status_code == 200, (r.status_code, r.text)
            paths = r.json().get("paths", {})
            for prefix in [
                "/api/requests",
                "/api/conversations",
                "/api/notifications",
                "/api/admin/artisans",
                "/api/admin/finance",
                "/api/admin/missions",
                "/api/admin/disputes",
                "/api/admin/users",
                "/api/admin/notifications",
            ]:
                assert any(p.startswith(prefix) for p in paths.keys()), f"Missing OpenAPI path prefix: {prefix}"

            # 2) Register users
            r = c.post(
                "/api/auth/register",
                json={
                    "name": "Test Client",
                    "email": client_email,
                    "phone": "+22501020304",
                    "role": "client",
                    "password": password,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            client_token = r.json()["access_token"]
            client_user = r.json()["user"]
            client_id = _pick(client_user, "_id", "id")
            assert client_id

            r = c.post(
                "/api/auth/register",
                json={
                    "name": "Test Artisan",
                    "email": artisan_email,
                    "phone": "+22505060708",
                    "role": "artisan",
                    "password": password,
                    "specialties": ["plomberie"],
                    "verified": True,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            artisan_token = r.json()["access_token"]
            artisan_user = r.json()["user"]
            artisan_id = _pick(artisan_user, "_id", "id")
            assert artisan_id

            # 3) Create request (client -> targeted artisan)
            r = c.post(
                "/api/requests",
                headers=_auth(client_token),
                json={
                    "service_type": "plomberie",
                    "description": "Test fuite de tuyau (smoke test)",
                    "photos": [],
                    "address": "Abidjan, Cocody",
                    "location": {"type": "Point", "coordinates": [-3.996, 5.356]},
                    "budget": 10000,
                    "artisan_id": artisan_id,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            req = r.json()
            request_id = _pick(req, "_id", "id")
            assert request_id
            assert req.get("status") == "demande_envoyee"

            # 4) Accept -> conversation auto
            r = c.post(f"/api/requests/{request_id}/accept", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "acceptee"

            # 4b) Artisan phone must be hidden before "en route"
            r = c.get(f"/api/requests/{request_id}/contact", headers=_auth(client_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("artisan_phone_visible") is False
            assert r.json().get("artisan_phone") is None

            # 5) Get conversations + find the one linked to request
            r = c.get("/api/conversations", headers=_auth(client_token))
            assert r.status_code == 200, (r.status_code, r.text)
            convs = r.json()
            conv = next((x for x in convs if x.get("request_id") == request_id), None)
            assert conv is not None, convs
            conversation_id = _pick(conv, "_id", "id")
            assert conversation_id

            # 6) Send message via REST fallback
            r = c.post(
                f"/api/conversations/{conversation_id}/messages",
                headers=_auth(client_token),
                json={"message": "Bonjour, je suis dispo."},
            )
            assert r.status_code == 200, (r.status_code, r.text)

            # 7) En route -> Mission in progress -> Complete -> Confirm
            r = c.post(f"/api/requests/{request_id}/en-route", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "artisan_en_route"

            # Phone becomes visible only after en route
            r = c.get(f"/api/requests/{request_id}/contact", headers=_auth(client_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("artisan_phone_visible") is True
            assert r.json().get("artisan_phone")

            r = c.post(f"/api/requests/{request_id}/arrive", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "mission_en_cours"

            r = c.post(f"/api/requests/{request_id}/complete", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "terminee"

            r = c.post(
                f"/api/requests/{request_id}/confirm",
                headers=_auth(client_token),
                json={"warning_ack": True},
            )
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "validee_client"

            # 8) Notifications endpoints reachable
            r = c.get("/api/notifications", headers=_auth(client_token))
            assert r.status_code == 200, (r.status_code, r.text)
            r = c.get("/api/notifications", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
    finally:
        # Best-effort cleanup so repeated runs don't bloat the local DB.
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if client_email or artisan_email:
            db.users.delete_many({"email": {"$in": [client_email, artisan_email]}})
        if request_id:
            db.service_requests.delete_one({"_id": ObjectId(request_id)})
            db.conversations.delete_many({"request_id": request_id})
        if conversation_id:
            db.messages.delete_many({"conversation_id": conversation_id})
        if client_id or artisan_id:
            db.notifications.delete_many(
                {
                    "recipient_id": {"$in": [x for x in [client_id, artisan_id] if x]},
                    "created_at": {"$gte": started_at},
                }
            )
        sync.close()

