"""
Client address-book routes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import database as db_module
from address_book import list_client_addresses, save_client_address
from auth import get_current_user


router = APIRouter(prefix="/api/clients/addresses", tags=["clients"])


class ClientAddressCreate(BaseModel):
    address: str = Field(min_length=3)
    quartier: Optional[str] = None
    label: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    source: str = "manual"
    mark_default: bool = True


async def _get_client(current_user: dict) -> dict:
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Only clients can manage saved addresses")
    user["_id"] = str(user["_id"])
    return user


@router.get("")
async def get_saved_addresses(
    limit: int = 10,
    current_user: dict = Depends(get_current_user),
):
    user = await _get_client(current_user)
    safe_limit = min(max(limit, 1), 30)
    addresses = await list_client_addresses(user["_id"], safe_limit)
    return {"items": addresses}


@router.post("")
async def create_or_update_saved_address(
    payload: ClientAddressCreate,
    current_user: dict = Depends(get_current_user),
):
    user = await _get_client(current_user)
    item = await save_client_address(
        client_id=user["_id"],
        address=payload.address,
        quartier=payload.quartier,
        location=payload.location,
        label=payload.label,
        source=payload.source,
        mark_default=payload.mark_default,
    )
    return item

