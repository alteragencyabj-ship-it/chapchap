from pydantic import AliasChoices, BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from bson import ObjectId
from enum import Enum

class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError(f"Invalid ObjectId: {v}")
        return str(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, field_schema):
        field_schema.update(type="string")

class GeoLocation(BaseModel):
    type: str = "Point"
    coordinates: List[float]  # [longitude, latitude]

# =====================================================
# REQUEST STATUS ENUM
# =====================================================

class RequestStatus(str, Enum):
    # === New 13-state lifecycle ===
    DEMANDE_ENVOYEE = "demande_envoyee"
    DEVIS_ENVOYE = "devis_envoye"
    ACCEPTEE = "acceptee"
    PAIEMENT_ESCROW = "paiement_escrow"
    ARTISAN_EN_ROUTE = "artisan_en_route"
    MISSION_EN_COURS = "mission_en_cours"
    TERMINEE = "terminee"
    VALIDEE_CLIENT = "validee_client"
    ANNULEE = "annulee"
    EXPIREE = "expiree"
    LITIGE = "litige"

    # === Legacy aliases (kept for backward compat, map to new states) ===
    CREATED = "created"
    PUBLISHED = "published"
    ACCEPTED = "accepted"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CONFIRMED = "confirmed"
    REFUSED = "refused"
    CANCELLED = "cancelled"
    DISPUTED = "disputed"
    RESOLVED = "resolved"

# =====================================================
# USER MODELS
# =====================================================

class UserBase(BaseModel):
    name: str
    email: EmailStr
    phone: str
    role: str  # "client" | "artisan" | "admin"
    photo: Optional[str] = None  # base64
    location: Optional[GeoLocation] = None
    address: Optional[str] = None
    quartier: Optional[str] = None
    city: Optional[str] = None

class UserCreate(UserBase):
    firebase_uid: Optional[str] = None
    password: Optional[str] = None  # For custom auth fallback
    referral_code: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("referral_code", "referral_id", "ref", "invite_code"),
    )
    # Artisan specific
    specialties: Optional[List[str]] = None
    experience: Optional[str] = None
    id_document: Optional[str] = None  # base64
    zone: Optional[str] = None
    verified: Optional[bool] = False
    average_rating: Optional[float] = 0.0
    total_missions: Optional[int] = 0
    taux_reponse: Optional[int] = None
    delai_moyen_reponse: Optional[str] = None
    statut: Optional[str] = None
    distance: Optional[float] = None

class User(UserBase):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    firebase_uid: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Artisan specific
    specialties: Optional[List[str]] = None
    experience: Optional[str] = None
    id_document: Optional[str] = None
    zone: Optional[str] = None
    verified: bool = False
    average_rating: float = 0.0
    total_missions: int = 0
    taux_reponse: Optional[int] = None
    delai_moyen_reponse: Optional[str] = None
    statut: Optional[str] = None
    distance: Optional[float] = None
    referral_id: Optional[str] = None
    referred_by_artisan_id: Optional[str] = None
    referred_by_referral_id: Optional[str] = None
    affiliation_qualified: bool = False
    affiliation_qualified_at: Optional[datetime] = None
    affiliated_clients_count: int = 0
    specialty_domains: Optional[List[str]] = None
    # Admin fields
    admin_role: Optional[str] = None  # super_admin, staff, finance, support
    permissions: Optional[List[str]] = None  # Custom permissions override
    is_active: bool = True
    status: Optional[str] = "active"  # active, suspended, blocked
    status_reason: Optional[str] = None
    onboarded_by: Optional[str] = None  # Admin user_id who onboarded
    interview_notes: Optional[str] = None
    # Push notification
    push_token: Optional[str] = None  # Expo push token
    notification_preferences: Optional[Dict[str, Any]] = None
    last_seen_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# BOOKING MODELS (Legacy -- aliased to requests)
# =====================================================

class BookingCreate(BaseModel):
    artisan_id: str
    service_id: str
    service_name: str
    service_price: str
    category_id: str
    address: str
    phone: str
    quartier: Optional[str] = None
    notes: Optional[str] = None
    payment_method: str  # "card", "wave", "orange_money", "cash"

