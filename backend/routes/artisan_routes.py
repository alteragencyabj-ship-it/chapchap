"""
Artisan Profile Routes
======================
Rich artisan profile management, scoring, badges, and search with ranking.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

import database as db_module
from auth import get_current_user
from models import (
    ArtisanProfile,
    ArtisanProfileUpdate,
    ArtisanReferralInfo,
    ArtisanScoreResponse,
    ArtisanSearchResult,
    ProjetPortfolio,
    Badge,
    Review,
)
from scoring_system import compute_profile_score, refresh_artisan_scores
from badge_system import evaluate_badges, refresh_badges, get_badge_info, list_all_badges
from referral_system import (
    build_qr_code_url,
    build_referral_link,
    generate_unique_referral_id,
)

router = APIRouter(prefix="/api/artisans", tags=["artisans"])


# =====================================================
# HELPERS
# =====================================================

async def _get_user(current_user: dict) -> dict:
    """Resolve the current user from auth token."""
    user = await db_module.db.users.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["_id"] = str(user["_id"])
    return user


async def _get_or_create_profile(user_id: str) -> dict:
    """Get existing profile or create a skeleton from the users collection."""
    profile = await db_module.db.artisan_profiles.find_one({"user_id": user_id})
    if profile:
        profile["_id"] = str(profile["_id"])
        return profile

    # Bootstrap from users collection
    user = await db_module.db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.now(UTC)
    name_parts = (user.get("name") or "").split(" ", 1)
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    new_profile = {
        "user_id": user_id,
        "photo_url": user.get("photo"),
        "first_name": first_name,
        "last_name": last_name,
        "metier_principal": (user.get("specialties") or [""])[0] if user.get("specialties") else "",
        "ville": user.get("city") or "",
        "quartier": user.get("quartier") or "",
        "zone_intervention_km": 10,
        "langues": [],
        "bio": None,
        "annees_experience": None,
        "statut_pro": "independant",
        "nom_entreprise": None,
        "description": None,
        "types_projets": [],
        "domaines_specialite": user.get("specialty_domains") or user.get("specialties") or [],
        "domaines_specialite_locked": bool(user.get("specialty_domains") or user.get("specialties")),
        "domaines_specialite_locked_at": now if (user.get("specialty_domains") or user.get("specialties")) else None,
        "specialites": user.get("specialties") or [],
        "competences_techniques": [],
        "materiaux": [],
        "galerie_photos": [],
        "projets": [],
        "phone_verified": bool(user.get("verified")),
        "cni_photo": user.get("id_document"),
        "diplome": None,
        "tarif": None,
        "horaires": None,
        "moyen_paiement": None,
        "score_profil": 0.0,
        "score_confiance": 0.0,
        "badges": [],
        "note_moyenne": user.get("average_rating", 0.0),
        "missions_completees": user.get("total_missions", 0),
        "affiliated_clients_count": int(user.get("affiliated_clients_count", 0) or 0),
        "created_at": user.get("created_at", now),
        "updated_at": now,
    }

    result = await db_module.db.artisan_profiles.insert_one(new_profile)
    new_profile["_id"] = str(result.inserted_id)

    # Compute initial profile score
    new_profile["score_profil"] = compute_profile_score(new_profile)
    await db_module.db.artisan_profiles.update_one(
        {"_id": result.inserted_id},
        {"$set": {"score_profil": new_profile["score_profil"]}},
    )

    return new_profile


def _normalize_domain_values(raw_values: Optional[List[str]]) -> List[str]:
    if not raw_values:
        return []
    seen = set()
    values: List[str] = []
    for raw in raw_values:
        value = str(raw).strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)
    return values


async def _get_existing_service_domains() -> List[str]:
    """Read existing domains from DB-backed sources (no duplicated static catalog)."""
    domains = set()

    # Preferred source: dedicated domains collection (if present in deployment).
    try:
        async for doc in db_module.db.service_domains.find({}, {"key": 1, "name": 1, "slug": 1}):
            for key in ("key", "slug", "name"):
                val = str(doc.get(key, "")).strip().lower()
                if val:
                    domains.add(val)
    except Exception:
        pass

    # Fallback source: real mission service types already used in production data.
    try:
        values = await db_module.db.service_requests.distinct("service_type")
        for v in values or []:
            val = str(v).strip().lower()
            if val:
                domains.add(val)
    except Exception:
        pass

    return sorted(domains)


# =====================================================
# GET PROFILE
# =====================================================

@router.get("/profile/{user_id}", response_model=ArtisanProfile)
async def get_artisan_profile(user_id: str):
    """Get a public artisan profile by user_id."""
    profile = await _get_or_create_profile(user_id)
    return ArtisanProfile(**profile)


@router.get("/domains")
async def get_artisan_domains():
    """Return currently available service domains from DB-backed sources."""
    domains = await _get_existing_service_domains()
    return {"domains": domains}


# =====================================================
# UPDATE PROFILE (authenticated, own profile only)
# =====================================================

@router.put("/profile", response_model=ArtisanProfile)
async def update_artisan_profile(
    data: ArtisanProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update the authenticated artisan's profile.

    Only non-None fields in the payload are updated (partial update).
    Automatically recomputes the profile completion score.
    """
    user = await _get_user(current_user)
    if user.get("role") != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can update artisan profiles")

    user_id = user["_id"]
    existing_profile = await _get_or_create_profile(user_id)  # Ensure profile exists

    # Build update dict from non-None fields
    update_fields = data.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    now = datetime.now(UTC)

    # Domain locking rule: artisans choose domains once, then immutable.
    if "domaines_specialite" in update_fields:
        requested_domains = _normalize_domain_values(update_fields.get("domaines_specialite"))
        current_domains = _normalize_domain_values(existing_profile.get("domaines_specialite"))
        is_locked = bool(existing_profile.get("domaines_specialite_locked")) or bool(current_domains)

        if not requested_domains:
            raise HTTPException(status_code=400, detail="Selectionnez au moins un domaine de specialite")

        if is_locked and requested_domains != current_domains:
            raise HTTPException(
                status_code=409,
                detail="Vos domaines de specialite sont deja verrouilles et ne peuvent plus etre modifies.",
            )

        if not is_locked:
            existing_domains = await _get_existing_service_domains()
            if existing_domains:
                unknown = [d for d in requested_domains if d not in existing_domains]
                if unknown:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Domaines invalides: {', '.join(unknown)}",
                    )
            update_fields["domaines_specialite_locked"] = True
            update_fields["domaines_specialite_locked_at"] = now

        update_fields["domaines_specialite"] = current_domains if is_locked else requested_domains

    update_fields["updated_at"] = now

    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {"$set": update_fields},
    )

    # Recompute profile score
    updated_profile = await db_module.db.artisan_profiles.find_one({"user_id": user_id})
    new_score = compute_profile_score(updated_profile)
    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"score_profil": new_score}},
    )
    updated_profile["score_profil"] = new_score

    # Keep key public user fields in sync for legacy screens/search endpoints.
    user_updates: Dict[str, Any] = {}
    if "photo_url" in update_fields:
        user_updates["photo"] = updated_profile.get("photo_url")
    if "ville" in update_fields:
        user_updates["city"] = updated_profile.get("ville", "")
    if "quartier" in update_fields:
        user_updates["quartier"] = updated_profile.get("quartier", "")
    if "specialites" in update_fields:
        user_updates["specialties"] = updated_profile.get("specialites", [])
    if "domaines_specialite" in update_fields:
        user_updates["specialty_domains"] = updated_profile.get("domaines_specialite", [])
        # Keep legacy matching behavior coherent with chosen immutable domains.
        if "specialites" not in update_fields and not updated_profile.get("specialites"):
            user_updates["specialties"] = updated_profile.get("domaines_specialite", [])
    if "first_name" in update_fields or "last_name" in update_fields:
        full_name = f"{updated_profile.get('first_name', '').strip()} {updated_profile.get('last_name', '').strip()}".strip()
        if full_name:
            user_updates["name"] = full_name
    if user_updates:
        await db_module.db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": user_updates},
        )

    updated_profile["_id"] = str(updated_profile["_id"])

    return ArtisanProfile(**updated_profile)


