"""
Service Request State Machine for ARTISAN -- V2 (13 States)
==============================================================
Full lifecycle:

    DEMANDE_ENVOYEE -> DEVIS_ENVOYE -> ACCEPTEE -> PAIEMENT_ESCROW
    -> ARTISAN_EN_ROUTE -> MISSION_EN_COURS -> TERMINEE -> VALIDEE_CLIENT

    Also: ANNULEE (cancellation), EXPIREE (timeout), LITIGE (dispute)

Each transition:
1. Validates the permission (who can trigger)
2. Applies guard conditions (cancellation rules, escrow logic)
3. Updates status + status_history
4. Emits an event via the event bus

Backward compatible: legacy states are mapped to new states via LEGACY_STATE_MAP.
"""

from datetime import datetime
from enum import Enum
from typing import Dict, Any, Optional, List, Set

from bson import ObjectId
from fastapi import HTTPException

import database as db_module
from events import emit
from models import RequestStatus


# =====================================================================
# LEGACY STATE MAP -- Old 6-state -> New 13-state
# =====================================================================

LEGACY_STATE_MAP: Dict[str, RequestStatus] = {
    "created": RequestStatus.DEMANDE_ENVOYEE,
    "published": RequestStatus.DEMANDE_ENVOYEE,
    "accepted": RequestStatus.ACCEPTEE,
    "in_progress": RequestStatus.MISSION_EN_COURS,
    "completed": RequestStatus.TERMINEE,
    "confirmed": RequestStatus.VALIDEE_CLIENT,
    "refused": RequestStatus.EXPIREE,
    "cancelled": RequestStatus.ANNULEE,
    "disputed": RequestStatus.LITIGE,
    "resolved": RequestStatus.VALIDEE_CLIENT,
}


def normalize_status(raw: str) -> RequestStatus:
    """Convert any status string (legacy or new) to the canonical RequestStatus.

    Raises ValueError if the status is completely unknown.
    """
    # Try direct enum match first, then canonicalize legacy aliases.
    try:
        parsed = RequestStatus(raw)
        if parsed.value in LEGACY_STATE_MAP:
            return LEGACY_STATE_MAP[parsed.value]
        return parsed
    except ValueError:
        pass
    # Try legacy map
    if raw in LEGACY_STATE_MAP:
        return LEGACY_STATE_MAP[raw]
    raise ValueError(f"Unknown status: {raw}")


# =====================================================================
# TRANSITION TABLE
# =====================================================================
# Format: current_status -> {target_status: required_role}
# "any" = client, artisan, or admin
# "system" = automated (timeouts, scheduler)

TRANSITIONS: Dict[RequestStatus, Dict[RequestStatus, str]] = {
    RequestStatus.DEMANDE_ENVOYEE: {
        RequestStatus.DEVIS_ENVOYE: "artisan",
        RequestStatus.ACCEPTEE: "artisan",   # Fast-path accept (no quote step)
        RequestStatus.ANNULEE: "any",
        RequestStatus.EXPIREE: "system",
    },
    RequestStatus.DEVIS_ENVOYE: {
        RequestStatus.ACCEPTEE: "client",
        RequestStatus.ANNULEE: "any",
        RequestStatus.EXPIREE: "system",
    },
    RequestStatus.ACCEPTEE: {
        RequestStatus.PAIEMENT_ESCROW: "client",
        RequestStatus.ARTISAN_EN_ROUTE: "artisan",  # Fast-path for cash/no-escrow flows
        RequestStatus.ANNULEE: "any",
        RequestStatus.EXPIREE: "system",
    },
    RequestStatus.PAIEMENT_ESCROW: {
        RequestStatus.ARTISAN_EN_ROUTE: "artisan",
        RequestStatus.ANNULEE: "any",       # With 5% fee deduction
        RequestStatus.EXPIREE: "system",    # 72h no departure -> full refund
    },
    RequestStatus.ARTISAN_EN_ROUTE: {
        RequestStatus.MISSION_EN_COURS: "artisan",
        RequestStatus.LITIGE: "any",        # No cancel after departure
        RequestStatus.ANNULEE: "any",       # Technically reachable, blocked by cancellation guard
    },
    RequestStatus.MISSION_EN_COURS: {
        RequestStatus.TERMINEE: "artisan",
        RequestStatus.LITIGE: "any",
        RequestStatus.ANNULEE: "any",       # Technically reachable, blocked by cancellation guard
    },
    RequestStatus.TERMINEE: {
        RequestStatus.VALIDEE_CLIENT: "client",
        RequestStatus.LITIGE: "any",
        RequestStatus.EXPIREE: "system",    # 72h auto-validate
        RequestStatus.ANNULEE: "any",       # Technically reachable, blocked by cancellation guard
    },
    RequestStatus.LITIGE: {
        RequestStatus.VALIDEE_CLIENT: "admin",
        RequestStatus.ANNULEE: "admin",
    },
    # Terminal states -- no outgoing transitions
    RequestStatus.VALIDEE_CLIENT: {},
    RequestStatus.ANNULEE: {},
    RequestStatus.EXPIREE: {},
}


