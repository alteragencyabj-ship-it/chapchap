from pydantic import BaseModel, Field, EmailStr
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
    status: str = "published"
    assigned_artisan_id: Optional[str] = None
    status_history: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    accepted_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
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
    credit_remaining: int
    credit_max: int
    commission_due: float
    commission_per_mission: int = 2000
    cycle_commission_due: int = 10000
    missions_completed_in_cycle: int = 0
    missions_remaining_in_cycle: int = 0
    is_blocked: bool
    can_accept_mission: bool
    blocked_since: Optional[datetime] = None
    last_reminder_sent: Optional[datetime] = None
    needs_payment_reminder: bool = False
    suspension_message: Optional[str] = None
    pay_button_label: Optional[str] = None