class Booking(BookingCreate):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    client_id: str
    client_name: str
    status: str = "pending_artisan"  # pending_artisan, accepted, in_progress, completed, cancelled
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# SERVICE REQUEST MODELS (Enhanced with state machine)
# =====================================================

class ServiceRequestCreate(BaseModel):
    service_type: str  # peinture, plomberie, electricite, etc.
    description: str
    photos: List[str] = []  # base64 images
    address: str
    # Location can be missing for legacy documents (e.g. migrated bookings).
    location: Optional[GeoLocation] = None
    budget: Optional[float] = None
    artisan_id: Optional[str] = None  # Targeted artisan (new: client picks artisan)
    # Booking-compat fields
    service_name: Optional[str] = None
    service_price: Optional[str] = None
    phone: Optional[str] = None
    payment_method: Optional[str] = None

class ServiceRequest(ServiceRequestCreate):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    client_id: str
    status: str = "demande_envoyee"
    assigned_artisan_id: Optional[str] = None
    status_history: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    quote_sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    escrow_paid_at: Optional[datetime] = None
    departed_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    validated_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    expired_at: Optional[datetime] = None
    disputed_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    refuse_reason: Optional[str] = None
    admin_note: Optional[str] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# CONVERSATION MODELS
# =====================================================

class ConversationCreate(BaseModel):
    request_id: str
    participants: List[str]  # [client_id, artisan_id]