# =====================================================================
# TRANSITION EVENTS
# =====================================================================

TRANSITION_EVENTS: Dict[RequestStatus, str] = {
    RequestStatus.DEMANDE_ENVOYEE: "request.created",
    RequestStatus.DEVIS_ENVOYE: "request.quote_sent",
    RequestStatus.ACCEPTEE: "request.accepted",
    RequestStatus.PAIEMENT_ESCROW: "request.escrow_paid",
    RequestStatus.ARTISAN_EN_ROUTE: "request.artisan_departed",
    RequestStatus.MISSION_EN_COURS: "request.work_started",
    RequestStatus.TERMINEE: "request.work_completed",
    RequestStatus.VALIDEE_CLIENT: "request.validated",
    RequestStatus.ANNULEE: "request.cancelled",
    RequestStatus.EXPIREE: "request.expired",
    RequestStatus.LITIGE: "request.disputed",
}


# =====================================================================
# TIMEOUT CONSTANTS (seconds)
# =====================================================================

class Timeouts:
    """Timeout durations triggering automatic state transitions."""
    NO_ARTISAN_RESPONSE = 24 * 3600        # 24h: DEMANDE_ENVOYEE -> EXPIREE
    NO_CLIENT_RESPONSE_QUOTE = 48 * 3600   # 48h: DEVIS_ENVOYE -> EXPIREE
    NO_PAYMENT_AFTER_ACCEPT = 24 * 3600    # 24h: ACCEPTEE -> EXPIREE
    NO_DEPARTURE_AFTER_PAYMENT = 72 * 3600 # 72h: PAIEMENT_ESCROW -> ANNULEE + full refund


# Map: which state triggers which timeout, and what it transitions to
TIMEOUT_RULES: Dict[RequestStatus, Dict] = {
    RequestStatus.DEMANDE_ENVOYEE: {
        "delay": Timeouts.NO_ARTISAN_RESPONSE,
        "target": RequestStatus.EXPIREE,
        "reason": "Aucune reponse de l'artisan sous 24h",
    },
    RequestStatus.DEVIS_ENVOYE: {
        "delay": Timeouts.NO_CLIENT_RESPONSE_QUOTE,
        "target": RequestStatus.EXPIREE,
        "reason": "Aucune reponse du client au devis sous 48h",
    },
    RequestStatus.ACCEPTEE: {
        "delay": Timeouts.NO_PAYMENT_AFTER_ACCEPT,
        "target": RequestStatus.EXPIREE,
        "reason": "Aucun paiement sous 24h apres acceptation",
    },
    RequestStatus.PAIEMENT_ESCROW: {
        "delay": Timeouts.NO_DEPARTURE_AFTER_PAYMENT,
        "target": RequestStatus.ANNULEE,
        "reason": "Artisan non parti sous 72h — remboursement integral",
        "refund": "full",
    },
}


# =====================================================================
# STATE PERMISSIONS -- Who can do what in each state
# =====================================================================

