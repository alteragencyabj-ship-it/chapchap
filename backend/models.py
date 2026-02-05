from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List
from datetime import datetime
from bson import ObjectId

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

# User Models
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

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# Booking Models (New for checkout)
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

# Service Request Models
class ServiceRequestCreate(BaseModel):
    service_type: str  # peinture, plomberie, électricité, etc.
    description: str
    photos: List[str] = []  # base64 images
    address: str
    location: GeoLocation
    budget: Optional[float] = None

class ServiceRequest(ServiceRequestCreate):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    client_id: str
    status: str = "pending"  # pending, assigned, in_progress, completed, cancelled
    assigned_artisan_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# Message Models
class MessageCreate(BaseModel):
    request_id: str
    receiver_id: str
    message: str

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    request_id: str
    sender_id: str
    receiver_id: str
    message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    read: bool = False

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# Rating Models
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

# Auth Models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User

# =====================================================
# CREDIT SYSTEM - Système de Crédit Artisan
# =====================================================

class ArtisanLevel(BaseModel):
    """Niveau de l'artisan qui détermine son crédit max"""
    name: str  # bronze, silver, gold, diamond
    credit_max: int  # 3, 5, 10, 15
    min_missions: int  # 0, 20, 50, 100
    min_rating: float  # 0, 4.0, 4.5, 4.5
    commission_rate: float  # 0.15 (15%)

class ArtisanCredit(BaseModel):
    """État du crédit d'un artisan"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    artisan_id: str
    level: str = "bronze"  # bronze, silver, gold, diamond
    credit_remaining: int = 3  # Missions disponibles
    credit_max: int = 3
    commission_due: float = 0.0  # Montant dû à la société (FCFA)
    commission_rate: float = 0.15  # 15% par défaut
    is_blocked: bool = False
    blocked_at: Optional[datetime] = None
    total_earned: float = 0.0  # Total gagné par l'artisan
    total_paid: float = 0.0  # Total reversé à la société
    last_payment_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class CommissionPayment(BaseModel):
    """Historique des paiements de commission"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    artisan_id: str
    amount: float  # Montant payé (FCFA)
    payment_method: str  # wave, orange_money, mtn, cash
    transaction_id: Optional[str] = None  # ID de la transaction Mobile Money
    credits_unlocked: int  # Nombre de crédits débloqués
    status: str = "pending"  # pending, completed, failed
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class CommissionPaymentCreate(BaseModel):
    """Pour créer un paiement de commission"""
    amount: float
    payment_method: str  # wave, orange_money, mtn, cash

class MissionTransaction(BaseModel):
    """Historique des transactions par mission"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    artisan_id: str
    booking_id: str
    client_id: str
    service_name: str
    amount: float  # Montant du service (FCFA)
    commission: float  # Commission prélevée (FCFA)
    artisan_earning: float  # Ce que l'artisan garde (FCFA)
    status: str = "completed"  # completed, refunded
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class CreditStatus(BaseModel):
    """Réponse API pour le statut du crédit"""
    artisan_id: str
    level: str
    credit_remaining: int
    credit_max: int
    commission_due: float
    is_blocked: bool
    can_accept_mission: bool
    next_level: Optional[str] = None
    missions_to_next_level: Optional[int] = None
