"""
SCORING SYSTEM - Systeme de Score Artisan
==========================================
Calculates profile completion score and trust score (score de confiance).

Trust Score (0-100) = weighted average:
- Profile completion: 10%
- Activity (missions): 20% (logarithmic curve, max at 200)
- Quality (bayesian average of reviews): 35%
- Reliability (completion rate + punctuality): 25%
- Seniority: 10% (linear, max at 24 months)
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId

import database as db_module

# =====================================================
# PROFILE COMPLETION SCORING
# =====================================================

# Each field has a point value. Total = 100.
PROFILE_FIELD_WEIGHTS: Dict[str, int] = {
    "photo_url": 10,
    "name": 5,           # first_name + last_name present
    "phone_verified": 10,
    "localisation": 5,   # ville + quartier present
    "zone_intervention_km": 5,
    "specialite_principale": 5,  # metier_principal present
    "bio": 10,
    "specialites_secondaires": 5,  # at least 1 specialite
    "annees_experience": 5,
    "tarif": 5,
    "cni_photo": 10,
    "diplome": 5,
    "portfolio_3photos": 10,  # galerie_photos >= 3
    "horaires": 5,
    "moyen_paiement": 5,
}

assert sum(PROFILE_FIELD_WEIGHTS.values()) == 100, "Profile weights must sum to 100"


def compute_profile_score(profile: Dict[str, Any]) -> float:
    """Compute profile completion score (0-100).

    Each field contributes a fixed number of points.
    Returns a float between 0.0 and 100.0.
    """
    score = 0

    # photo_url
    if profile.get("photo_url"):
        score += PROFILE_FIELD_WEIGHTS["photo_url"]

    # name (first_name + last_name both non-empty)
    if profile.get("first_name") and profile.get("last_name"):
        score += PROFILE_FIELD_WEIGHTS["name"]

    # phone_verified
    if profile.get("phone_verified"):
        score += PROFILE_FIELD_WEIGHTS["phone_verified"]

    # localisation (ville + quartier)
    if profile.get("ville") and profile.get("quartier"):
        score += PROFILE_FIELD_WEIGHTS["localisation"]

    # zone_intervention_km (explicitly set, not just default)
    if profile.get("zone_intervention_km") and profile["zone_intervention_km"] > 0:
        score += PROFILE_FIELD_WEIGHTS["zone_intervention_km"]

    # specialite_principale (metier_principal)
    if profile.get("metier_principal"):
        score += PROFILE_FIELD_WEIGHTS["specialite_principale"]

    # bio
    if profile.get("bio"):
        score += PROFILE_FIELD_WEIGHTS["bio"]

    # specialites_secondaires (at least 1)
    specialites = profile.get("specialites") or []
    if len(specialites) >= 1:
        score += PROFILE_FIELD_WEIGHTS["specialites_secondaires"]

    # annees_experience
    if profile.get("annees_experience") is not None:
        score += PROFILE_FIELD_WEIGHTS["annees_experience"]

    # tarif
    if profile.get("tarif"):
        score += PROFILE_FIELD_WEIGHTS["tarif"]

    # cni_photo
    if profile.get("cni_photo"):
        score += PROFILE_FIELD_WEIGHTS["cni_photo"]

    # diplome
    if profile.get("diplome"):
        score += PROFILE_FIELD_WEIGHTS["diplome"]

    # portfolio_3photos (galerie_photos >= 3)
    galerie = profile.get("galerie_photos") or []
    if len(galerie) >= 3:
        score += PROFILE_FIELD_WEIGHTS["portfolio_3photos"]

    # horaires
    if profile.get("horaires"):
        score += PROFILE_FIELD_WEIGHTS["horaires"]

    # moyen_paiement
    if profile.get("moyen_paiement"):
        score += PROFILE_FIELD_WEIGHTS["moyen_paiement"]

    return float(score)


# =====================================================
# BAYESIAN AVERAGE (for quality score)
# =====================================================

PRIOR_MEAN = 3.5
PRIOR_WEIGHT = 5


def bayesian_average(nb_avis: int, note_moyenne: float) -> float:
    """Compute Bayesian average to prevent 1-review-5-stars gaming.

    Formula: (PRIOR_WEIGHT * PRIOR_MEAN + nb_avis * note_moyenne) / (PRIOR_WEIGHT + nb_avis)

    With 0 reviews, returns PRIOR_MEAN (3.5).
    With many reviews, converges to the actual average.
    """
    return (PRIOR_WEIGHT * PRIOR_MEAN + nb_avis * note_moyenne) / (PRIOR_WEIGHT + nb_avis)


# =====================================================
# ACTIVITY SCORE (logarithmic curve)
# =====================================================

ACTIVITY_MAX_MISSIONS = 200


def compute_activity_score(missions_completed: int) -> float:
    """Compute activity score (0-100) based on completed missions.

    Uses a logarithmic curve: score = 100 * ln(1 + missions) / ln(1 + MAX)
    Reaches ~50 at ~14 missions, ~80 at ~53 missions, max (100) at 200.
    """
    if missions_completed <= 0:
        return 0.0
    capped = min(missions_completed, ACTIVITY_MAX_MISSIONS)
    return 100.0 * math.log(1 + capped) / math.log(1 + ACTIVITY_MAX_MISSIONS)


# =====================================================
# QUALITY SCORE
# =====================================================

def compute_quality_score(nb_avis: int, note_moyenne: float) -> float:
    """Compute quality score (0-100) from the Bayesian average.

    Maps rating scale (1-5) to (0-100): score = (bayesian - 1) / 4 * 100.
    """
    ba = bayesian_average(nb_avis, note_moyenne)
    return max(0.0, min(100.0, (ba - 1.0) / 4.0 * 100.0))


# =====================================================
# RELIABILITY SCORE (completion rate + punctuality)
# =====================================================

async def compute_reliability_score(user_id: str) -> float:
    """Compute reliability score (0-100) from completion rate and punctuality.

    - Completion rate: missions completed / (completed + cancelled by artisan)
      Weight: 60% of reliability score
    - Punctuality: on-time percentage (missions started within estimated time)
      Weight: 40% of reliability score

    With 0 missions, returns 50.0 (neutral).
    """
    # Count completed missions (confirmed or completed status)
    completed_statuses = ["completed", "confirmed", "terminee", "validee_client"]
    cancelled_statuses = ["cancelled", "annulee"]

    completed = await db_module.db.service_requests.count_documents({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": completed_statuses},
    })

    # Cancelled by artisan (artisan-initiated cancellations)
    cancelled = await db_module.db.service_requests.count_documents({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": cancelled_statuses},
    })

    total_missions = completed + cancelled
    if total_missions == 0:
        return 50.0  # Neutral score for new artisans

    completion_rate = completed / total_missions
    completion_score = completion_rate * 100.0

    # Punctuality: check missions with both accepted_at and started_at
    # A mission is "on time" if started within 24h of accepted_at
    on_time_count = 0
    timed_count = 0
    async for req in db_module.db.service_requests.find({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": completed_statuses},
        "accepted_at": {"$exists": True},
        "started_at": {"$exists": True},
    }):
        accepted = req.get("accepted_at")
        started = req.get("started_at")
        if accepted and started:
            timed_count += 1
            # Consider on-time if started within 24h of acceptance
            if (started - accepted) <= timedelta(hours=24):
                on_time_count += 1

    punctuality_score = 100.0
    if timed_count > 0:
        punctuality_score = (on_time_count / timed_count) * 100.0

    # Weighted: 60% completion, 40% punctuality
    return completion_score * 0.6 + punctuality_score * 0.4


# =====================================================
# SENIORITY SCORE
# =====================================================

SENIORITY_MAX_MONTHS = 24


def compute_seniority_score(created_at: Optional[datetime]) -> float:
    """Compute seniority score (0-100), linear, maxes out at 24 months.

    Returns 0.0 if created_at is not available.
    """
    if not created_at:
        return 0.0
    now = datetime.now(UTC)
    # Handle naive datetime
    if created_at.tzinfo is None:
        from datetime import timezone
        created_at = created_at.replace(tzinfo=timezone.utc)
    months = (now - created_at).days / 30.44  # Average days per month
    capped = min(months, SENIORITY_MAX_MONTHS)
    return (capped / SENIORITY_MAX_MONTHS) * 100.0


# =====================================================
# TRUST SCORE (composite)
# =====================================================

# Component weights (must sum to 1.0)
WEIGHT_PROFIL = 0.10
WEIGHT_ACTIVITE = 0.20
WEIGHT_QUALITE = 0.35
WEIGHT_FIABILITE = 0.25
WEIGHT_ANCIENNETE = 0.10


async def compute_trust_score(user_id: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    """Compute the full trust score (0-100) for an artisan.

    Returns a dict with the composite score and breakdown of each component.
    """
    # Profile completion
    profil_score = compute_profile_score(profile)

    # Activity (missions completed)
    missions = profile.get("missions_completees", 0)
    activity_score = compute_activity_score(missions)

    # Quality (reviews)
    nb_avis = await db_module.db.ratings.count_documents({"artisan_id": user_id})
    note_moyenne = 0.0
    if nb_avis > 0:
        pipeline = [
            {"$match": {"artisan_id": user_id}},
            {"$group": {"_id": None, "avg": {"$avg": "$rating"}}},
        ]
        result = await db_module.db.ratings.aggregate(pipeline).to_list(1)
        if result:
            note_moyenne = result[0]["avg"]
    quality_score = compute_quality_score(nb_avis, note_moyenne)

    # Reliability
    reliability_score = await compute_reliability_score(user_id)

    # Seniority
    seniority_score = compute_seniority_score(profile.get("created_at"))

    # Composite trust score
    trust = (
        WEIGHT_PROFIL * profil_score
        + WEIGHT_ACTIVITE * activity_score
        + WEIGHT_QUALITE * quality_score
        + WEIGHT_FIABILITE * reliability_score
        + WEIGHT_ANCIENNETE * seniority_score
    )
    trust = max(0.0, min(100.0, trust))

    return {
        "score_confiance": round(trust, 2),
        "score_profil": round(profil_score, 2),
        "note_moyenne": round(note_moyenne, 2),
        "nb_avis": nb_avis,
        "detail": {
            "profil": round(profil_score, 2),
            "activite": round(activity_score, 2),
            "qualite": round(quality_score, 2),
            "fiabilite": round(reliability_score, 2),
            "anciennete": round(seniority_score, 2),
        },
        "weights": {
            "profil": WEIGHT_PROFIL,
            "activite": WEIGHT_ACTIVITE,
            "qualite": WEIGHT_QUALITE,
            "fiabilite": WEIGHT_FIABILITE,
            "anciennete": WEIGHT_ANCIENNETE,
        },
    }


async def refresh_artisan_scores(user_id: str) -> Dict[str, Any]:
    """Recompute and persist all scores for an artisan.

    Updates the artisan_profiles document with fresh score_profil,
    score_confiance, note_moyenne, and missions_completees.

    Returns the updated scores.
    """
    profile = await db_module.db.artisan_profiles.find_one({"user_id": user_id})
    if not profile:
        return {"error": "Profile not found"}

    # Count missions
    completed_statuses = ["completed", "confirmed", "terminee", "validee_client"]
    missions_count = await db_module.db.service_requests.count_documents({
        "$or": [
            {"assigned_artisan_id": user_id},
            {"artisan_id": user_id},
        ],
        "status": {"$in": completed_statuses},
    })

    profile["missions_completees"] = missions_count
    trust_data = await compute_trust_score(user_id, profile)

    now = datetime.now(UTC)
    update = {
        "score_profil": trust_data["score_profil"],
        "score_confiance": trust_data["score_confiance"],
        "note_moyenne": trust_data["note_moyenne"],
        "missions_completees": missions_count,
        "updated_at": now,
    }

    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {"$set": update},
    )

    # Also sync to users collection for backward compat
    await db_module.db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "average_rating": trust_data["note_moyenne"],
            "total_missions": missions_count,
        }},
    )

    return {
        "user_id": user_id,
        "score_profil": trust_data["score_profil"],
        "score_confiance": trust_data["score_confiance"],
        "note_moyenne": trust_data["note_moyenne"],
        "missions_completees": missions_count,
        "detail_confiance": trust_data["detail"],
    }
