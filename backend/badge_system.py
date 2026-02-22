"""
BADGE SYSTEM - Systeme de Badges Artisan
=========================================
Evaluates and awards badges based on artisan performance and activity.

Each badge has:
- condition_earn: criteria to earn the badge
- condition_lose: criteria to lose the badge
- frequency: how often to re-evaluate (daily, on_event, monthly)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId

import database as db_module
from scoring_system import compute_trust_score

# =====================================================
# BADGE DEFINITIONS
# =====================================================

BADGE_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "verifie": {
        "label": "Verifie",
        "description": "CNI soumise et telephone verifie",
        "icon": "shield-checkmark",
        "frequency": "on_event",
    },
    "top_artisan": {
        "label": "Top Artisan",
        "description": "Score confiance >= 80, top 10% de sa specialite, 15+ missions",
        "icon": "trophy",
        "frequency": "daily",
    },
    "reactif": {
        "label": "Reactif",
        "description": "Temps de reponse median < 1h sur 30 jours, 10+ demandes",
        "icon": "flash",
        "frequency": "daily",
    },
    "ponctuel": {
        "label": "Ponctuel",
        "description": "A l'heure 90%+ du temps, 10+ missions",
        "icon": "time",
        "frequency": "daily",
    },
    "cinq_etoiles": {
        "label": "5 Etoiles",
        "description": "Moyenne >= 4.8 avec 10+ avis",
        "icon": "star",
        "frequency": "on_event",
    },
    "zero_annulation": {
        "label": "Zero Annulation",
        "description": "20+ missions sans aucune annulation",
        "icon": "checkmark-circle",
        "frequency": "on_event",
    },
    "fidelite_bronze": {
        "label": "Fidelite Bronze",
        "description": "6+ mois d'anciennete avec activite reguliere",
        "icon": "medal-outline",
        "frequency": "monthly",
    },
    "fidelite_argent": {
        "label": "Fidelite Argent",
        "description": "12+ mois d'anciennete avec activite reguliere",
        "icon": "medal",
        "frequency": "monthly",
    },
    "fidelite_or": {
        "label": "Fidelite Or",
        "description": "24+ mois d'anciennete avec activite reguliere",
        "icon": "medal",
        "frequency": "monthly",
    },
}

# expert_[specialite] is dynamic -- generated per specialty
EXPERT_BADGE_PREFIX = "expert_"

COMPLETED_STATUSES = ["completed", "confirmed", "terminee", "validee_client"]
CANCELLED_STATUSES = ["cancelled", "annulee"]


# =====================================================
# INDIVIDUAL BADGE EVALUATORS
# =====================================================

async def _eval_verifie(user_id: str, profile: Dict[str, Any]) -> bool:
    """Badge 'verifie': CNI submitted AND phone verified."""
    return bool(profile.get("cni_photo")) and bool(profile.get("phone_verified"))


async def _eval_top_artisan(user_id: str, profile: Dict[str, Any]) -> bool:
    """Badge 'top_artisan': trust >= 80, top 10% in specialty, min 15 missions."""
    trust = profile.get("score_confiance", 0)
    missions = profile.get("missions_completees", 0)

    if trust < 80 or missions < 15:
        return False

    # Check top 10% in main specialty
    metier = profile.get("metier_principal")
    if not metier:
        return False

    # Count artisans in same specialty
    total_in_specialty = await db_module.db.artisan_profiles.count_documents({
        "metier_principal": metier,
    })
    if total_in_specialty == 0:
        return False

    # Count how many have higher trust
    higher_count = await db_module.db.artisan_profiles.count_documents({
        "metier_principal": metier,
        "score_confiance": {"$gt": trust},
    })

    # Top 10% means rank is within top 10% of total
    rank_percentile = (higher_count / total_in_specialty) * 100
    return rank_percentile <= 10


async def _eval_reactif(user_id: str, profile: Dict[str, Any]) -> bool:
    """Badge 'reactif': median response time < 1h over 30 days, min 10 requests.

    Response time = time between request creation and first message from artisan.
    """
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)

    # Get requests assigned to this artisan in last 30 days
    requests = []
    async for req in db_module.db.service_requests.find({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "created_at": {"$gte": thirty_days_ago},
    }):
        requests.append(req)

    if len(requests) < 10:
        return False

    # Calculate response times
    response_times = []
    for req in requests:
        req_id = str(req["_id"])
        req_created = req.get("created_at")
        if not req_created:
            continue

        # Find first message from artisan in this request's conversation
        first_msg = await db_module.db.messages.find_one(
            {
                "sender_id": user_id,
                "$or": [
                    {"request_id": req_id},
                    {"conversation_id": {"$exists": True}},
                ],
            },
            sort=[("timestamp", 1)],
        )
        if first_msg and first_msg.get("timestamp"):
            delta = first_msg["timestamp"] - req_created
            response_times.append(delta.total_seconds())

    if len(response_times) < 10:
        return False

    # Median
    response_times.sort()
    mid = len(response_times) // 2
    if len(response_times) % 2 == 0:
        median = (response_times[mid - 1] + response_times[mid]) / 2
    else:
        median = response_times[mid]

    return median < 3600  # < 1 hour in seconds


async def _eval_ponctuel(user_id: str, profile: Dict[str, Any]) -> bool:
    """Badge 'ponctuel': on-time 90%+ with min 10 missions.

    On-time = started within 24h of acceptance.
    """
    on_time = 0
    total = 0

    async for req in db_module.db.service_requests.find({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": COMPLETED_STATUSES},
        "accepted_at": {"$exists": True},
        "started_at": {"$exists": True},
    }):
        accepted = req.get("accepted_at")
        started = req.get("started_at")
        if accepted and started:
            total += 1
            if (started - accepted) <= timedelta(hours=24):
                on_time += 1

    if total < 10:
        return False

    return (on_time / total) >= 0.9


async def _eval_cinq_etoiles(user_id: str, profile: Dict[str, Any]) -> bool:
    """Badge 'cinq_etoiles': average rating >= 4.8 with min 10 reviews."""
    nb_avis = await db_module.db.ratings.count_documents({"artisan_id": user_id})
    if nb_avis < 10:
        return False

    pipeline = [
        {"$match": {"artisan_id": user_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}}},
    ]
    result = await db_module.db.ratings.aggregate(pipeline).to_list(1)
    if not result:
        return False

    return result[0]["avg"] >= 4.8


async def _eval_expert(user_id: str, profile: Dict[str, Any], specialite: str) -> bool:
    """Badge 'expert_[specialite]': 30+ missions in specialty AND avg >= 4.5."""
    # Count missions in this specialty
    missions_in_spec = await db_module.db.service_requests.count_documents({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": COMPLETED_STATUSES},
        "service_type": specialite,
    })

    if missions_in_spec < 30:
        return False

    # Check average rating (global, not per specialty)
    nb_avis = await db_module.db.ratings.count_documents({"artisan_id": user_id})
    if nb_avis == 0:
        return False

    pipeline = [
        {"$match": {"artisan_id": user_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}}},
    ]
    result = await db_module.db.ratings.aggregate(pipeline).to_list(1)
    if not result:
        return False

    return result[0]["avg"] >= 4.5


async def _eval_zero_annulation(user_id: str, profile: Dict[str, Any]) -> bool:
    """Badge 'zero_annulation': 20+ missions with 0 cancellations."""
    completed = await db_module.db.service_requests.count_documents({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": COMPLETED_STATUSES},
    })

    if completed < 20:
        return False

    cancelled = await db_module.db.service_requests.count_documents({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": CANCELLED_STATUSES},
    })

    return cancelled == 0


async def _eval_fidelite(
    user_id: str,
    profile: Dict[str, Any],
    min_months: int,
) -> bool:
    """Badge 'fidelite_*': min_months of seniority + at least 1 mission per quarter."""
    created_at = profile.get("created_at")
    if not created_at:
        return False

    now = datetime.now(UTC)
    if created_at.tzinfo is None:
        from datetime import timezone
        created_at = created_at.replace(tzinfo=timezone.utc)

    months_active = (now - created_at).days / 30.44
    if months_active < min_months:
        return False

    # Check activity: at least 1 mission per quarter in the last min_months
    check_start = now - timedelta(days=min_months * 30.44)
    quarters = int(min_months / 3)
    if quarters == 0:
        quarters = 1

    for q in range(quarters):
        q_start = check_start + timedelta(days=q * 91)
        q_end = q_start + timedelta(days=91)
        count = await db_module.db.service_requests.count_documents({
            "$or": [
                {"assigned_artisan_id": user_id},
                {"artisan_id": user_id},
            ],
            "status": {"$in": COMPLETED_STATUSES},
            "created_at": {"$gte": q_start, "$lt": q_end},
        })
        if count == 0:
            return False

    return True


# =====================================================
# MAIN EVALUATOR
# =====================================================

async def evaluate_badges(user_id: str) -> List[str]:
    """Evaluate all badges for an artisan. Returns the list of earned badge keys.

    This is the main entry point. It checks every badge condition and
    returns the complete list of badges the artisan currently qualifies for.
    """
    profile = await db_module.db.artisan_profiles.find_one({"user_id": user_id})
    if not profile:
        return []

    earned: List[str] = []

    # verifie
    if await _eval_verifie(user_id, profile):
        earned.append("verifie")

    # top_artisan
    if await _eval_top_artisan(user_id, profile):
        earned.append("top_artisan")

    # reactif
    if await _eval_reactif(user_id, profile):
        earned.append("reactif")

    # ponctuel
    if await _eval_ponctuel(user_id, profile):
        earned.append("ponctuel")

    # cinq_etoiles
    if await _eval_cinq_etoiles(user_id, profile):
        earned.append("cinq_etoiles")

    # zero_annulation
    if await _eval_zero_annulation(user_id, profile):
        earned.append("zero_annulation")

    # expert_[specialite] for each specialty
    specialites = profile.get("specialites") or []
    metier = profile.get("metier_principal")
    all_specs = list(set(specialites + ([metier] if metier else [])))
    for spec in all_specs:
        if spec and await _eval_expert(user_id, profile, spec):
            earned.append(f"{EXPERT_BADGE_PREFIX}{spec}")

    # fidelite tiers (highest wins, but we track all earned)
    if await _eval_fidelite(user_id, profile, 24):
        earned.append("fidelite_or")
    elif await _eval_fidelite(user_id, profile, 12):
        earned.append("fidelite_argent")
    elif await _eval_fidelite(user_id, profile, 6):
        earned.append("fidelite_bronze")

    return earned


async def refresh_badges(user_id: str) -> List[str]:
    """Evaluate badges and persist them to the artisan profile.

    Returns the updated badge list.
    """
    badges = await evaluate_badges(user_id)

    now = datetime.now(UTC)
    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"badges": badges, "updated_at": now}},
    )

    return badges


def get_badge_info(badge_key: str) -> Dict[str, Any]:
    """Get display info for a badge key.

    Handles both static badges and dynamic expert_[specialite] badges.
    """
    if badge_key in BADGE_DEFINITIONS:
        return {
            "key": badge_key,
            **BADGE_DEFINITIONS[badge_key],
        }

    # Dynamic expert badge
    if badge_key.startswith(EXPERT_BADGE_PREFIX):
        specialite = badge_key[len(EXPERT_BADGE_PREFIX):]
        return {
            "key": badge_key,
            "label": f"Expert {specialite.capitalize()}",
            "description": f"30+ missions en {specialite} avec moyenne >= 4.5",
            "icon": "ribbon",
            "frequency": "daily",
        }

    return {
        "key": badge_key,
        "label": badge_key,
        "description": "Badge inconnu",
        "icon": "help-circle",
        "frequency": "unknown",
    }


def list_all_badges() -> List[Dict[str, Any]]:
    """Return all static badge definitions for display in the UI."""
    result = []
    for key, defn in BADGE_DEFINITIONS.items():
        result.append({"key": key, **defn})
    return result
