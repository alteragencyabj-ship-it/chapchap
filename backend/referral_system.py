"""
Referral and affiliation helpers for ARTISAN marketplace.
"""

from __future__ import annotations

import os
import re
import secrets
import string
from datetime import UTC, datetime
from typing import Any, Dict, Optional
from urllib.parse import quote_plus

from bson import ObjectId

import database as db_module

_REFERRAL_CHARS = string.ascii_uppercase + string.digits


def normalize_referral_code(raw: Optional[str]) -> str:
    if not raw:
        return ""
    return re.sub(r"[^A-Za-z0-9]", "", str(raw)).upper().strip()


def _prefix_from_name(name_hint: Optional[str]) -> str:
    cleaned = normalize_referral_code(name_hint)
    if not cleaned:
        return "ART"
    return cleaned[:3].ljust(3, "X")


async def generate_unique_referral_id(name_hint: Optional[str] = None) -> str:
    prefix = _prefix_from_name(name_hint)
    for _ in range(40):
        suffix = "".join(secrets.choice(_REFERRAL_CHARS) for _ in range(5))
        code = f"{prefix}{suffix}"
        exists = await db_module.db.users.find_one({"referral_id": code}, {"_id": 1})
        if not exists:
            return code
    raise RuntimeError("Unable to generate unique referral code")


def build_referral_link(referral_id: str) -> str:
    code = normalize_referral_code(referral_id)
    base_url = os.getenv("REFERRAL_BASE_URL", "https://artisan.app/register")
    base_url = base_url.rstrip("/")
    joiner = "&" if "?" in base_url else "?"
    return f"{base_url}{joiner}ref={code}"


def build_qr_code_url(payload: str) -> str:
    return f"https://api.qrserver.com/v1/create-qr-code/?size=220x220&data={quote_plus(payload)}"


async def get_referral_artisan_by_code(raw_code: Optional[str]) -> Optional[Dict[str, Any]]:
    code = normalize_referral_code(raw_code)
    if not code:
        return None
    artisan = await db_module.db.users.find_one(
        {"role": "artisan", "referral_id": code},
        {"_id": 1, "name": 1, "referral_id": 1, "status": 1},
    )
    if not artisan:
        return None
    if artisan.get("status") in {"blocked", "suspended"}:
        return None
    artisan["_id"] = str(artisan["_id"])
    return artisan


async def mark_client_affiliation_if_qualified(client_id: str) -> Dict[str, Any]:
    """
    Mark a referred client as qualified after first validated mission.

    Qualification rule:
    - Client registered with a referral code (`referred_by_artisan_id` set)
    - At least one mission reaches `validee_client`

    Counter is incremented only once per client.
    """
    try:
        client_oid = ObjectId(client_id)
    except Exception:
        return {"qualified": False, "reason": "invalid_client_id"}

    client = await db_module.db.users.find_one(
        {"_id": client_oid},
        {
            "_id": 1,
            "referred_by_artisan_id": 1,
            "referred_by_referral_id": 1,
            "affiliation_qualified": 1,
        },
    )
    if not client:
        return {"qualified": False, "reason": "client_not_found"}

    artisan_id = client.get("referred_by_artisan_id")
    if not artisan_id:
        return {"qualified": False, "reason": "not_referred"}

    if client.get("affiliation_qualified"):
        return {"qualified": False, "reason": "already_counted"}

    now = datetime.now(UTC)
    updated = await db_module.db.users.update_one(
        {
            "_id": client_oid,
            "referred_by_artisan_id": artisan_id,
            "affiliation_qualified": {"$ne": True},
        },
        {
            "$set": {
                "affiliation_qualified": True,
                "affiliation_qualified_at": now,
            }
        },
    )
    if updated.modified_count == 0:
        return {"qualified": False, "reason": "race_or_already_counted"}

    try:
        artisan_oid = ObjectId(artisan_id)
    except Exception:
        return {"qualified": False, "reason": "invalid_artisan_id"}

    await db_module.db.users.update_one(
        {"_id": artisan_oid, "role": "artisan"},
        {"$inc": {"affiliated_clients_count": 1}},
    )
    await db_module.db.artisan_profiles.update_one(
        {"user_id": artisan_id},
        {"$inc": {"affiliated_clients_count": 1}},
    )

    return {
        "qualified": True,
        "artisan_id": artisan_id,
        "referral_id": client.get("referred_by_referral_id") or "",
    }
