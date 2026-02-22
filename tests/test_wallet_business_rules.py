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
    client_email = f"wallet_rules_client_{ts}@example.com"
    artisan_email = f"wallet_rules_artisan_{ts}@example.com"

    r = c.post(
        "/api/auth/register",
        json={
            "name": "Wallet Rules Client",
            "email": client_email,
            "phone": "+22507010101",
            "role": "client",
            "password": password,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    client_token = r.json()["access_token"]

    r = c.post(
        "/api/auth/register",
        json={
            "name": "Wallet Rules Artisan",
            "email": artisan_email,
            "phone": "+22507010102",
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
            "description": f"Wallet rules {label}",
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


def _wallet_status(c: TestClient, artisan_token: str) -> Dict[str, Any]:
    r = c.get("/api/credit/status", headers=_auth(artisan_token))
    assert r.status_code == 200, (r.status_code, r.text)
    return r.json()


def _search_artisans(c: TestClient) -> list[dict]:
    r = c.get("/api/artisans/search", params={"service_type": "plomberie"})
    assert r.status_code == 200, (r.status_code, r.text)
    data = r.json()
    assert isinstance(data, list)
    return data


def test_wallet_rules_completion_blocking_and_repayment_flow() -> None:
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

            # Ensure artisan profile exists for /artisans/search.
            r = c.get(f"/api/artisans/profile/{artisan_id}")
            assert r.status_code == 200, (r.status_code, r.text)

            # Baseline visibility in "choisir artisan".
            before_block = _search_artisans(c)
            assert artisan_id in [str(a.get("user_id")) for a in before_block]

            # 1) First mission price 7000 => +2000 due, -1 credit, +7000 earnings.
            first_request_id = _create_request(c, client_token, artisan_id, budget=7000, label="m1")
            request_ids.append(first_request_id)
            _complete_request(c, first_request_id, artisan_token)

            status = _wallet_status(c, artisan_token)
            assert int(status.get("commission_due", 0)) == 2000
            assert int(status.get("credit_remaining", 0)) == 4
            assert int(float(status.get("total_earned", 0))) == 7000

            # 2) Complete 4 more missions => commission_due=10000 + blocked.
            for idx in range(2, 6):
                rid = _create_request(c, client_token, artisan_id, budget=7000, label=f"m{idx}")
                request_ids.append(rid)
                _complete_request(c, rid, artisan_token)

            status_after_five = _wallet_status(c, artisan_token)
            assert int(status_after_five.get("commission_due", 0)) == 10000
            assert bool(status_after_five.get("is_blocked")) is True

            # 3) Blocked artisan cannot accept new mission.
            blocked_request = _create_request(c, client_token, artisan_id, budget=6500, label="blocked")
            request_ids.append(blocked_request)
            r = c.post(f"/api/requests/{blocked_request}/accept", headers=_auth(artisan_token))
            assert r.status_code == 403, (r.status_code, r.text)
            assert "Remboursez 10 000 FCFA pour continuer" in r.text

            # 4) Blocked artisan must disappear from "choisir artisan".
            blocked_search = _search_artisans(c)
            assert artisan_id not in [str(a.get("user_id")) for a in blocked_search]

            # 5) Duplicate TERMINEE trigger must not duplicate wallet update.
            sync = MongoClient(database.MONGODB_URL)
            db = sync[database.DATABASE_NAME]
            duplicate_target = request_ids[4]  # 5th completed mission

            db.service_requests.update_one(
                {"_id": ObjectId(duplicate_target)},
                {"$set": {"status": "mission_en_cours", "updated_at": datetime.utcnow()}},
            )
            r = c.post(f"/api/requests/{duplicate_target}/complete", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "terminee"

            status_after_duplicate = _wallet_status(c, artisan_token)
            assert int(status_after_duplicate.get("commission_due", 0)) == 10000
            assert int(float(status_after_duplicate.get("total_earned", 0))) == 35000

            tx_count = db.wallet_transactions.count_documents(
                {"missionId": duplicate_target, "type": "MISSION_COMPLETED"}
            )
            assert tx_count == 1

            # 6) Repay 10000 => due decreases + unblock if below threshold.
            repay_id = f"repay-{ts}"
            r = c.post(
                f"/api/wallets/{artisan_id}/repay",
                headers=_auth(artisan_token),
                json={"amount": 10000, "paymentId": repay_id},
            )
            assert r.status_code == 200, (r.status_code, r.text)
            wallet = r.json()["wallet"]
            assert int(wallet.get("commission_due", 0)) == 0
            assert bool(wallet.get("isBlocked")) is False

            # Repayment idempotence by paymentId (no second deduction).
            r2 = c.post(
                f"/api/wallets/{artisan_id}/repay",
                headers=_auth(artisan_token),
                json={"amount": 10000, "paymentId": repay_id},
            )
            assert r2.status_code == 200, (r2.status_code, r2.text)
            wallet2 = r2.json()["wallet"]
            assert int(wallet2.get("commission_due", 0)) == 0
            assert bool(wallet2.get("isBlocked")) is False

            # Unblocked artisan can accept again.
            r = c.post(f"/api/requests/{blocked_request}/accept", headers=_auth(artisan_token))
            assert r.status_code == 200, (r.status_code, r.text)
            assert r.json().get("status") == "acceptee"

            # Visible again in artisan search.
            after_repay_search = _search_artisans(c)
            assert artisan_id in [str(a.get("user_id")) for a in after_repay_search]
    finally:
        cleanup = sync or MongoClient(database.MONGODB_URL)
        db = cleanup[database.DATABASE_NAME]

        if client_email or artisan_email:
            db.users.delete_many({"email": {"$in": [x for x in [client_email, artisan_email] if x]}})

        if artisan_id:
            db.artisan_profiles.delete_many({"user_id": artisan_id})
            db.artisan_credits.delete_many({"artisan_id": artisan_id})
            db.mission_transactions.delete_many({"artisan_id": artisan_id})
            db.commission_payments.delete_many({"artisan_id": artisan_id})
            db.wallet_transactions.delete_many({"artisanId": artisan_id})

        if request_ids:
            object_ids = [ObjectId(rid) for rid in request_ids if ObjectId.is_valid(rid)]
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
                        {"key": {"$in": [f"no_response:{rid}" for rid in request_ids]}},
                    ]
                }
            )

        cleanup.close()