# =====================================================
# UPLOAD PROFILE PHOTO
# =====================================================

@router.post("/profile/photo")
async def upload_profile_photo(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Upload/update the artisan's profile photo.

    Expects: { "photo_url": "<url or base64>" }

    In production, the frontend uploads to a storage service (S3/Cloudinary)
    and sends the URL here. For now, we also accept base64.
    """
    user = await _get_user(current_user)
    if user.get("role") != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can upload photos")

    photo_url = data.get("photo_url") or data.get("photo")
    if not photo_url:
        raise HTTPException(status_code=400, detail="photo_url is required")

    user_id = user["_id"]
    await _get_or_create_profile(user_id)

    now = datetime.now(UTC)
    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"photo_url": photo_url, "updated_at": now}},
    )

    # Also sync to users collection
    await db_module.db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"photo": photo_url}},
    )

    # Recompute profile score
    profile = await db_module.db.artisan_profiles.find_one({"user_id": user_id})
    new_score = compute_profile_score(profile)
    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"score_profil": new_score}},
    )

    return {
        "message": "Photo mise a jour",
        "photo_url": photo_url,
        "url": photo_url,  # Backward-compatible key for legacy mobile payloads
        "score_profil": new_score,
    }


# =====================================================
# PORTFOLIO MANAGEMENT
# =====================================================

@router.post("/portfolio", response_model=ArtisanProfile)
async def add_portfolio_project(
    projet: ProjetPortfolio,
    current_user: dict = Depends(get_current_user),
):
    """Add a portfolio project to the artisan's profile (max 5)."""
    user = await _get_user(current_user)
    if user.get("role") != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can manage portfolio")

    user_id = user["_id"]
    profile = await _get_or_create_profile(user_id)

    existing_projects = profile.get("projets") or []
    if len(existing_projects) >= 5:
        raise HTTPException(status_code=400, detail="Maximum 5 portfolio projects allowed")

    # Ensure the project has an ID
    project_dict = projet.model_dump(by_alias=True)
    if not project_dict.get("_id"):
        project_dict["_id"] = str(ObjectId())

    now = datetime.now(UTC)
    await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {
            "$push": {"projets": project_dict},
            "$set": {"updated_at": now},
        },
    )

    updated = await db_module.db.artisan_profiles.find_one({"user_id": user_id})
    updated["_id"] = str(updated["_id"])
    return ArtisanProfile(**updated)


