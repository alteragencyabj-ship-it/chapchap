from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient
from pymongo import MongoClient


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import server  # noqa: E402
import database  # noqa: E402


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_admin_endpoints_require_admin_role() -> None:
    ts = int(time.time())
    email = f"admin_no_role{ts}@example.com"
    password = "Passw0rd!"

    token = None

    try:
        with TestClient(server.app) as c:
            r = c.post(
                "/api/auth/register",
                json={
                    "name": "Admin No Role",
                    "email": email,
                    "phone": "+22509000000",
                    "role": "admin",
                    "password": password,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            token = r.json()["access_token"]

            r = c.get("/api/admin/users", headers=_auth(token))
            assert r.status_code == 403, (r.status_code, r.text)
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        db.users.delete_many({"email": email})
        sync.close()


def test_admin_endpoints_work_with_super_admin_role() -> None:
    ts = int(time.time())
    email = f"admin_super{ts}@example.com"
    password = "Passw0rd!"

    token = None
    started_at = datetime.utcnow()

    try:
        with TestClient(server.app) as c:
            r = c.post(
                "/api/auth/register",
                json={
                    "name": "Admin Super",
                    "email": email,
                    "phone": "+22509111111",
                    "role": "admin",
                    "password": password,
                },
            )
            assert r.status_code == 200, (r.status_code, r.text)
            token = r.json()["access_token"]

            # Promote via direct DB update
            sync = MongoClient(database.MONGODB_URL)
            db = sync[database.DATABASE_NAME]
            db.users.update_one({"email": email}, {"$set": {"admin_role": "super_admin"}})
            sync.close()

            r = c.get("/api/admin/users", headers=_auth(token))
            assert r.status_code == 200, (r.status_code, r.text)
            payload = r.json()
            assert isinstance(payload.get("users"), list)
            assert isinstance(payload.get("total"), int)
            assert isinstance(payload.get("page"), int)
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        db.users.delete_many({"email": email})
        db.audit_log.delete_many({"timestamp": {"$gte": started_at}})
        sync.close()

