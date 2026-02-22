"""
Service Request Routes -- canonical state-machine API.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

import credit_system
import database as db_module
from address_book import save_client_address
from auth import get_current_user
from models import (
    RequestCancel,
    RequestConfirm,
    RequestDispute,
    RequestRefuse,
    RequestStatus,
    RequestTransition,
    ServiceRequest,
    ServiceRequestCreate,
)
from state_machine import (
    get_available_actions,
    is_artisan_phone_visible,
    is_client_address_visible,
    is_chat_available,
    normalize_status,
    transition,
)

router = APIRouter(prefix="/api/requests", tags=["requests"])


async def _get_user(current_user: dict) -> dict:
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return user


async def _get_request_or_404(request_id: str) -> dict:
    try:
        req = await db_module.db.service_requests.find_one({"_id": ObjectId(request_id)})
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request id") from exc
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


def _is_participant(user_id: str, req: dict) -> bool:
    return user_id in [
        req.get("client_id"),
        req.get("assigned_artisan_id"),
        req.get("artisan_id"),
    ]


async def _get_user_by_id(user_id: Optional[str]) -> Optional[dict]:
    if not user_id:
        return None
    try:
        return await db_module.db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        return None


async def _get_artisan_domains(user: dict) -> List[str]:
    """Resolve immutable artisan domains from profile first, then user fallback."""
    if user.get("role") != "artisan":
        return []

    uid = user["_id"]
    profile = await db_module.db.artisan_profiles.find_one(
        {"user_id": uid},
        {"domaines_specialite": 1, "specialites": 1},
    )
    domains = []
    if profile:
        domains = profile.get("domaines_specialite") or []
        if not domains:
            domains = profile.get("specialites") or []
    if not domains:
        domains = user.get("specialty_domains") or user.get("specialties") or []

    normalized = []
    seen = set()
    for raw in domains:
        val = str(raw).strip().lower()
        if not val or val in seen:
            continue
        seen.add(val)
        normalized.append(val)
    return normalized


@router.post("", response_model=ServiceRequest)
async def create_request(
    data: ServiceRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new request in canonical state `demande_envoyee`."""
    user = await _get_user(current_user)

    req = data.model_dump()
    req["client_id"] = user["_id"]
    req["status"] = RequestStatus.DEMANDE_ENVOYEE.value
    req["status_history"] = [
        {
            "from": None,
            "to": RequestStatus.DEMANDE_ENVOYEE.value,
            "actor_id": user["_id"],
            "actor_role": user["role"],
            "timestamp": datetime.utcnow(),
        }
    ]
    req["created_at"] = datetime.utcnow()

    # If targeting a specific artisan, set assigned_artisan_id
    if data.artisan_id:
        artisan = await db_module.db.users.find_one(
            {"_id": ObjectId(data.artisan_id), "role": "artisan"}
        )
        if not artisan:
            raise HTTPException(status_code=404, detail="Artisan not found")
        req["assigned_artisan_id"] = data.artisan_id

    result = await db_module.db.service_requests.insert_one(req)
    req["_id"] = str(result.inserted_id)

    # Save/refresh the client's address book automatically for faster next orders.
    address_text = str(req.get("address", "")).strip()
    quartier_guess = None
    if "," in address_text:
        quartier_guess = address_text.split(",", 1)[0].strip() or None

    if address_text:
        await save_client_address(
            client_id=user["_id"],
            address=address_text,
            quartier=(req.get("quartier") if isinstance(req.get("quartier"), str) else quartier_guess),
            location=req.get("location"),
            source="request",
            mark_default=True,
        )

    # Emit event for notifications
    from events import emit

    await emit(
        "request.created",
        request_id=str(result.inserted_id),
        client_id=user["_id"],
        artisan_id=data.artisan_id,
        service_type=data.service_type,
    )

    return ServiceRequest(**req)