class Action(str, Enum):
    """Actions that can be performed on a service request."""
    VIEW = "view"
    SEND_QUOTE = "send_quote"
    ACCEPT_QUOTE = "accept_quote"
    PAY = "pay"
    CONFIRM_DEPARTURE = "confirm_departure"
    CONFIRM_ARRIVAL = "confirm_arrival"
    DECLARE_COMPLETE = "declare_complete"
    VALIDATE = "validate"
    CANCEL = "cancel"
    DISPUTE = "dispute"
    CHAT = "chat"
    VIEW_ARTISAN_PHONE = "view_artisan_phone"
    VIEW_CLIENT_ADDRESS = "view_client_address"
    ADMIN_RESOLVE = "admin_resolve"


# Format: state -> {action: set of roles allowed}
STATE_PERMISSIONS: Dict[RequestStatus, Dict[Action, Set[str]]] = {
    RequestStatus.DEMANDE_ENVOYEE: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.SEND_QUOTE: {"artisan"},
        Action.CANCEL: {"client", "artisan", "admin"},
        Action.CHAT: set(),  # Chat not yet available
        Action.VIEW_ARTISAN_PHONE: set(),
        Action.VIEW_CLIENT_ADDRESS: set(),
    },
    RequestStatus.DEVIS_ENVOYE: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.ACCEPT_QUOTE: {"client"},
        Action.CANCEL: {"client", "artisan", "admin"},
        Action.CHAT: {"client", "artisan"},  # Chat opens at DEVIS_ENVOYE
        Action.VIEW_ARTISAN_PHONE: set(),
        Action.VIEW_CLIENT_ADDRESS: set(),
    },
    RequestStatus.ACCEPTEE: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.PAY: {"client"},
        Action.CONFIRM_DEPARTURE: {"artisan"},  # Fast-path: skip escrow, go en route
        Action.CANCEL: {"client", "artisan", "admin"},
        Action.CHAT: {"client", "artisan"},
        Action.VIEW_ARTISAN_PHONE: set(),
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},  # Address visible from ACCEPTEE
    },
    RequestStatus.PAIEMENT_ESCROW: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.CONFIRM_DEPARTURE: {"artisan"},
        Action.CANCEL: {"client", "artisan", "admin"},  # With 5% fee
        Action.CHAT: {"client", "artisan"},
        Action.VIEW_ARTISAN_PHONE: set(),
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},
    },
    RequestStatus.ARTISAN_EN_ROUTE: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.CONFIRM_ARRIVAL: {"artisan"},
        Action.DISPUTE: {"client", "artisan"},  # Cancel impossible -> dispute
        Action.CHAT: {"client", "artisan"},
        Action.VIEW_ARTISAN_PHONE: {"client", "admin"},  # Phone visible from EN_ROUTE
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},
    },
    RequestStatus.MISSION_EN_COURS: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.DECLARE_COMPLETE: {"artisan"},
        Action.DISPUTE: {"client", "artisan"},
        Action.CHAT: {"client", "artisan"},
        Action.VIEW_ARTISAN_PHONE: {"client", "admin"},
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},
    },
    RequestStatus.TERMINEE: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.VALIDATE: {"client"},
        Action.DISPUTE: {"client", "artisan"},
        Action.CHAT: {"client", "artisan"},
        Action.VIEW_ARTISAN_PHONE: {"client", "admin"},
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},
    },
    RequestStatus.VALIDEE_CLIENT: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.CHAT: {"client", "artisan"},  # Can still chat after validation
        Action.VIEW_ARTISAN_PHONE: {"client", "admin"},
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},
    },
    RequestStatus.ANNULEE: {
        Action.VIEW: {"client", "artisan", "admin"},
    },
    RequestStatus.EXPIREE: {
        Action.VIEW: {"client", "artisan", "admin"},
    },
    RequestStatus.LITIGE: {
        Action.VIEW: {"client", "artisan", "admin"},
        Action.VALIDATE: {"admin"},
        Action.ADMIN_RESOLVE: {"admin"},
        Action.CHAT: {"client", "artisan", "admin"},
        Action.VIEW_ARTISAN_PHONE: {"client", "admin"},
        Action.VIEW_CLIENT_ADDRESS: {"artisan", "admin"},
    },
}