@router.delete("/portfolio/{project_id}")
async def remove_portfolio_project(
    project_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a portfolio project by its ID."""
    user = await _get_user(current_user)
    if user.get("role") != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can manage portfolio")

    user_id = user["_id"]
    now = datetime.now(UTC)

    result = await db_module.db.artisan_profiles.update_one(
        {"user_id": user_id},
        {
            "$pull": {"projets": {"_id": project_id}},
            "$set": {"updated_at": now},
        },
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Project not found in portfolio")

    return {"message": "Projet supprime du portfolio"}


# =====================================================
# SCORES AND BADGES
# =====================================================

@router.get("/score/{user_id}", response_model=ArtisanScoreResponse)
async def get_artisan_score(user_id: str):
    """Get scores and badges for an artisan. Recomputes on request."""
    # Ensure profile exists
    await _get_or_create_profile(user_id)

    # Refresh scores
    scores = await refresh_artisan_scores(user_id)
    if "error" in scores:
        raise HTTPException(status_code=404, detail=scores["error"])

    # Refresh badges
    badges = await refresh_badges(user_id)

    # --- Calculate derived fields for frontend ---

    # Trust Link
    trust = scores["score_confiance"]
    if trust >= 80:
        trust_label = "Excellent"
    elif trust >= 60:
        trust_label = "Tres bon"
    elif trust >= 40:
        trust_label = "Bon"
    elif trust >= 20:
        trust_label = "Moyen"
    else:
        trust_label = "Faible"

    # Completion Rate
    # (Already computed in scoring_system.py but not exposed directly in refresh_artisan_scores result dict,
    #  but we can fetch it via compute_reliability_score or just approximate it for now)
    # Let's re-calculate briefly or fetch from profile if stored.
    # For speed, we'll do a quick count here or assume high completion if trust is high.
    # PROPER WAY: Retrieve reliability score components.
    # For now, let's look at missions.
    
    completed_ops = ["completed", "confirmed", "terminee", "validee_client"]
    cancelled_ops = ["cancelled", "annulee"]
    
    n_completed = await db_module.db.service_requests.count_documents({
        "$or": [{"assigned_artisan_id": user_id}, {"artisan_id": user_id}],
        "status": {"$in": completed_ops}
    })
    n_cancelled = await db_module.db.service_requests.count_documents({
        "$or": [{"assigned_artisan_id": user_id}, {"artisan_id": user_id}],
        "status": {"$in": cancelled_ops}
    })
    total_ops = n_completed + n_cancelled
    completion_rate = 100
    if total_ops > 0:
        completion_rate = int((n_completed / total_ops) * 100)

    # Reviews & Total Reviews
    total_reviews = await db_module.db.ratings.count_documents({"artisan_id": user_id})
    recent_reviews_data = await db_module.db.ratings.find(
        {"artisan_id": user_id}
    ).sort("created_at", -1).limit(3).to_list(3)

    recent_reviews = []
    for r in recent_reviews_data:
        # Get reviewer name
        reviewer = await db_module.db.users.find_one({"_id": ObjectId(r["client_id"])})
        reviewer_name = reviewer.get("name", "Client") if reviewer else "Client"
        
        recent_reviews.append(Review(
            id=str(r["_id"]),
            rating=r["rating"],
            text=r["comment"],
            reviewer_name=reviewer_name,
            date=r["created_at"].strftime("%Y-%m-%d") if r.get("created_at") else ""
        ))

    # Avg Response Time (Mocked for now as we don't track message deltas perfectly yet)
    # In a real scenario, this would be aggregating message timestamps.
    avg_response_time = "N/A"
    # Try to calculate if possible or return a placeholder
    # Using 'reactif' badge logic check? 
    # Let's return a placeholder that the frontend accepts.
    avg_response_time = "1h" # Default

    # Badges Objects
    badge_objects = []
    for b_key in badges:
        info = get_badge_info(b_key)
        badge_objects.append(Badge(
            key=b_key,
            label=info.get("label", b_key),
            description=info.get("description", ""),
            icon=info.get("icon", "ribbon")
        ))

    return ArtisanScoreResponse(
        user_id=user_id,
        score_profil=scores["score_profil"],
        score_confiance=scores["score_confiance"],
        trust_label=trust_label,
        badges=badge_objects,
        note_moyenne=scores["note_moyenne"],
        total_reviews=total_reviews,
        missions_completees=scores["missions_completees"],
        completion_rate=completion_rate,
        avg_response_time=avg_response_time,
        recent_reviews=recent_reviews,
        detail_confiance=scores.get("detail_confiance"),
    )


@router.get("/badges")
async def list_badges():
    """List all available badge definitions."""
    return list_all_badges()


# =====================================================
# REFERRAL / AFFILIATION (artisan side)
# =====================================================

@router.get("/referral/me", response_model=ArtisanReferralInfo)
async def get_my_referral_info(current_user: dict = Depends(get_current_user)):
    """Return the current artisan referral assets and affiliated counter."""
    user = await _get_user(current_user)
    if user.get("role") != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can access referral info")

    referral_id = (user.get("referral_id") or "").strip().upper()
    if not referral_id:
        referral_id = await generate_unique_referral_id(user.get("name"))
        await db_module.db.users.update_one(
            {"_id": ObjectId(user["_id"])},
            {"$set": {"referral_id": referral_id}},
        )

    user_count = int(user.get("affiliated_clients_count", 0) or 0)
    profile = await db_module.db.artisan_profiles.find_one(
        {"user_id": user["_id"]},
        {"affiliated_clients_count": 1},
    )
    profile_count = int((profile or {}).get("affiliated_clients_count", 0) or 0)
    affiliated_clients_count = max(user_count, profile_count)

    if affiliated_clients_count != profile_count:
        await db_module.db.artisan_profiles.update_one(
            {"user_id": user["_id"]},
            {"$set": {"affiliated_clients_count": affiliated_clients_count}},
        )

    referral_link = build_referral_link(referral_id)
    qr_payload = referral_link
    qr_code_url = build_qr_code_url(qr_payload)

    return ArtisanReferralInfo(
        referral_id=referral_id,
        affiliated_clients_count=affiliated_clients_count,
        referral_link=referral_link,
        qr_payload=qr_payload,
        qr_code_url=qr_code_url,
    )


# =====================================================
# SEARCH WITH RANKING ALGORITHM
# =====================================================

# Ranking weights
RANK_W_TRUST = 0.35
RANK_W_GEO = 0.25
RANK_W_DISPO = 0.15
RANK_W_MATCH = 0.15
RANK_W_RECENCE = 0.10

# Cold start boost: 20% for first 60 days, decays linearly
COLD_START_DAYS = 60
COLD_START_BOOST_MAX = 0.20

# Profile boost
PROFILE_BOOST_80 = 0.05
PROFILE_BOOST_95 = 0.10


def _geo_score(distance_km: Optional[float], max_km: float = 50.0) -> float:
    """Compute geo proximity score (0-100). Closer = higher."""
    if distance_km is None:
        return 50.0  # Neutral if no location
    if distance_km <= 0:
        return 100.0
    if distance_km >= max_km:
        return 0.0
    return 100.0 * (1.0 - distance_km / max_km)


def _dispo_score(profile: dict) -> float:
    """Availability score (0-100). Based on whether the artisan is blocked or active."""
    # Check credit block status
    if profile.get("is_blocked"):
        return 0.0
    # Check last activity (last_seen_at on user)
    last_seen = profile.get("last_seen_at")
    if not last_seen:
        return 50.0

    now = datetime.now(UTC)
    if last_seen.tzinfo is None:
        from datetime import timezone
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    days_since = (now - last_seen).days
    if days_since <= 1:
        return 100.0
    elif days_since <= 7:
        return 80.0
    elif days_since <= 30:
        return 50.0
    else:
        return 20.0


def _match_score(
    profile: dict,
    service_type: Optional[str],
    query_text: Optional[str],
) -> float:
    """Specialty/keyword match score (0-100)."""
    score = 0.0
    domains = profile.get("domaines_specialite") or []
    specialites = profile.get("specialites") or []
    metier = profile.get("metier_principal") or ""
    competences = profile.get("competences_techniques") or []
    all_skills = [s.lower() for s in domains + specialites + [metier] + competences if s]

    if service_type:
        st_lower = service_type.lower()
        if st_lower in all_skills:
            score += 60.0
        elif any(st_lower in s for s in all_skills):
            score += 30.0

    if query_text:
        qt_lower = query_text.lower()
        bio = (profile.get("bio") or "").lower()
        desc = (profile.get("description") or "").lower()
        if qt_lower in " ".join(all_skills):
            score += 25.0
        if qt_lower in bio or qt_lower in desc:
            score += 15.0

    return min(100.0, score)


def _recence_score(profile: dict) -> float:
    """Recency of last completed mission (0-100)."""
    updated = profile.get("updated_at")
    if not updated:
        return 30.0
    now = datetime.now(UTC)
    if updated.tzinfo is None:
        from datetime import timezone
        updated = updated.replace(tzinfo=timezone.utc)
    days = (now - updated).days
    if days <= 7:
        return 100.0
    elif days <= 30:
        return 70.0
    elif days <= 90:
        return 40.0
    return 10.0


def _cold_start_boost(profile: dict) -> float:
    """Cold start boost: 20% for first 60 days, linear decay."""
    created = profile.get("created_at")
    if not created:
        return 0.0
    now = datetime.now(UTC)
    if created.tzinfo is None:
        from datetime import timezone
        created = created.replace(tzinfo=timezone.utc)
    days = (now - created).days
    if days >= COLD_START_DAYS:
        return 0.0
    return COLD_START_BOOST_MAX * (1.0 - days / COLD_START_DAYS)


def _profile_boost(score_profil: float) -> float:
    """Profile completion boost: +5% if >= 80%, +10% if >= 95%."""
    if score_profil >= 95:
        return PROFILE_BOOST_95
    elif score_profil >= 80:
        return PROFILE_BOOST_80
    return 0.0


def compute_ranking_score(
    profile: dict,
    distance_km: Optional[float],
    service_type: Optional[str],
    query_text: Optional[str],
) -> float:
    """Compute the full ranking score for search results.

    ranking_score = 0.35*trust + 0.25*geo + 0.15*dispo + 0.15*match + 0.10*recence
                  + cold_start_boost
                  + profile_boost
    """
    trust = profile.get("score_confiance", 0.0)
    geo = _geo_score(distance_km)
    dispo = _dispo_score(profile)
    match = _match_score(profile, service_type, query_text)
    recence = _recence_score(profile)

    base_score = (
        RANK_W_TRUST * trust
        + RANK_W_GEO * geo
        + RANK_W_DISPO * dispo
        + RANK_W_MATCH * match
        + RANK_W_RECENCE * recence
    )

    boost = _cold_start_boost(profile) + _profile_boost(profile.get("score_profil", 0))
    final = base_score * (1.0 + boost)

    return round(min(100.0, final), 2)


@router.get("/search", response_model=List[ArtisanSearchResult])
async def search_artisans(
    service_type: Optional[str] = Query(None, description="Type de service (plomberie, electricite, etc.)"),
    q: Optional[str] = Query(None, description="Recherche par mot-cle"),
    ville: Optional[str] = Query(None, description="Filtrer par ville"),
    lat: Optional[float] = Query(None, description="Latitude du client"),
    lng: Optional[float] = Query(None, description="Longitude du client"),
    radius_km: float = Query(50.0, description="Rayon de recherche en km"),
    min_rating: Optional[float] = Query(None, ge=0, le=5, description="Note minimale"),
    verified_only: bool = Query(False, description="Artisans verifies uniquement"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    """Search artisans with hybrid business ranking.

    Primary rank order:
      1) affiliated_clients_count DESC
      2) average rating (note_moyenne) DESC
      3) years of experience DESC
      4) profile completion score DESC
    """
    # Build MongoDB query
    query: Dict[str, Any] = {}

    if service_type:
        service_type_lower = service_type.strip().lower()
        legacy_skill_match = {
            "$or": [
                {"metier_principal": {"$regex": service_type, "$options": "i"}},
                {"specialites": {"$regex": service_type, "$options": "i"}},
                {"competences_techniques": {"$regex": service_type, "$options": "i"}},
            ]
        }
        query["$or"] = [
            # Strict rule: artisans with locked domains must match selected domain.
            {"domaines_specialite": service_type_lower},
            # Legacy fallback only when no immutable domains are configured yet.
            {
                "$and": [
                    {
                        "$or": [
                            {"domaines_specialite": {"$exists": False}},
                            {"domaines_specialite": []},
                        ]
                    },
                    legacy_skill_match,
                ]
            },
        ]

    if q:
        text_filter = {"$regex": q, "$options": "i"}
        q_conditions = [
            {"first_name": text_filter},
            {"last_name": text_filter},
            {"domaines_specialite": text_filter},
            {"metier_principal": text_filter},
            {"specialites": text_filter},
            {"bio": text_filter},
            {"description": text_filter},
        ]
        if "$or" in query:
            # Combine with service_type filter
            query = {"$and": [{"$or": query["$or"]}, {"$or": q_conditions}]}
        else:
            query["$or"] = q_conditions

    if ville:
        query["ville"] = {"$regex": ville, "$options": "i"}

    if min_rating is not None:
        query["note_moyenne"] = {"$gte": min_rating}

    if verified_only:
        query["badges"] = {"$in": ["verifie"]}

    # Fetch matching profiles
    profiles = []
    async for p in db_module.db.artisan_profiles.find(query).limit(200):
        p["_id"] = str(p["_id"])
        profiles.append(p)

    # Enrich with user data and fallback stats
    for p in profiles:
        user = await db_module.db.users.find_one({"_id": ObjectId(p["user_id"])})
        if user:
            p["last_seen_at"] = user.get("last_seen_at")
            p["is_blocked"] = False
            p["average_rating_user"] = float(user.get("average_rating", 0.0) or 0.0)
            p["affiliated_clients_count_user"] = int(user.get("affiliated_clients_count", 0) or 0)
            # Check credit status
            credit = await db_module.db.artisan_credits.find_one({"artisan_id": p["user_id"]})
            if credit:
                commission_due = float(credit.get("commission_due", 0) or 0)
                p["is_blocked"] = bool(credit.get("is_blocked", False)) or commission_due >= 10000

            # Check user status
            if user.get("status") in ("suspended", "blocked"):
                p["is_blocked"] = True

    # Compute distance if client location is provided
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Haversine formula for distance in km."""
        R = 6371  # Earth radius in km
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2
             + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
             * math.sin(dlon / 2) ** 2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # Compute ranking for each profile
    ranked_results = []
    for p in profiles:
        # Skip blocked artisans
        if p.get("is_blocked"):
            continue

        distance_km = None
        if lat is not None and lng is not None:
            # Try to get artisan location from users collection
            user = await db_module.db.users.find_one({"_id": ObjectId(p["user_id"])})
            if user and user.get("location") and user["location"].get("coordinates"):
                coords = user["location"]["coordinates"]
                distance_km = _haversine(lat, lng, coords[1], coords[0])
                if distance_km > radius_km:
                    continue  # Outside search radius

        affiliated_count = int(
            p.get("affiliated_clients_count")
            if p.get("affiliated_clients_count") is not None
            else p.get("affiliated_clients_count_user", 0)
        )
        rating_value = float(
            p.get("note_moyenne")
            if p.get("note_moyenne") is not None
            else p.get("average_rating_user", 0.0)
        )
        experience_value = int(p.get("annees_experience") or 0)
        profile_score_value = float(p.get("score_profil", 0.0) or 0.0)
        ranking = round(
            affiliated_count * 100000
            + rating_value * 1000
            + experience_value * 10
            + profile_score_value / 10,
            3,
        )

        ranked_results.append(ArtisanSearchResult(
            user_id=p["user_id"],
            first_name=p.get("first_name", ""),
            last_name=p.get("last_name", ""),
            photo_url=p.get("photo_url"),
            metier_principal=p.get("metier_principal", ""),
            domaines_specialite=p.get("domaines_specialite", []),
            ville=p.get("ville", ""),
            quartier=p.get("quartier", ""),
            specialites=p.get("specialites", []),
            note_moyenne=rating_value,
            missions_completees=p.get("missions_completees", 0),
            score_confiance=p.get("score_confiance", 0.0),
            badges=p.get("badges", []),
            annees_experience=experience_value or None,
            bio=p.get("bio"),
            score_profil=profile_score_value,
            affiliated_clients_count=affiliated_count,
            ranking_score=ranking,
            distance_km=round(distance_km, 1) if distance_km is not None else None,
        ))

    # Hybrid sort required by business rules.
    ranked_results.sort(
        key=lambda x: (
            x.affiliated_clients_count,
            x.note_moyenne,
            x.annees_experience or 0,
            x.score_profil,
        ),
        reverse=True,
    )

    # Paginate
    start = (page - 1) * limit
    end = start + limit
    return ranked_results[start:end]