@router.get("", response_model=List[ServiceRequest])
async def list_requests(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Get requests for current user (client sent, artisan received, admin all)."""
    user = await _get_user(current_user)
    uid = user["_id"]

    query = {}
    if user["role"] == "client":
        query["client_id"] = uid
    elif user["role"] == "artisan":
        artisan_domains = await _get_artisan_domains(user)
        broadcast_filter: dict = {"status": "demande_envoyee"}
        if artisan_domains:
            broadcast_filter["service_type"] = {"$in": artisan_domains}
        query["$or"] = [
            {"assigned_artisan_id": uid},
            {"artisan_id": uid},
            # Broadcast missions: no artisan assigned yet, still awaiting acceptance
            {"assigned_artisan_id": None, **broadcast_filter},
            {"assigned_artisan_id": {"$exists": False}, **broadcast_filter},
        ]
    # Admin: no filter

    if status:
        try:
            query["status"] = normalize_status(status).value
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Unknown status: {status}") from exc

    skip = (page - 1) * limit
    results = []
    async for req in (
        db_module.db.service_requests.find(query)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    ):
        req["_id"] = str(req["_id"])
        results.append(ServiceRequest(**req))
    return results


@router.get("/count")
async def count_requests(
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Lightweight count of requests matching filters (avoids full payload)."""
    user = await _get_user(current_user)
    uid = user["_id"]

    query: dict = {}
    if user["role"] == "client":
        query["client_id"] = uid
    elif user["role"] == "artisan":
        artisan_domains = await _get_artisan_domains(user)
        broadcast_filter: dict = {"status": "demande_envoyee"}
        if artisan_domains:
            broadcast_filter["service_type"] = {"$in": artisan_domains}
        query["$or"] = [
            {"assigned_artisan_id": uid},
            {"artisan_id": uid},
            {"assigned_artisan_id": None, **broadcast_filter},
            {"assigned_artisan_id": {"$exists": False}, **broadcast_filter},
        ]

    if status:
        try:
            query["status"] = normalize_status(status).value
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Unknown status: {status}") from exc

    count = await db_module.db.service_requests.count_documents(query)
    return {"count": count}


@router.get("/{request_id}", response_model=ServiceRequest)
async def get_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single request. Must be participant or admin."""
    user = await _get_user(current_user)
    req = await _get_request_or_404(request_id)

    if not _is_participant(user["_id"], req) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to view this request")

    req["_id"] = str(req["_id"])
    return ServiceRequest(**req)


@router.get("/{request_id}/contact")
async def get_request_contact(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get gated contact details based on current state and role.

    Rule: artisan phone is visible to the client only from `artisan_en_route`.
    """
    user = await _get_user(current_user)
    req = await _get_request_or_404(request_id)

    if not _is_participant(user["_id"], req) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to view contact details")

    status = normalize_status(req["status"])
    client_id = req.get("client_id")
    artisan_id = req.get("assigned_artisan_id") or req.get("artisan_id")

    client = await _get_user_by_id(client_id)
    artisan = await _get_user_by_id(artisan_id)

    is_client = user["_id"] == client_id
    is_artisan = user["_id"] == artisan_id
    is_admin = user["role"] == "admin"

    artisan_phone_visible = False
    client_phone_visible = False

    if is_admin:
        artisan_phone_visible = artisan is not None
        client_phone_visible = client is not None
    elif is_client:
        artisan_phone_visible = is_artisan_phone_visible(status)
    elif is_artisan:
        client_phone_visible = is_client_address_visible(status)

    return {
        "request_id": request_id,
        "status": status.value,
        "artisan_phone_visible": artisan_phone_visible,
        "artisan_phone": artisan.get("phone") if artisan_phone_visible and artisan else None,
        "client_phone_visible": client_phone_visible,
        "client_phone": client.get("phone") if client_phone_visible and client else None,
    }


@router.get("/{request_id}/available-actions")
async def get_available_actions_endpoint(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return available actions, conversation_id, and contact info for current user."""
    user = await _get_user(current_user)
    req = await _get_request_or_404(request_id)

    if not _is_participant(user["_id"], req) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    status = normalize_status(req["status"])
    client_id = req.get("client_id")
    artisan_id = req.get("assigned_artisan_id") or req.get("artisan_id")

    # Available actions
    actions = get_available_actions(status, user["role"])

    # Conversation
    conversation_id = None
    if is_chat_available(status):
        conv = await db_module.db.conversations.find_one({"request_id": request_id})
        if conv:
            conversation_id = str(conv["_id"])

    # Contact info
    is_client = user["_id"] == client_id
    is_artisan = user["_id"] == artisan_id

    contact = {}
    if is_client and is_artisan_phone_visible(status):
        artisan_user = await _get_user_by_id(artisan_id)
        if artisan_user:
            contact["artisan_phone"] = artisan_user.get("phone")
            contact["artisan_name"] = artisan_user.get("name")
    elif is_artisan and is_client_address_visible(status):
        client_user = await _get_user_by_id(client_id)
        if client_user:
            contact["client_phone"] = client_user.get("phone")
            contact["client_name"] = client_user.get("name")
    elif user["role"] == "admin":
        artisan_user = await _get_user_by_id(artisan_id)
        client_user = await _get_user_by_id(client_id)
        if artisan_user:
            contact["artisan_phone"] = artisan_user.get("phone")
            contact["artisan_name"] = artisan_user.get("name")
        if client_user:
            contact["client_phone"] = client_user.get("phone")
            contact["client_name"] = client_user.get("name")

    return {
        "request_id": request_id,
        "status": status.value,
        "actions": actions,
        "conversation_id": conversation_id,
        "contact": contact,
    }


@router.post("/{request_id}/transition")
async def transition_request(
    request_id: str,
    payload: RequestTransition,
    current_user: dict = Depends(get_current_user),
):
    """Generic strict transition endpoint (recommended for all new clients)."""
    user = await _get_user(current_user)
    target = normalize_status(payload.target_status.value)

    if target == RequestStatus.VALIDEE_CLIENT and not payload.warning_ack:
        raise HTTPException(
            status_code=400,
            detail=(
                "Avertissement obligatoire: confirmez la liberation des fonds "
                "avec warning_ack=true."
            ),
        )

    updated = await transition(
        request_id=request_id,
        new_status=target,
        actor_id=user["_id"],
        actor_role=user["role"],
        expected_current_status=payload.expected_current_status,
        reason=payload.reason,
        admin_note=payload.admin_note,
        extra_data=payload.extra_data,
    )
    return updated


@router.post("/{request_id}/accept")
async def accept_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Legacy shortcut: artisan accepts a request -> `acceptee`."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can accept requests")

    req = await _get_request_or_404(request_id)
    assigned = req.get("assigned_artisan_id") or req.get("artisan_id")
    if not assigned:
        artisan_domains = await _get_artisan_domains(user)
        if artisan_domains:
            req_domain = str(req.get("service_type", "")).strip().lower()
            if req_domain and req_domain not in artisan_domains:
                raise HTTPException(
                    status_code=403,
                    detail="Cette mission n'appartient pas a vos domaines de specialite.",
                )

    # Credit check before accept
    can = await credit_system.check_can_accept_mission(user["_id"])
    if not can["can_accept"]:
        raise HTTPException(status_code=403, detail=can.get("reason", "Cannot accept missions"))

    return await transition(
        request_id,
        RequestStatus.ACCEPTEE,
        user["_id"],
        user["role"],
        reason="accept_legacy_endpoint",
    )


@router.post("/{request_id}/refuse")
async def refuse_request(
    request_id: str,
    body: RequestRefuse | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Legacy shortcut: artisan refuses -> treated as cancellation before departure."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can refuse requests")

    reason = (body.reason if body else None) or "refusee_par_artisan"
    return await transition(
        request_id,
        RequestStatus.ANNULEE,
        user["_id"],
        user["role"],
        reason=reason,
    )


@router.post("/{request_id}/en-route")
async def depart_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Artisan clicks 'Je suis en route'."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can set en route")

    return await transition(
        request_id,
        RequestStatus.ARTISAN_EN_ROUTE,
        user["_id"],
        user["role"],
        reason="depart_confirme",
    )


@router.post("/{request_id}/arrive")
async def arrive_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Artisan confirms on-site arrival -> mission starts."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can start mission")

    return await transition(
        request_id,
        RequestStatus.MISSION_EN_COURS,
        user["_id"],
        user["role"],
        reason="arrivee_confirmee",
    )


@router.post("/{request_id}/start")
async def start_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Legacy shortcut: move to mission started (en_route -> mission_en_cours)."""
    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can start work")

    req = await _get_request_or_404(request_id)
    current = normalize_status(req["status"])

    # If not yet departed, confirm departure first (unlocks phone visibility).
    if current in (RequestStatus.ACCEPTEE, RequestStatus.PAIEMENT_ESCROW):
        await transition(
            request_id,
            RequestStatus.ARTISAN_EN_ROUTE,
            user["_id"],
            user["role"],
            reason="legacy_start_departure",
        )
        current = RequestStatus.ARTISAN_EN_ROUTE

    # Then start the mission.
    if current == RequestStatus.ARTISAN_EN_ROUTE:
        return await transition(
            request_id,
            RequestStatus.MISSION_EN_COURS,
            user["_id"],
            user["role"],
            reason="legacy_start_arrival",
        )

    if current == RequestStatus.MISSION_EN_COURS:
        req["_id"] = str(req["_id"])
        return req

    raise HTTPException(
        status_code=400,
        detail=(
            f"Cannot start mission from status '{current.value}'. "
            "Expected acceptee, paiement_escrow, or artisan_en_route."
        ),
    )


@router.post("/{request_id}/complete")
async def complete_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Artisan declares work completed -> `terminee`.

    If still in artisan_en_route, auto-transitions through mission_en_cours first.
    """
    import logging as _cr_logging
    _cr_logger = _cr_logging.getLogger(__name__)

    user = await _get_user(current_user)
    if user["role"] != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can mark complete")

    req = await _get_request_or_404(request_id)
    current = normalize_status(req["status"])

    _cr_logger.info(
        "MISSION_TERMINATED_PIPELINE request=%s artisan=%s current_status=%s",
        request_id,
        user["_id"],
        current.value,
    )

    # Auto-transition through MISSION_EN_COURS if artisan is still en route
    if current == RequestStatus.ARTISAN_EN_ROUTE:
        await transition(
            request_id,
            RequestStatus.MISSION_EN_COURS,
            user["_id"],
            user["role"],
            expected_current_status=RequestStatus.ARTISAN_EN_ROUTE,
            reason="arrivee_implicite",
        )

    result = await transition(
        request_id,
        RequestStatus.TERMINEE,
        user["_id"],
        user["role"],
        expected_current_status=RequestStatus.MISSION_EN_COURS,
        reason="travail_termine",
    )

    _cr_logger.info(
        "MISSION_TERMINATED_PIPELINE_DONE request=%s financials_applied=%s",
        request_id,
        bool(result.get("financials_applied_at")),
    )

    return result


@router.post("/{request_id}/confirm")
async def confirm_request(
    request_id: str,
    body: RequestConfirm | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Client confirms completion -> final validation + release."""
    user = await _get_user(current_user)
    if user["role"] != "client":
        raise HTTPException(status_code=403, detail="Only clients can confirm")

    if not body or not body.warning_ack:
        raise HTTPException(
            status_code=400,
            detail=(
                "Avertissement obligatoire: en validant, vous liberez les fonds "
                "a l'artisan. Envoyez warning_ack=true."
            ),
        )

    return await transition(
        request_id,
        RequestStatus.VALIDEE_CLIENT,
        user["_id"],
        user["role"],
        reason="validation_client",
    )


@router.post("/{request_id}/cancel")
async def cancel_request(
    request_id: str,
    body: RequestCancel | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a request (blocked automatically after artisan departure)."""
    user = await _get_user(current_user)

    # Verify participant before attempting transition
    req = await _get_request_or_404(request_id)
    if not _is_participant(user["_id"], req) and user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Action reservee aux participants de la mission.",
        )

    reason = body.reason if body else None
    return await transition(
        request_id,
        RequestStatus.ANNULEE,
        user["_id"],
        user["role"],
        reason=reason,
    )


@router.post("/{request_id}/dispute")
async def dispute_request(
    request_id: str,
    body: RequestDispute,
    current_user: dict = Depends(get_current_user),
):
    """Open a dispute and transition request to `litige`."""
    user = await _get_user(current_user)
    req = await _get_request_or_404(request_id)
    if not _is_participant(user["_id"], req) and user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Action reservee aux participants de la mission.",
        )

    dispute_doc = {
        "request_id": request_id,
        "opened_by": user["_id"],
        "reason": body.reason,
        "category": body.category,
        "status": "open",
        "messages": [
            {
                "sender_id": user["_id"],
                "message": body.reason,
                "timestamp": datetime.utcnow(),
                "is_admin": False,
            }
        ],
        "created_at": datetime.utcnow(),
    }
    await db_module.db.disputes.insert_one(dispute_doc)

    return await transition(
        request_id,
        RequestStatus.LITIGE,
        user["_id"],
        user["role"],
        reason=body.reason,
    )
