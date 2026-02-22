from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
import sys

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


def _register_pair(c: TestClient, ts: int) -> tuple[str, str, str, str, str]:
    password = "Passw0rd!"
    client_email = f"wallet_client_{ts}@example.com"
    artisan_email = f"wallet_artisan_{ts}@example.com"

    r = c.post(
        "/api/auth/register",
        json={
            "name": "Wallet Client",
            "email": client_email,
            "phone": "+22507000101",
            "role": "client",
            "password": password,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    client_token = r.json()["access_token"]

    r = c.post(
        "/api/auth/register",
        json={
            "name": "Wallet Artisan",
            "email": artisan_email,
            "phone": "+22507000102",
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

    return client_email, artisan_email, client_token, artisan_token, str(artisan_id)


def _create_request(c: TestClient, client_token: str, artisan_id: str, budget: int, label: str) -> str:
    r = c.post(
        "/api/requests",
        headers=_auth(client_token),
        json={
            "service_type": "plomberie",
            "description": f"Wallet test {label}",
            "photos": [],
            "address": "Abidjan, Cocody",
            "location": {"type": "Point", "coordinates": [-3.996, 5.356]},
            "budget": budget,
            "artisan_id": artisan_id,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    request_id = _pick(r.json(), "_id", "id")
    assert request_id
    return str(request_id)


def _complete_request(c: TestClient, request_id: str, artisan_token: str) -> None:
    for endpoint in ("accept", "en-route", "arrive", "complete"):
        r = c.post(f"/api/requests/{request_id}/{endpoint}", headers=_auth(artisan_token))
        assert r.status_code == 200, (endpoint, r.status_code, r.text)
    assert r.json().get("status") == "terminee"


def _get_credit(c: TestClient, artisan_token: str) -> Dict[str, Any]:
    r = c.get("/api/credit/status", headers=_auth(artisan_token))
    assert r.status_code == 200, (r.status_code, r.text)
    return r.json()


def _get_transactions(c: TestClient, artisan_token: str) -> list[Dict[str, Any]]:
    r = c.get("/api/credit/transactions", headers=_auth(artisan_token))
    assert r.status_code == 200, (r.status_code, r.text)
    data = r.json()
    assert isinstance(data, list)
    return data


def test_wallet_financial_updates_on_completion_are_atomic_and_idempotent() -> None:
    ts = int(time.time())
    client_email = None
    artisan_email = None
    artisan_id = None
    request_ids: list[str] = []
    sync = None

    try:
        with TestClient(server.app) as c:
            (
                client_email,
                artisan_email,
                client_token,
                artisan_token,
                artisan_id,
            ) = _register_pair(c, ts)

            # 1) Mission at 7000 FCFA -> +2000 commission, -1 credit, +7000 earnings.
            first_request_id = _create_request(
                c, client_token, artisan_id, budget=7000, label="7000"
            )
            request_ids.append(first_request_id)
            _complete_request(c, first_request_id, artisan_token)

            credit = _get_credit(c, artisan_token)
            assert int(credit.get("commission_due", 0)) == 2000
            assert int(credit.get("credit_remaining", 0)) == 4
            assert int(float(credit.get("total_earned", 0))) == 7000

            tx = [t for t in _get_transactions(c, artisan_token) if t.get("booking_id") == first_request_id]
            assert len(tx) == 1
            assert int(tx[0].get("commission", 0)) == 2000
            assert int(float(tx[0].get("artisan_earning", 0))) == 7000

            # 2) Two missions in a row -> totals must stay coherent.
            second_request_id = _create_request(
                c, client_token, artisan_id, budget=9000, label="9000"
            )
            request_ids.append(second_request_id)
            _complete_request(c, second_request_id, artisan_token)

            credit = _get_credit(c, artisan_token)
            assert int(credit.get("commission_due", 0)) == 4000
            assert int(credit.get("credit_remaining", 0)) == 3
            assert int(float(credit.get("total_earned", 0))) == 16000

            tx = [t for t in _get_transactions(c, artisan_token) if t.get("booking_id") in request_ids]
            assert len(tx) == 2

            # 3) Simulate double "complete" trigger -> no duplicated financial impact.
            sync = MongoClient(database.MONGODB_URL)
            db = sync[database.DATABASE_NAME]

            # Force the state back to mission_en_cours to replay the TERMINEE transition once.
            db.service_requests.update_one(
                {"_id": ObjectId(second_request_id)},
                {"$set": {"status": "mission_en_cours", "updated_at": datetime.utcnow()}},
            )

            r = c.post(f"/api/requests/{second_request_id}/complete", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "terminee"

            credit_after_duplicate = _get_credit(c, artisan_token)
            assert int(credit_after_duplicate.get("commission_due", 0)) == 4000
            assert int(credit_after_duplicate.get("credit_remaining", 0)) == 3
            assert int(float(credit_after_duplicate.get("total_earned", 0))) == 16000

            tx_second = [
                t
                for t in _get_transactions(c, artisan_token)
                if t.get("booking_id") == second_request_id
            ]
            assert len(tx_second) == 1

            second_doc = db.service_requests.find_one(
                {"_id": ObjectId(second_request_id)},
                {"financials_applied_at": 1, "financials_snapshot": 1},
            )
            assert second_doc is not None
            assert second_doc.get("financials_applied_at") is not None
            snapshot = second_doc.get("financials_snapshot") or {}
            assert int(float(snapshot.get("commission_added", 0))) == 2000
            assert int(float(snapshot.get("artisan_earning_added", 0))) == 9000

            # 4) Blocked artisan case: wallet must still update on mission completion.
            third_request_id = _create_request(
                c, client_token, artisan_id, budget=8000, label="blocked-case"
            )
            request_ids.append(third_request_id)
            # Accept while not blocked, then force blocked before completion to simulate edge case.
            r = c.post(f"/api/requests/{third_request_id}/accept", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)

            db.artisan_credits.update_one(
                {"artisan_id": artisan_id},
                {
                    "$set": {
                        "credit_remaining": 0,
                        "commission_due": 10000,
                        "is_blocked": True,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )
            r = c.post(f"/api/requests/{third_request_id}/en-route", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            r = c.post(f"/api/requests/{third_request_id}/arrive", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            r = c.post(f"/api/requests/{third_request_id}/complete", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "terminee"

            blocked_credit = _get_credit(c, artisan_token)
            assert int(blocked_credit.get("commission_due", 0)) == 12000
            assert int(blocked_credit.get("credit_remaining", 0)) == -1
            assert int(float(blocked_credit.get("total_earned", 0))) == 24000

            tx_third = [
                t
                for t in _get_transactions(c, artisan_token)
                if t.get("booking_id") == third_request_id
            ]
            assert len(tx_third) == 1
    finally:
        cleanup_client = sync or MongoClient(database.MONGODB_URL)
        db = cleanup_client[database.DATABASE_NAME]

        if client_email or artisan_email:
            db.users.delete_many(
                {"email": {"$in": [x for x in [client_email, artisan_email] if x]}}
            )

        if artisan_id:
            db.artisan_credits.delete_many({"artisan_id": artisan_id})
            db.mission_transactions.delete_many({"artisan_id": artisan_id})
            db.commission_payments.delete_many({"artisan_id": artisan_id})

        if request_ids:
            object_ids = [ObjectId(rid) for rid in request_ids]
            db.service_requests.delete_many({"_id": {"$in": object_ids}})
            db.conversations.delete_many({"request_id": {"$in": request_ids}})
            db.messages.delete_many({"request_id": {"$in": request_ids}})
            db.disputes.delete_many({"request_id": {"$in": request_ids}})
            db.payment_intents.delete_many({"request_id": {"$in": request_ids}})
            db.notifications.delete_many({"data.request_id": {"$in": request_ids}})
            db.pending_timeouts.delete_many(
                {
                    "$or": [
                        {"key": {"$in": [f"validate_remind:{rid}" for rid in request_ids]}},
                        {"key": {"$in": [f"timeout:{rid}" for rid in request_ids]}},
                    ]
                }
            )

        cleanup_client.close()