class Conversation(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    request_id: str
    participants: List[str]  # [client_id, artisan_id]
    other_party_id: Optional[str] = None
    other_party_name: Optional[str] = None
    other_party_role: Optional[str] = None
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: Dict[str, int] = {}  # user_id -> unread count
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# MESSAGE MODELS
# =====================================================

class MessageCreate(BaseModel):
    request_id: Optional[str] = None
    receiver_id: Optional[str] = None
    conversation_id: Optional[str] = None
    message: str

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    request_id: Optional[str] = None
    conversation_id: Optional[str] = None
    sender_id: str
    receiver_id: str
    message: str
    message_type: str = "user"  # user, system
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    read: bool = False

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# NOTIFICATION MODELS
# =====================================================

class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    recipient_id: str
    type: str  # request_accepted, request_refused, new_message, etc.
    title: str
    body: str
    data: Optional[Dict[str, Any]] = None  # Payload for deep linking
    read: bool = False
    channels: List[str] = ["in_app"]  # in_app, push, email
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class NotificationPreferences(BaseModel):
    push_enabled: bool = True
    email_enabled: bool = False
    quiet_hours_start: Optional[int] = None  # Hour (0-23)
    quiet_hours_end: Optional[int] = None
    disabled_types: List[str] = []  # Notification types to mute

class RegisterTokenRequest(BaseModel):
    token: str  # Expo push token

# =====================================================
# NOTIFICATION TEMPLATE MODELS
# =====================================================

class NotificationTemplateCreate(BaseModel):
    key: str  # e.g. "request_accepted"
    title_template: str  # e.g. "{artisan_name} a accepte votre demande"
    body_template: str
    channels: List[str] = ["in_app", "push"]
    priority: str = "normal"  # low, normal, high

# =====================================================
# DISPUTE MODELS
# =====================================================

class DisputeCreate(BaseModel):
    request_id: str
    reason: str
    category: Optional[str] = None  # quality, delay, no_show, pricing, other

class DisputeMessage(BaseModel):
    message: str

class DisputeResolve(BaseModel):
    outcome: str  # refund, partial_refund, dismissed, warning
    resolution_note: str
    refund_amount: Optional[float] = None

class Dispute(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    request_id: str
    opened_by: str  # user_id
    reason: str
    category: Optional[str] = None
    status: str = "open"  # open, investigating, resolved, closed
    assigned_admin: Optional[str] = None
    messages: List[Dict[str, Any]] = []  # [{sender_id, message, timestamp, is_admin}]
    outcome: Optional[str] = None
    resolution_note: Optional[str] = None
    refund_amount: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# ADMIN MODELS
# =====================================================

class AdminArtisanCreate(BaseModel):
    """Admin-only artisan creation (onboarding after physical interview)."""
    name: str
    email: EmailStr
    phone: str
    specialties: List[str]
    experience: Optional[str] = None
    city: Optional[str] = None
    quartier: Optional[str] = None
    address: Optional[str] = None
    zone: Optional[str] = None
    id_document: Optional[str] = None
    photo: Optional[str] = None
    interview_notes: Optional[str] = None
    password: Optional[str] = None  # Temporary password for the artisan

class StatusChangeRequest(BaseModel):
    status: str  # active, suspended, blocked
    reason: str

class CreditAdjustment(BaseModel):
    credits: Optional[int] = None  # Set credit_remaining
    commission_due: Optional[float] = None  # Set commission_due
    reason: str

class SettleCommissionsRequest(BaseModel):
    note: Optional[str] = None

# =====================================================
# CAMPAIGN MODELS
# =====================================================

class CampaignCreate(BaseModel):
    title: str
    body: str
    target: str  # all, clients, artisans, segment
    segment_filter: Optional[Dict[str, Any]] = None  # MongoDB query for segment
    channels: List[str] = ["push", "in_app"]
    scheduled_at: Optional[datetime] = None  # None = immediate

# =====================================================
# REQUEST ACTION MODELS
# =====================================================

class RequestRefuse(BaseModel):
    reason: Optional[str] = None

class RequestCancel(BaseModel):
    reason: Optional[str] = None

class RequestDispute(BaseModel):
    reason: str
    category: Optional[str] = None

class RequestTransition(BaseModel):
    """Generic transition payload for the state machine endpoint."""
    target_status: RequestStatus
    expected_current_status: Optional[RequestStatus] = None
    reason: Optional[str] = None
    admin_note: Optional[str] = None
    warning_ack: bool = False
    extra_data: Optional[Dict[str, Any]] = None

class RequestConfirm(BaseModel):
    """Explicit confirmation payload before final validation/release."""
    warning_ack: bool = False

# =====================================================
# RATING MODELS
# =====================================================

class RatingCreate(BaseModel):
    request_id: str
    artisan_id: str
    rating: int  # 1-5
    comment: str

class Rating(RatingCreate):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    client_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# =====================================================
# ARTISAN PROFILE MODELS (Rich profile + Portfolio)
# =====================================================

class ProjetPortfolio(BaseModel):
    """A portfolio project showcasing an artisan's past work."""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    titre: str = Field(validation_alias=AliasChoices("titre", "title"))
    description: Optional[str] = None
    photos: List[str] = []  # URLs
    lieu: Optional[str] = Field(default=None, validation_alias=AliasChoices("lieu", "location"))
    categorie: Optional[str] = Field(default=None, validation_alias=AliasChoices("categorie", "category"))
    avant_apres: bool = False

    @model_validator(mode="after")
    def validate_avant_apres_photos(self):
        if self.avant_apres and len(self.photos) < 2:
            raise ValueError("Avant/apres projects require at least 2 photos")
        return self

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}


class ArtisanProfileUpdate(BaseModel):
    """Fields the artisan can update on their own profile."""
    # Identity
    photo_url: Optional[str] = Field(default=None, validation_alias=AliasChoices("photo_url", "photo"))
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    metier_principal: Optional[str] = Field(default=None, validation_alias=AliasChoices("metier_principal", "trade"))
    ville: Optional[str] = Field(default=None, validation_alias=AliasChoices("ville", "city"))
    quartier: Optional[str] = None
    zone_intervention_km: Optional[int] = Field(default=None, validation_alias=AliasChoices("zone_intervention_km", "zone_km"))
    langues: Optional[List[str]] = Field(default=None, validation_alias=AliasChoices("langues", "languages"))
    bio: Optional[str] = None

    # Experience
    annees_experience: Optional[int] = Field(default=None, validation_alias=AliasChoices("annees_experience", "years_experience"))
    statut_pro: Optional[str] = Field(default=None, validation_alias=AliasChoices("statut_pro", "professional_status"))  # independant | employe | entreprise
    nom_entreprise: Optional[str] = Field(default=None, validation_alias=AliasChoices("nom_entreprise", "company_name"))
    description: Optional[str] = None
    types_projets: Optional[List[str]] = None

    # Specialties
    domaines_specialite: Optional[List[str]] = Field(
        default=None,
        validation_alias=AliasChoices("domaines_specialite", "specialty_domains", "domains"),
    )  # fixed mission domains (set once)
    specialites: Optional[List[str]] = Field(default=None, validation_alias=AliasChoices("specialites", "specialties"))  # max 5 tags
    competences_techniques: Optional[List[str]] = Field(default=None, validation_alias=AliasChoices("competences_techniques", "competences"))
    materiaux: Optional[List[str]] = Field(default=None, validation_alias=AliasChoices("materiaux", "materials"))

    # Portfolio gallery
    galerie_photos: Optional[List[str]] = Field(default=None, validation_alias=AliasChoices("galerie_photos", "portfolio_photos"))  # max 10 URLs
    projets: Optional[List[ProjetPortfolio]] = Field(default=None, validation_alias=AliasChoices("projets", "portfolio_projects"))  # max 5 projects

    # Verification fields
    tarif: Optional[str] = None
    horaires: Optional[str] = None
    moyen_paiement: Optional[str] = None

    @field_validator("bio")
    @classmethod
    def bio_max_length(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 200:
            raise ValueError("Bio must be 200 characters or less")
        return v

    @field_validator("description")
    @classmethod
    def description_max_length(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 300:
            raise ValueError("Description must be 300 characters or less")
        return v

    @field_validator("specialites")
    @classmethod
    def specialites_max_5(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v and len(v) > 5:
            raise ValueError("Maximum 5 specialites allowed")
        return v

    @field_validator("domaines_specialite")
    @classmethod
    def domaines_max_5(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v and len(v) > 5:
            raise ValueError("Maximum 5 domaines de specialite allowed")
        return v

    @field_validator("galerie_photos")
    @classmethod
    def galerie_max_10(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v and len(v) > 10:
            raise ValueError("Maximum 10 gallery photos allowed")
        return v

    @field_validator("projets")
    @classmethod
    def projets_max_5(cls, v: Optional[List[ProjetPortfolio]]) -> Optional[List[ProjetPortfolio]]:
        if v and len(v) > 5:
            raise ValueError("Maximum 5 portfolio projects allowed")
        return v

    @field_validator("statut_pro")
    @classmethod
    def validate_statut_pro(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in ("independant", "employe", "entreprise"):
            raise ValueError("statut_pro must be independant, employe, or entreprise")
        return v


class ArtisanProfile(BaseModel):
    """Full artisan profile as stored in MongoDB (artisan_profiles collection)."""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    user_id: str

    # Identity
    photo_url: Optional[str] = None
    first_name: str = ""
    last_name: str = ""
    metier_principal: str = ""  # main trade
    ville: str = ""
    quartier: str = ""
    zone_intervention_km: int = 10
    langues: List[str] = []  # ["francais", "dioula", "baoule", etc.]
    bio: Optional[str] = None  # max 200 chars

    # Experience
    annees_experience: Optional[int] = None
    statut_pro: str = "independant"  # independant | employe | entreprise
    nom_entreprise: Optional[str] = None
    description: Optional[str] = None  # max 300 chars
    types_projets: List[str] = []

    # Specialties
    domaines_specialite: List[str] = []  # immutable once configured
    domaines_specialite_locked: bool = False
    domaines_specialite_locked_at: Optional[datetime] = None
    specialites: List[str] = []  # max 5 tags
    competences_techniques: List[str] = []
    materiaux: List[str] = []

    # Portfolio
    galerie_photos: List[str] = []  # max 10 URLs
    projets: List[ProjetPortfolio] = []  # max 5

    # Verification
    phone_verified: bool = False
    cni_photo: Optional[str] = None
    diplome: Optional[str] = None
    tarif: Optional[str] = None
    horaires: Optional[str] = None
    moyen_paiement: Optional[str] = None

    # Computed (read-only, updated by scoring/badge systems)
    score_profil: float = 0.0
    score_confiance: float = 0.0
    badges: List[str] = []
    note_moyenne: float = 0.0
    missions_completees: int = 0
    affiliated_clients_count: int = 0

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}


class Badge(BaseModel):
    key: str
    label: str
    description: str
    icon: str

class Review(BaseModel):
    id: str
    rating: int
    text: str
    reviewer_name: str
    date: str  # YYYY-MM-DD

class ArtisanScoreResponse(BaseModel):
    """Response model for score/badge endpoints."""
    user_id: str
    score_profil: float
    score_confiance: float
    trust_label: str
    badges: List[Badge]
    note_moyenne: float
    total_reviews: int
    missions_completees: int
    completion_rate: int
    avg_response_time: str
    recent_reviews: List[Review]
    detail_confiance: Optional[Dict[str, Any]] = None


class ArtisanSearchResult(BaseModel):
    """Artisan profile enriched with ranking data for search results."""
    user_id: str
    first_name: str = ""
    last_name: str = ""
    photo_url: Optional[str] = None
    metier_principal: str = ""
    domaines_specialite: List[str] = []
    ville: str = ""
    quartier: str = ""
    specialites: List[str] = []
    note_moyenne: float = 0.0
    missions_completees: int = 0
    score_confiance: float = 0.0
    badges: List[str] = []
    annees_experience: Optional[int] = None
    bio: Optional[str] = None
    score_profil: float = 0.0
    affiliated_clients_count: int = 0
    ranking_score: float = 0.0
    distance_km: Optional[float] = None


class ArtisanReferralInfo(BaseModel):
    referral_id: str
    affiliated_clients_count: int = 0
    referral_link: str
    qr_payload: str
    qr_code_url: str


# =====================================================
# AUTH MODELS
# =====================================================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User

# =====================================================
# CREDIT SYSTEM - Systeme de Credit Artisan
# =====================================================

class ArtisanLevel(BaseModel):
    name: str
    credit_max: int
    min_missions: int
    min_rating: float
    commission_rate: float

class ArtisanCredit(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    artisan_id: str
    level: str = "fixed"
    credit_remaining: int = 5
    credit_max: int = 5
    commission_due: float = 0.0
    commission_rate: Optional[float] = None
    commission_per_mission: int = 2000
    missions_completed_in_cycle: int = 0
    is_blocked: bool = False
    blocked_at: Optional[datetime] = None  # legacy
    blocked_since: Optional[datetime] = None
    last_reminder_sent: Optional[datetime] = None
    total_earned: float = 0.0
    total_paid: float = 0.0
    last_payment_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class CommissionPayment(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    artisan_id: str
    amount: float
    payment_method: str
    transaction_id: Optional[str] = None
    credits_unlocked: int
    status: str = "pending"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class CommissionPaymentCreate(BaseModel):
    amount: Optional[float] = None
    payment_method: Optional[str] = None

class MissionTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    artisan_id: str
    booking_id: str
    client_id: str
    service_name: str
    amount: float
    commission: float
    artisan_earning: float
    status: str = "completed"
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class CreditStatus(BaseModel):
    artisan_id: str
    level: str = "fixed"
    level_name: str = "Plan fixe"
    credit_remaining: int
    credit_max: int
    commission_due: float
    commission_per_mission: int = 2000
    commission_rate_percent: str = "2 000 FCFA / mission"
    commission_model: str = "fixed_per_mission"
    cycle_commission_due: int = 10000
    missions_completed_in_cycle: int = 0
    missions_remaining_in_cycle: int = 0
    is_blocked: bool
    can_accept_mission: bool
    next_level: Optional[str] = None
    next_level_name: Optional[str] = None
    missions_to_next_level: Optional[int] = None
    blocked_since: Optional[datetime] = None
    last_reminder_sent: Optional[datetime] = None
    needs_payment_reminder: bool = False
    suspension_message: Optional[str] = None
    pay_button_label: Optional[str] = None
    total_earned: float = 0.0
    total_paid: float = 0.0
    last_payment_at: Optional[datetime] = None
