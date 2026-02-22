from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Dict

from fastapi.testclient import TestClient
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
import server  # noqa: E402


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _clear_rate_limit_hits() -> None:
    layer = getattr(server.app, "middleware_stack", None)
    visited = set()
    while layer is not None and id(layer) not in visited:
        visited.add(id(layer))
        if hasattr(layer, "_hits"):
            try:
                layer._hits.clear()
            except Exception:
                pass
        layer = getattr(layer, "app", None)


def _register_client(c: TestClient, ts: int) -> tuple[str, str, str]:
    email = f"user_update_guard_{ts}@example.com"
    r = c.post(
        "/api/auth/register",
        json={
            "name": "Client Guard",
            "email": email,
            "phone": "+22501000000",
            "role": "client",
            "password": "Passw0rd!",
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    body = r.json()
    return email, body["access_token"], body["user"]["_id"]


def test_user_update_rejects_forbidden_fields_only() -> None:
    ts = int(time.time())
    email = None

    try:
        with TestClient(server.app) as c:
            _clear_rate_limit_hits()
            email, token, user_id = _register_client(c, ts)

            r = c.put(
                f"/api/users/{user_id}",
                headers=_auth(token),
                json={"role": "artisan", "admin_role": "super_admin"},
            )
            assert r.status_code == 400, (r.status_code, r.text)

            me = c.get("/api/auth/me", headers=_auth(token))
            assert me.status_code == 200, (me.status_code, me.text)
            assert me.json().get("role") == "client"
    finally:
        _clear_rate_limit_hits()
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if email:
            db.users.delete_many({"email": email})
        sync.close()


def test_user_update_ignores_forbidden_when_allowed_present() -> None:
    ts = int(time.time()) + 1
    email = None

    try:
        with TestClient(server.app) as c:
            _clear_rate_limit_hits()
            email, token, user_id = _register_client(c, ts)

            r = c.put(
                f"/api/users/{user_id}",
                headers=_auth(token),
                json={"name": "Client Updated", "role": "artisan"},
            )
            assert r.status_code == 200, (r.status_code, r.text)
            body = r.json()
            assert body.get("name") == "Client Updated"
            assert body.get("role") == "client"
    finally:
        _clear_rate_limit_hits()
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if email:
            db.users.delete_many({"email": email})
        sync.close()
