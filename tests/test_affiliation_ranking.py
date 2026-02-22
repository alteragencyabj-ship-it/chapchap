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


def _register_user(
    c: TestClient,
    *,
    name: str,
    email: str,
    phone: str,
    role: str,
    referral_code: str | None = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "name": name,
        "email": email,
        "phone": phone,
        "role": role,
        "password": "Passw0rd!",
    }
    if role == "artisan":
        payload["specialties"] = ["plomberie"]
        payload["verified"] = True
    if referral_code:
        payload["referral_code"] = referral_code

    r = c.post("/api/auth/register", json=payload)
    assert r.status_code == 200, (r.status_code, r.text)
    return r.json()


def _create_request(c: TestClient, *, client_token: str, artisan_id: str, description: str) -> str:
    r = c.post(
        "/api/requests",
        headers=_auth(client_token),
        json={
            "service_type": "plomberie",
            "description": description,
            "photos": [],
            "address": "Abidjan, Cocody",
            "location": {"type": "Point", "coordinates": [-3.996, 5.356]},
            "budget": 12000,
            "artisan_id": artisan_id,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    request_id = _pick(r.json(), "_id", "id")
    assert request_id
    return str(request_id)


def _progress_to_validation(c: TestClient, *, request_id: str, artisan_token: str, client_token: str) -> None:
    assert c.post(f"/api/requests/{request_id}/accept", headers=_auth(artisan_token)).status_code == 200
    assert c.post(f"/api/requests/{request_id}/en-route", headers=_auth(artisan_token)).status_code == 200
    assert c.post(f"/api/requests/{request_id}/arrive", headers=_auth(artisan_token)).status_code == 200
    assert c.post(f"/api/requests/{request_id}/complete", headers=_auth(artisan_token)).status_code == 200
    r = c.post(
        f"/api/requests/{request_id}/confirm",
        headers=_auth(client_token),
        json={"warning_ack": True},
    )
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json().get("status") == "validee_client"


def test_affiliated_client_count_incremented_once_per_client() -> None:
    ts = int(time.time())
    client_email = f"affiliate_client_{ts}@example.com"
    artisan_email = f"affiliate_artisan_{ts}@example.com"
    request_ids: list[str] = []
    user_ids: list[str] = []

    try:
        with TestClient(server.app) as c:
            artisan_register = _register_user(
                c,
                name="Affiliate Artisan",
                email=artisan_email,
                phone="+22507111111",
                role="artisan",
            )
            artisan_token = artisan_register["access_token"]
            artisan_user = artisan_register["user"]
            artisan_id = _pick(artisan_user, "_id", "id")
            assert artisan_id
            user_ids.append(str(artisan_id))

            referral_id = artisan_user.get("referral_id")
            assert referral_id, "Artisan must receive a referral_id at registration"

            client_register = _register_user(
                c,
                name="Affiliate Client",
                email=client_email,
                phone="+22507222222",
                role="client",
                referral_code=referral_id,
            )
            client_token = client_register["access_token"]
            client_id = _pick(client_register["user"], "_id", "id")
            assert client_id
            user_ids.append(str(client_id))

            first_request = _create_request(
                c,
                client_token=client_token,
                artisan_id=str(artisan_id),
                description="Mission affiliation 1",
            )
            request_ids.append(first_request)
            _progress_to_validation(
                c,
                request_id=first_request,
                artisan_token=artisan_token,
                client_token=client_token,
            )

            me = c.get("/api/auth/me", headers=_auth(artisan_token))
            assert me.status_code == 200, (me.status_code, me.text)
            assert int(me.json().get("affiliated_clients_count", 0)) == 1

            second_request = _create_request(
                c,
                client_token=client_token,
                artisan_id=str(artisan_id),
                description="Mission affiliation 2",
            )
            request_ids.append(second_request)
            _progress_to_validation(
                c,
                request_id=second_request,
                artisan_token=artisan_token,
                client_token=client_token,
            )

            me = c.get("/api/auth/me", headers=_auth(artisan_token))
            assert me.status_code == 200, (me.status_code, me.text)
            assert int(me.json().get("affiliated_clients_count", 0)) == 1
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if user_ids:
            db.users.delete_many({"_id": {"$in": [ObjectId(uid) for uid in user_ids]}})
            db.artisan_profiles.delete_many({"user_id": {"$in": user_ids}})
        if request_ids:
            db.service_requests.delete_many({"_id": {"$in": [ObjectId(rid) for rid in request_ids]}})
            db.conversations.delete_many({"request_id": {"$in": request_ids}})
            db.messages.delete_many({"request_id": {"$in": request_ids}})
            db.disputes.delete_many({"request_id": {"$in": request_ids}})
            db.payment_intents.delete_many({"request_id": {"$in": request_ids}})
            db.notifications.delete_many({"data.request_id": {"$in": request_ids}})
        sync.close()


def test_search_ranking_prioritizes_affiliated_clients_then_quality() -> None:
    ts = int(time.time()) + 5
    tag = f"rank{ts}"
    user_ids: list[str] = []

    try:
        with TestClient(server.app) as c:
            artisan_a = _register_user(
                c,
                name="Rank Artisan A",
                email=f"rank_a_{ts}@example.com",
                phone="+22507330001",
                role="artisan",
            )
            artisan_b = _register_user(
                c,
                name="Rank Artisan B",
                email=f"rank_b_{ts}@example.com",
                phone="+22507330002",
                role="artisan",
            )
            artisan_c = _register_user(
                c,
                name="Rank Artisan C",
                email=f"rank_c_{ts}@example.com",
                phone="+22507330003",
                role="artisan",
            )

            a_id = str(_pick(artisan_a["user"], "_id", "id"))
            b_id = str(_pick(artisan_b["user"], "_id", "id"))
            c_id = str(_pick(artisan_c["user"], "_id", "id"))
            user_ids.extend([a_id, b_id, c_id])

            # Ensure artisan_profiles docs exist for all artisans
            assert c.get(f"/api/artisans/profile/{a_id}").status_code == 200
            assert c.get(f"/api/artisans/profile/{b_id}").status_code == 200
            assert c.get(f"/api/artisans/profile/{c_id}").status_code == 200

            sync = MongoClient(database.MONGODB_URL)
            db = sync[database.DATABASE_NAME]

            # A: same affiliated count as C but weaker rating
            db.users.update_one(
                {"_id": ObjectId(a_id)},
                {"$set": {"affiliated_clients_count": 4, "average_rating": 3.5}},
            )
            db.artisan_profiles.update_one(
                {"user_id": a_id},
                {"$set": {
                    "metier_principal": tag,
                    "specialites": [tag],
                    "affiliated_clients_count": 4,
                    "note_moyenne": 3.5,
                    "annees_experience": 1,
                    "score_profil": 40.0,
                }},
            )

            # B: best quality but fewer affiliated clients
            db.users.update_one(
                {"_id": ObjectId(b_id)},
                {"$set": {"affiliated_clients_count": 2, "average_rating": 5.0}},
            )
            db.artisan_profiles.update_one(
                {"user_id": b_id},
                {"$set": {
                    "metier_principal": tag,
                    "specialites": [tag],
                    "affiliated_clients_count": 2,
                    "note_moyenne": 5.0,
                    "annees_experience": 20,
                    "score_profil": 95.0,
                }},
            )

            # C: should rank first (same affiliated as A, better rating)
            db.users.update_one(
                {"_id": ObjectId(c_id)},
                {"$set": {"affiliated_clients_count": 4, "average_rating": 4.8}},
            )
            db.artisan_profiles.update_one(
                {"user_id": c_id},
                {"$set": {
                    "metier_principal": tag,
                    "specialites": [tag],
                    "affiliated_clients_count": 4,
                    "note_moyenne": 4.8,
                    "annees_experience": 2,
                    "score_profil": 55.0,
                }},
            )

            sync.close()

            r = c.get("/api/artisans/search", params={"q": tag, "limit": 20, "page": 1})
            assert r.status_code == 200, (r.status_code, r.text)
            results = r.json()
            ranked_ids = [item.get("user_id") for item in results if item.get("user_id") in {a_id, b_id, c_id}]

            assert ranked_ids[:3] == [c_id, a_id, b_id], ranked_ids

            # Verify the primary criterion is exposed for UX
            selected = [item for item in results if item.get("user_id") == c_id]
            assert selected and int(selected[0].get("affiliated_clients_count", -1)) == 4
    finally:
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if user_ids:
            db.users.delete_many({"_id": {"$in": [ObjectId(uid) for uid in user_ids]}})
            db.artisan_profiles.delete_many({"user_id": {"$in": user_ids}})
        sync.close()