# =====================================================================
# BLOCKING MESSAGES -- French messages for forbidden actions
# =====================================================================

BLOCKING_MESSAGES: Dict[str, str] = {
    "cancel_after_departure": (
        "Annulation impossible apres le depart de l'artisan. "
        "Veuillez ouvrir un litige si necessaire."
    ),
    "cancel_during_mission": (
        "Annulation impossible pendant la mission. "
        "Ouvrez un litige pour signaler un probleme."
    ),
    "invalid_transition": (
        "Cette action n'est pas possible dans l'etat actuel de la demande."
    ),
    "expected_status_mismatch": (
        "La demande a ete modifiee entre-temps. Veuillez recharger l'ecran."
    ),
    "permission_denied_client": (
        "Seul le client peut effectuer cette action."
    ),
    "permission_denied_artisan": (
        "Seul l'artisan assigne peut effectuer cette action."
    ),
    "permission_denied_admin": (
        "Seul un administrateur peut effectuer cette action."
    ),
    "permission_denied_participant": (
        "Action reservee aux participants de la mission."
    ),
    "request_not_found": (
        "Demande introuvable."
    ),
    "already_terminal": (
        "Cette demande est terminee et ne peut plus etre modifiee."
    ),
    "escrow_not_paid": (
        "Le paiement escrow doit etre effectue avant de continuer."
    ),
    "quote_required": (
        "L'artisan doit d'abord envoyer un devis."
    ),
    "payment_required": (
        "Le paiement doit etre effectue avant que l'artisan ne parte."
    ),
    "chat_not_available": (
        "Le chat n'est disponible qu'a partir de l'envoi du devis."
    ),
    "phone_not_visible": (
        "Le telephone de l'artisan n'est visible qu'une fois en route."
    ),
    "address_not_visible": (
        "L'adresse exacte du client n'est visible qu'apres acceptation du devis."
    ),
}


# =====================================================================
# CANCELLATION RULES
# =====================================================================

class CancellationResult:
    """Result of evaluating cancellation eligibility."""

    def __init__(self, allowed: bool, refund_type: str = "none",
                 fee_pct: float = 0.0, message: str = ""):
        self.allowed = allowed
        self.refund_type = refund_type  # "none", "full", "partial"
        self.fee_pct = fee_pct          # Platform fee percentage (0.0 - 1.0)
        self.message = message

    def to_dict(self) -> Dict[str, Any]:
        return {
            "allowed": self.allowed,
            "refund_type": self.refund_type,
            "fee_pct": self.fee_pct,
            "message": self.message,
        }


# States where cancellation sends to ANNULEE (no escrow involved)
_FREE_CANCEL_STATES = {
    RequestStatus.DEMANDE_ENVOYEE,
    RequestStatus.DEVIS_ENVOYE,
    RequestStatus.ACCEPTEE,
}

# States where cancel is impossible (must go through LITIGE)
_NO_CANCEL_STATES = {
    RequestStatus.ARTISAN_EN_ROUTE,
    RequestStatus.MISSION_EN_COURS,
    RequestStatus.TERMINEE,
}


def evaluate_cancellation(current_status: RequestStatus) -> CancellationResult:
    """Determine cancellation rules based on current state.

    - Before PAIEMENT_ESCROW: free cancellation for both sides.
    - PAIEMENT_ESCROW but before ARTISAN_EN_ROUTE: refund minus 5% platform fee.
    - After ARTISAN_EN_ROUTE: cancellation IMPOSSIBLE, must use LITIGE.
    """
    if current_status in _FREE_CANCEL_STATES:
        return CancellationResult(
            allowed=True,
            refund_type="none",  # No payment yet, nothing to refund
            message="Annulation gratuite.",
        )
    if current_status == RequestStatus.PAIEMENT_ESCROW:
        return CancellationResult(
            allowed=True,
            refund_type="partial",
            fee_pct=0.05,
            message="Annulation avec retenue de 5% de frais de plateforme.",
        )
    if current_status in _NO_CANCEL_STATES:
        return CancellationResult(
            allowed=False,
            message=BLOCKING_MESSAGES["cancel_after_departure"],
        )
    # Terminal or LITIGE states
    return CancellationResult(
        allowed=False,
        message=BLOCKING_MESSAGES["already_terminal"],
    )


