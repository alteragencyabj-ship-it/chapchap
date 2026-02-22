from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict

from bson import ObjectId
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
    """Reset in-memory rate limiter counters to keep test order stable."""
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


def _register_artisan(c: TestClient, ts: int) -> tuple[str, str, str]:
    email = f"profile_compat_artisan_{ts}@example.com"
    r = c.post(
        "/api/auth/register",
        json={
            "name": "Compat Artisan",
            "email": email,
            "phone": "+22507000123",
            "role": "artisan",
            "password": "Passw0rd!",
            "specialties": ["plomberie"],
            "verified": True,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    body = r.json()
    return email, body["access_token"], body["user"]["_id"]


def test_profile_update_accepts_mobile_aliases_and_projects() -> None:
    ts = int(time.time())
    artisan_email = None
    artisan_id = None

    try:
        with TestClient(server.app) as c:
            _clear_rate_limit_hits()
            artisan_email, artisan_token, artisan_id = _register_artisan(c, ts)

            payload: Dict[str, Any] = {
                "first_name": "Yao",
                "last_name": "Nguessan",
                "photo": "data:image/jpeg;base64,AAA",
                "trade": "Plombier",
                "city": "Abidjan",
                "quartier": "Cocody",
                "zone_km": 12,
                "years_experience": 7,
                "professional_status": "independant",
                "company_name": "",
                "languages": ["Francais", "Dioula"],
                "bio": "Artisan fiable pour depannage et installation.",
                "specialties": ["Installation sanitaire", "Depannage fuite"],
                "competences": ["Soudure cuivre", "PVC pression"],
                "materials": ["Cuivre", "PVC"],
                "portfolio_photos": [
                    "https://example.com/gallery-1.jpg",
                    "https://example.com/gallery-2.jpg",
                    "https://example.com/gallery-3.jpg",
                ],
                "portfolio_projects": [
                    {
                        "title": "Renovation salle de bain",
                        "description": "Refonte complete de plomberie",
                        "photos": [
                            "https://example.com/project-1-before.jpg",
                            "https://example.com/project-1-after.jpg",
                        ],
                        "category": "Renovation",
                        "avant_apres": True,
                    }
                ],
            }

            r = c.put("/api/artisans/profile", headers=_auth(artisan_token), json=payload)
            assert r.status_code == 200, (r.status_code, r.text)
            profile = r.json()

            assert profile.get("metier_principal") == "Plombier"
            assert profile.get("ville") == "Abidjan"
            assert profile.get("zone_intervention_km") == 12
            assert profile.get("annees_experience") == 7
            assert profile.get("statut_pro") == "independant"
            assert profile.get("langues") == ["Francais", "Dioula"]
            assert profile.get("specialites") == ["Installation sanitaire", "Depannage fuite"]
            assert profile.get("galerie_photos")
            assert len(profile.get("projets") or []) == 1
            assert profile["projets"][0]["titre"] == "Renovation salle de bain"

            me = c.get("/api/auth/me", headers=_auth(artisan_token))
            assert me.status_code == 200, (me.status_code, me.text)
            me_body = me.json()
            assert me_body.get("name") == "Yao Nguessan"
            assert me_body.get("city") == "Abidjan"
            assert me_body.get("quartier") == "Cocody"
            assert me_body.get("specialties") == ["Installation sanitaire", "Depannage fuite"]
    finally:
        _clear_rate_limit_hits()
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if artisan_email:
            user = db.users.find_one({"email": artisan_email})
            if user:
                user_id = str(user["_id"])
                db.artisan_profiles.delete_many({"user_id": user_id})
            db.users.delete_many({"email": artisan_email})
        if artisan_id:
            db.artisan_profiles.delete_many({"user_id": artisan_id})
            db.notifications.delete_many({"recipient_id": artisan_id})
        sync.close()


def test_upload_profile_photo_supports_legacy_photo_key() -> None:
    ts = int(time.time()) + 1
    artisan_email = None
    artisan_id = None

    try:
        with TestClient(server.app) as c:
            _clear_rate_limit_hits()
            artisan_email, artisan_token, artisan_id = _register_artisan(c, ts)

            r = c.post(
                "/api/artisans/profile/photo",
                headers=_auth(artisan_token),
                json={"photo": "data:image/jpeg;base64,BBB"},
            )
            assert r.status_code == 200, (r.status_code, r.text)
            body = r.json()
            assert body.get("photo_url") == "data:image/jpeg;base64,BBB"
            assert body.get("url") == "data:image/jpeg;base64,BBB"
    finally:
        _clear_rate_limit_hits()
        sync = MongoClient(database.MONGODB_URL)
        db = sync[database.DATABASE_NAME]
        if artisan_email:
            user = db.users.find_one({"email": artisan_email})
            if user:
                user_id = str(user["_id"])
                db.artisan_profiles.delete_many({"user_id": user_id})
            db.users.delete_many({"email": artisan_email})
        if artisan_id:
            db.artisan_profiles.delete_many({"user_id": artisan_id})
            db.notifications.delete_many({"recipient_id": artisan_id})
        sync.close()
