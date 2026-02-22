"""
Client address book utilities.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from pymongo import ReturnDocument

import database as db_module


def _normalize_address(raw: str) -> str:
    return " ".join(str(raw or "").strip().lower().split())


def _safe_coords(location: Optional[Dict[str, Any]]) -> Optional[List[float]]:
    if not isinstance(location, dict):
        return None
    coords = location.get("coordinates")
    if not isinstance(coords, list) or len(coords) != 2:
        return None
    try:
        lng = float(coords[0])
        lat = float(coords[1])
        return [lng, lat]
    except (TypeError, ValueError):
        return None


async def save_client_address(
    *,
    client_id: str,
    address: str,
    quartier: Optional[str] = None,
    location: Optional[Dict[str, Any]] = None,
    label: Optional[str] = None,
    source: str = "request",
    mark_default: bool = True,
) -> Dict[str, Any]:
    """
    Upsert an address for a client and mark it as most recently used.
    """
    now = datetime.utcnow()
    clean_address = str(address or "").strip()
    if not clean_address:
        raise ValueError("address is required")

    clean_quartier = str(quartier or "").strip() or None
    normalized = _normalize_address(clean_address)
    coords = _safe_coords(location)

    if not label:
        if clean_quartier:
            label = f"{clean_quartier} (recente)"
        else:
            label = "Adresse recente"

    update_set: Dict[str, Any] = {
        "address": clean_address,
        "address_normalized": normalized,
        "quartier": clean_quartier,
        "label": str(label).strip(),
        "source": source,
        "last_used_at": now,
        "updated_at": now,
    }
    if coords:
        update_set["location"] = {"type": "Point", "coordinates": coords}

    doc = await db_module.db.client_addresses.find_one_and_update(
        {
            "client_id": client_id,
            "address_normalized": normalized,
        },
        {
            "$set": update_set,
            "$setOnInsert": {
                "client_id": client_id,
                "is_default": False,
                "created_at": now,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    if mark_default:
        await db_module.db.client_addresses.update_many(
            {
                "client_id": client_id,
                "_id": {"$ne": doc["_id"]},
            },
            {"$set": {"is_default": False, "updated_at": now}},
        )
        await db_module.db.client_addresses.update_one(
            {"_id": doc["_id"]},
            {"$set": {"is_default": True, "updated_at": now}},
        )

    # Keep the current/default address mirrored in users for quick prefill.
    user_update: Dict[str, Any] = {"address": clean_address, "updated_at": now}
    if clean_quartier:
        user_update["quartier"] = clean_quartier
    try:
        await db_module.db.users.update_one(
            {"_id": ObjectId(client_id)},
            {"$set": user_update},
        )
    except Exception:
        # Keep request flow resilient even if user mirror update fails.
        pass

    doc["_id"] = str(doc["_id"])
    return doc


async def list_client_addresses(client_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Return recent/default addresses for a client.
    """
    results: List[Dict[str, Any]] = []
    async for item in (
        db_module.db.client_addresses.find({"client_id": client_id})
        .sort([("is_default", -1), ("last_used_at", -1), ("updated_at", -1)])
        .limit(limit)
    ):
        item["_id"] = str(item["_id"])
        results.append(item)
    return results