# =====================================================================
# VISIBILITY HELPERS
# =====================================================================

# States where artisan phone is visible to the client
_ARTISAN_PHONE_VISIBLE_FROM = {
    RequestStatus.ARTISAN_EN_ROUTE,
    RequestStatus.MISSION_EN_COURS,
    RequestStatus.TERMINEE,
    RequestStatus.VALIDEE_CLIENT,
    RequestStatus.LITIGE,
}

# States where client exact address is visible to the artisan
_CLIENT_ADDRESS_VISIBLE_FROM = {
    RequestStatus.ARTISAN_EN_ROUTE,
    RequestStatus.MISSION_EN_COURS,
    RequestStatus.TERMINEE,
    RequestStatus.VALIDEE_CLIENT,
    RequestStatus.LITIGE,
}

# States where chat is available
_CHAT_AVAILABLE_FROM = {
    RequestStatus.DEVIS_ENVOYE,
    RequestStatus.ACCEPTEE,
    RequestStatus.PAIEMENT_ESCROW,
    RequestStatus.ARTISAN_EN_ROUTE,
    RequestStatus.MISSION_EN_COURS,
    RequestStatus.TERMINEE,
    RequestStatus.VALIDEE_CLIENT,
    RequestStatus.LITIGE,
}


def is_artisan_phone_visible(status: RequestStatus) -> bool:
    """Return True if the artisan's phone should be shown to the client."""
    return status in _ARTISAN_PHONE_VISIBLE_FROM


def is_client_address_visible(status: RequestStatus) -> bool:
    """Return True if the client's exact address should be shown to the artisan."""
    return status in _CLIENT_ADDRESS_VISIBLE_FROM


def is_chat_available(status: RequestStatus) -> bool:
    """Return True if chat is available between client and artisan."""
    return status in _CHAT_AVAILABLE_FROM


def check_permission(status: RequestStatus, action: Action, role: str) -> bool:
    """Check if a role is allowed to perform an action in a given state."""
    perms = STATE_PERMISSIONS.get(status, {})
    allowed_roles = perms.get(action, set())
    return role in allowed_roles


# =====================================================================
# TIMESTAMP FIELDS PER STATE
# =====================================================================

_TIMESTAMP_MAP: Dict[RequestStatus, str] = {
    RequestStatus.DEMANDE_ENVOYEE: "created_at",
    RequestStatus.DEVIS_ENVOYE: "quote_sent_at",
    RequestStatus.ACCEPTEE: "accepted_at",
    RequestStatus.PAIEMENT_ESCROW: "escrow_paid_at",
    RequestStatus.ARTISAN_EN_ROUTE: "departed_at",
    RequestStatus.MISSION_EN_COURS: "started_at",
    RequestStatus.TERMINEE: "completed_at",
    RequestStatus.VALIDEE_CLIENT: "validated_at",
    RequestStatus.ANNULEE: "cancelled_at",
    RequestStatus.EXPIREE: "expired_at",
    RequestStatus.LITIGE: "disputed_at",
}


# =====================================================================
# CORE TRANSITION FUNCTION
# =====================================================================

async def transition(
    request_id: str,
    new_status: RequestStatus,
    actor_id: str,
    actor_role: str,
    expected_current_status: Optional[RequestStatus | str] = None,
    reason: Optional[str] = None,
    admin_note: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute a state transition on a service request.

    Returns the updated request document.
    Raises HTTPException on invalid transition, permission error, or guard failure.
    """
    # ------------------------------------------------------------------
    # 1. Fetch request
    # ------------------------------------------------------------------
    request = await db_module.db.service_requests.find_one(
        {"_id": ObjectId(request_id)}
    )
    if not request:
        raise HTTPException(status_code=404, detail=BLOCKING_MESSAGES["request_not_found"])

    raw_status = request["status"]
    current_status = normalize_status(raw_status)

    # Canonicalize target status (legacy aliases -> canonical enum)
    target_status = normalize_status(new_status.value if isinstance(new_status, RequestStatus) else str(new_status))

    # Optional optimistic-lock guard
    if expected_current_status is not None:
        expected = normalize_status(
            expected_current_status.value
            if isinstance(expected_current_status, RequestStatus)
            else str(expected_current_status)
        )
        if expected != current_status:
            raise HTTPException(
                status_code=409,
                detail=BLOCKING_MESSAGES["expected_status_mismatch"],
            )

    # Idempotent transition: already in target state
    if current_status == target_status:
        # Safety net: if we're already TERMINEE but wallet was never applied,
        # retry the wallet update now.  This handles the case where a prior
        # attempt committed the status change but crashed before applying
        # financials.
        if target_status == RequestStatus.TERMINEE and not request.get("financials_applied_at"):
            import logging as _sm_logging
            _sm_logger = _sm_logging.getLogger(__name__)
            _sm_logger.warning(
                "WALLET_RETRY_ON_IDEMPOTENT request=%s — status is terminee but financials never applied",
                request_id,
            )
            try:
                from wallet_service import apply_mission_completion
                await apply_mission_completion(request_id)
                _sm_logger.info("WALLET_RETRY_SUCCESS request=%s", request_id)
                # Re-read to return the most up-to-date doc
                request = await db_module.db.service_requests.find_one(
                    {"_id": ObjectId(request_id)}
                )
            except Exception as exc:
                _sm_logger.exception(
                    "WALLET_RETRY_FAIL request=%s error=%s", request_id, exc,
                )
                # Don't block the response — the mission IS terminee,
                # the safety net in /credit/status will catch it later.
        request["_id"] = str(request["_id"])
        return request

    # ------------------------------------------------------------------
    # 2. Validate transition is allowed
    # ------------------------------------------------------------------
    allowed = TRANSITIONS.get(current_status, {})
    if target_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=BLOCKING_MESSAGES.get(
                "invalid_transition",
                f"Transition impossible: '{current_status.value}' -> '{target_status.value}'"
            ),
        )

    # ------------------------------------------------------------------
    # 3. Validate actor permission
    # ------------------------------------------------------------------
    required_role = allowed[target_status]

    # Common participant check for non-admin/non-system actors.
    # Prevents arbitrary users from using transitions mapped to "any".
    is_admin_actor = actor_role == "admin"
    is_system_actor = actor_role == "system" or actor_id == "system"
    is_client_owner = request.get("client_id") == actor_id
    assigned_artisan_id = request.get("assigned_artisan_id") or request.get("artisan_id")
    is_assigned_artisan = assigned_artisan_id == actor_id

    # Fast-path accept: artisan may not be assigned yet (broadcast request).
    # Allow artisan to accept if no artisan is assigned yet.
    is_accepting_unassigned = (
        actor_role == "artisan"
        and target_status == RequestStatus.ACCEPTEE
        and not assigned_artisan_id
    )

    is_participant = is_client_owner or is_assigned_artisan or is_accepting_unassigned
    if not (is_admin_actor or is_system_actor or is_participant):
        raise HTTPException(
            status_code=403,
            detail=BLOCKING_MESSAGES["permission_denied_participant"],
        )

    if required_role == "system":
        # System transitions can be triggered by any role (scheduler, admin)
        pass
    elif required_role != "any":
        if required_role == "client":
            if not is_client_owner and not is_admin_actor:
                raise HTTPException(
                    status_code=403,
                    detail=BLOCKING_MESSAGES["permission_denied_client"],
                )
        elif required_role == "artisan":
            if not is_assigned_artisan and not is_admin_actor and not is_accepting_unassigned:
                raise HTTPException(
                    status_code=403,
                    detail=BLOCKING_MESSAGES["permission_denied_artisan"],
                )
        elif required_role == "admin":
            if not is_admin_actor:
                raise HTTPException(
                    status_code=403,
                    detail=BLOCKING_MESSAGES["permission_denied_admin"],
                )

    # ------------------------------------------------------------------
    # 4. Apply cancellation guard
    # ------------------------------------------------------------------
    cancellation_info = None
    if target_status == RequestStatus.ANNULEE:
        cancel_result = evaluate_cancellation(current_status)
        if not cancel_result.allowed:
            status_code = 409 if current_status in _NO_CANCEL_STATES else 400
            raise HTTPException(status_code=status_code, detail=cancel_result.message)
        cancellation_info = cancel_result.to_dict()

    # ------------------------------------------------------------------
    # 5. Build update
    # ------------------------------------------------------------------
    now = datetime.utcnow()
    update_set: Dict[str, Any] = {"status": target_status.value}
    history_entry: Dict[str, Any] = {
        "from": current_status.value,
        "to": target_status.value,
        "actor_id": actor_id,
        "actor_role": actor_role,
        "timestamp": now,
        "reason": reason,
    }

    # Timestamp field
    ts_field = _TIMESTAMP_MAP.get(target_status)
    if ts_field and ts_field != "created_at":
        update_set[ts_field] = now

    # State-specific data
    if target_status == RequestStatus.DEVIS_ENVOYE:
        update_set["assigned_artisan_id"] = actor_id
        if extra_data:
            if "quote_amount" in extra_data:
                update_set["quote_amount"] = extra_data["quote_amount"]
            if "quote_description" in extra_data:
                update_set["quote_description"] = extra_data["quote_description"]

    if target_status == RequestStatus.ACCEPTEE and actor_role == "artisan":
        # Fast-path: artisan accepts directly -- record them as the assigned artisan
        update_set["assigned_artisan_id"] = actor_id

    if target_status == RequestStatus.ANNULEE:
        if reason:
            update_set["cancel_reason"] = reason
        if cancellation_info:
            update_set["cancellation_info"] = cancellation_info

    if target_status == RequestStatus.LITIGE:
        if reason:
            update_set["dispute_reason"] = reason

    if admin_note:
        update_set["admin_note"] = admin_note

    # ------------------------------------------------------------------
    # 6. Execute update
    # ------------------------------------------------------------------
    update_res = await db_module.db.service_requests.update_one(
        {
            "_id": ObjectId(request_id),
            # Compare-and-set to avoid duplicate transitions under concurrency.
            "status": raw_status,
        },
        {
            "$set": update_set,
            "$push": {"status_history": history_entry},
        },
    )

    if update_res.modified_count == 0:
        # Another transition likely won the race.
        latest = await db_module.db.service_requests.find_one({"_id": ObjectId(request_id)})
        if latest:
            latest_status = normalize_status(latest.get("status", ""))
            if latest_status == target_status:
                # For accept transitions, verify this actor is the winner
                if target_status == RequestStatus.ACCEPTEE:
                    winner = latest.get("assigned_artisan_id")
                    if winner and winner != actor_id:
                        raise HTTPException(
                            status_code=409,
                            detail="Cette mission a deja ete acceptee par un autre artisan.",
                        )
                latest["_id"] = str(latest["_id"])
                return latest
        raise HTTPException(
            status_code=409,
            detail=BLOCKING_MESSAGES["expected_status_mismatch"],
        )

    wallet_update_result: Optional[Dict[str, Any]] = None
    if target_status == RequestStatus.TERMINEE:
        try:
            from wallet_service import apply_mission_completion

            wallet_update_result = await apply_mission_completion(request_id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail="Echec mise a jour portefeuille apres mission terminee",
            ) from exc

    # ------------------------------------------------------------------
    # 7. Emit event
    # ------------------------------------------------------------------
    event_name = TRANSITION_EVENTS.get(target_status)
    if event_name:
        # Use update_set values when available (they reflect the new state)
        artisan_id_for_event = (
            update_set.get("assigned_artisan_id")
            or request.get("assigned_artisan_id")
            or request.get("artisan_id")
            or actor_id
        )
        event_data: Dict[str, Any] = {
            "request_id": request_id,
            "request": request,
            "previous_status": current_status.value,
            "new_status": target_status.value,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "client_id": request.get("client_id"),
            "artisan_id": artisan_id_for_event,
            "reason": reason,
            "service_type": request.get("service_type"),
            "service_name": request.get("service_name"),
            "budget": request.get("budget"),
            "service_price": request.get("service_price"),
        }
        if cancellation_info:
            event_data["cancellation_info"] = cancellation_info
        if extra_data:
            event_data.update(extra_data)
        if wallet_update_result is not None:
            event_data["wallet_update"] = wallet_update_result
        await emit(event_name, **event_data)

        # Realtime mission synchronization across all artisan/client tabs.
        try:
            from socketio_server import emit_mission_update

            await emit_mission_update(
                client_id=request.get("client_id"),
                artisan_id=artisan_id_for_event,
                payload={
                    "request_id": request_id,
                    "previous_status": current_status.value,
                    "status": target_status.value,
                    "actor_id": actor_id,
                    "actor_role": actor_role,
                    "event": event_name,
                    "updated_at": datetime.utcnow().isoformat(),
                },
            )
        except Exception:
            # Do not fail transitions if realtime emit fails.
            pass

    # ------------------------------------------------------------------
    # 8. Schedule timeout for new state (if applicable)
    # ------------------------------------------------------------------
    await _schedule_timeout(request_id, target_status, request)

    # ------------------------------------------------------------------
    # 9. Return updated doc
    # ------------------------------------------------------------------
    updated = await db_module.db.service_requests.find_one(
        {"_id": ObjectId(request_id)}
    )
    updated["_id"] = str(updated["_id"])
    return updated


# =====================================================================
# TIMEOUT SCHEDULING
# =====================================================================

async def _schedule_timeout(
    request_id: str,
    new_status: RequestStatus,
    request: Dict[str, Any],
) -> None:
    """Schedule an automatic timeout transition if the new state has a timeout rule.

    Uses DB-persistent scheduler so timeouts survive server restarts.
    """
    from scheduler import cancel_scheduled, schedule_timeout

    # Cancel any existing timeouts for this request when entering a new state
    timeout_key = f"timeout:{request_id}"
    await cancel_scheduled(timeout_key)

    rule = TIMEOUT_RULES.get(new_status)
    if not rule:
        return

    await schedule_timeout(
        key=timeout_key,
        request_id=request_id,
        delay_seconds=rule["delay"],
        target_status=rule["target"].value,
        from_status=new_status.value,
        reason=rule["reason"],
    )


# =====================================================================
# CONVENIENCE: Get available actions for a user on a request
# =====================================================================

def get_available_actions(
    status: RequestStatus,
    role: str,
    is_owner: bool = False,
) -> List[str]:
    """Return list of action names available to a role in the given state.

    Args:
        status: Current request status.
        role: User role ("client", "artisan", "admin").
        is_owner: True if the user is the client or assigned artisan.
    """
    perms = STATE_PERMISSIONS.get(status, {})
    actions = []
    for action, allowed_roles in perms.items():
        if role in allowed_roles:
            actions.append(action.value)
    return actions


def get_status_display(status: RequestStatus) -> str:
    """Return a human-readable French label for a status."""
    labels = {
        RequestStatus.DEMANDE_ENVOYEE: "Demande envoyee",
        RequestStatus.DEVIS_ENVOYE: "Devis envoye",
        RequestStatus.ACCEPTEE: "Devis accepte",
        RequestStatus.PAIEMENT_ESCROW: "Paiement en attente",
        RequestStatus.ARTISAN_EN_ROUTE: "Artisan en route",
        RequestStatus.MISSION_EN_COURS: "Mission en cours",
        RequestStatus.TERMINEE: "En attente validation client",
        RequestStatus.VALIDEE_CLIENT: "Mission validee",
        RequestStatus.ANNULEE: "Annulee",
        RequestStatus.EXPIREE: "Expiree",
        RequestStatus.LITIGE: "Litige en cours",
    }
    return labels.get(status, status.value)
