"""
CREDIT SYSTEM - Système de Crédit Artisan
==========================================
Gère le crédit rotatif des artisans et les commissions.

Règles:
- Chaque artisan a un crédit de missions (ex: 3 missions)
- Chaque mission complétée consomme 1 crédit
- Quand crédit = 0, l'artisan est bloqué
- Pour débloquer: payer la commission due via Mobile Money
- Le niveau monte avec l'expérience (plus de crédit max)
"""

from datetime import datetime
from typing import Optional, Dict, Any
from bson import ObjectId
import database as db_module

# Configuration des niveaux
LEVELS = {
    "bronze": {
        "name": "Bronze",
        "credit_max": 3,
        "min_missions": 0,
        "min_rating": 0.0,
        "commission_rate": 0.15,  # 15%
    },
    "silver": {
        "name": "Argent", 
        "credit_max": 5,
        "min_missions": 20,
        "min_rating": 4.0,
        "commission_rate": 0.12,  # 12%
    },
    "gold": {
        "name": "Or",
        "credit_max": 10,
        "min_missions": 50,
        "min_rating": 4.5,
        "commission_rate": 0.10,  # 10%
    },
    "diamond": {
        "name": "Diamant",
        "credit_max": 15,
        "min_missions": 100,
        "min_rating": 4.5,
        "commission_rate": 0.08,  # 8%
    }
}

# Seuil de blocage (FCFA) - bloque si commission due > ce montant
BLOCK_THRESHOLD = 15000


async def get_or_create_credit(artisan_id: str) -> Dict[str, Any]:
    """Récupère ou crée le profil de crédit d'un artisan"""
    credit = await db_module.db.artisan_credits.find_one({"artisan_id": artisan_id})
    
    if not credit:
        # Créer un nouveau profil de crédit
        credit = {
            "_id": ObjectId(),
            "artisan_id": artisan_id,
            "level": "bronze",
            "credit_remaining": LEVELS["bronze"]["credit_max"],
            "credit_max": LEVELS["bronze"]["credit_max"],
            "commission_due": 0.0,
            "commission_rate": LEVELS["bronze"]["commission_rate"],
            "is_blocked": False,
            "blocked_at": None,
            "total_earned": 0.0,
            "total_paid": 0.0,
            "last_payment_at": None,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        await db_module.db.artisan_credits.insert_one(credit)
    
    credit["_id"] = str(credit["_id"])
    return credit


async def check_can_accept_mission(artisan_id: str) -> Dict[str, Any]:
    """Vérifie si l'artisan peut accepter une nouvelle mission"""
    credit = await get_or_create_credit(artisan_id)
    
    can_accept = (
        credit["credit_remaining"] > 0 
        and not credit["is_blocked"]
        and credit["commission_due"] < BLOCK_THRESHOLD
    )
    
    return {
        "can_accept": can_accept,
        "credit_remaining": credit["credit_remaining"],
        "commission_due": credit["commission_due"],
        "is_blocked": credit["is_blocked"],
        "reason": None if can_accept else _get_block_reason(credit)
    }


def _get_block_reason(credit: Dict) -> str:
    """Retourne la raison du blocage"""
    if credit["is_blocked"]:
        return "Compte bloqué - Veuillez régler votre commission"
    if credit["credit_remaining"] <= 0:
        return "Plus de crédit disponible - Veuillez régler votre commission"
    if credit["commission_due"] >= BLOCK_THRESHOLD:
        return f"Commission due trop élevée ({credit['commission_due']:,.0f} FCFA) - Veuillez régler"
    return "Raison inconnue"


async def consume_credit(artisan_id: str, booking_id: str, amount: float) -> Dict[str, Any]:
    """
    Consomme 1 crédit et enregistre la commission.
    Appelé quand une mission est COMPLETÉE.
    """
    credit = await get_or_create_credit(artisan_id)
    
    # Calculer la commission
    commission = amount * credit["commission_rate"]
    artisan_earning = amount - commission
    
    # Mettre à jour le crédit
    new_credit_remaining = max(0, credit["credit_remaining"] - 1)
    new_commission_due = credit["commission_due"] + commission
    
    # Vérifier si on doit bloquer
    should_block = (
        new_credit_remaining <= 0 
        or new_commission_due >= BLOCK_THRESHOLD
    )
    
    # Update dans la DB
    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {"$set": {
            "credit_remaining": new_credit_remaining,
            "commission_due": new_commission_due,
            "total_earned": credit["total_earned"] + artisan_earning,
            "is_blocked": should_block,
            "blocked_at": datetime.utcnow() if should_block and not credit["is_blocked"] else credit.get("blocked_at"),
            "updated_at": datetime.utcnow()
        }}
    )
    
    # Enregistrer la transaction
    transaction = {
        "_id": ObjectId(),
        "artisan_id": artisan_id,
        "booking_id": booking_id,
        "amount": amount,
        "commission": commission,
        "artisan_earning": artisan_earning,
        "status": "completed",
        "created_at": datetime.utcnow()
    }
    await db_module.db.mission_transactions.insert_one(transaction)
    
    return {
        "credit_remaining": new_credit_remaining,
        "commission_due": new_commission_due,
        "commission_this_mission": commission,
        "artisan_earning": artisan_earning,
        "is_blocked": should_block,
        "message": "Compte bloqué - Réglez votre commission pour continuer" if should_block else "OK"
    }


async def pay_commission(artisan_id: str, amount: float, payment_method: str, transaction_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Enregistre un paiement de commission et débloque le compte.
    """
    credit = await get_or_create_credit(artisan_id)
    
    # Calculer le nouveau solde
    new_commission_due = max(0, credit["commission_due"] - amount)
    
    # Calculer les crédits à débloquer
    # Si paiement total: full credit, sinon proportionnel
    if new_commission_due == 0:
        credits_unlocked = credit["credit_max"]
    else:
        # Paiement partiel: débloquer proportionnellement
        paid_ratio = amount / credit["commission_due"] if credit["commission_due"] > 0 else 1
        credits_unlocked = int(credit["credit_max"] * paid_ratio)
        credits_unlocked = max(1, min(credits_unlocked, credit["credit_max"]))
    
    # Vérifier si on peut débloquer
    should_unblock = new_commission_due < BLOCK_THRESHOLD
    
    # Update
    await db_module.db.artisan_credits.update_one(
        {"artisan_id": artisan_id},
        {"$set": {
            "commission_due": new_commission_due,
            "credit_remaining": credits_unlocked,
            "total_paid": credit["total_paid"] + amount,
            "is_blocked": not should_unblock,
            "blocked_at": None if should_unblock else credit.get("blocked_at"),
            "last_payment_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }}
    )
    
    # Enregistrer le paiement
    payment = {
        "_id": ObjectId(),
        "artisan_id": artisan_id,
        "amount": amount,
        "payment_method": payment_method,
        "transaction_id": transaction_id,
        "credits_unlocked": credits_unlocked,
        "status": "completed",
        "created_at": datetime.utcnow(),
        "completed_at": datetime.utcnow()
    }
    await db_module.db.commission_payments.insert_one(payment)
    
    return {
        "success": True,
        "amount_paid": amount,
        "commission_remaining": new_commission_due,
        "credits_unlocked": credits_unlocked,
        "is_blocked": not should_unblock,
        "message": "Paiement reçu ! Votre compte est débloqué." if should_unblock else f"Paiement reçu. Il reste {new_commission_due:,.0f} FCFA à régler."
    }


async def update_level(artisan_id: str) -> Dict[str, Any]:
    """
    Met à jour le niveau de l'artisan basé sur ses stats.
    Appelé périodiquement ou après chaque mission.
    """
    # Récupérer les stats de l'artisan
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    if not artisan:
        return {"error": "Artisan not found"}
    
    total_missions = artisan.get("total_missions", 0)
    avg_rating = artisan.get("average_rating", 0.0)
    
    credit = await get_or_create_credit(artisan_id)
    current_level = credit["level"]
    
    # Déterminer le nouveau niveau
    new_level = "bronze"
    for level_key in ["diamond", "gold", "silver", "bronze"]:
        level_config = LEVELS[level_key]
        if (total_missions >= level_config["min_missions"] 
            and avg_rating >= level_config["min_rating"]):
            new_level = level_key
            break
    
    # Si niveau a changé, mettre à jour
    if new_level != current_level:
        level_config = LEVELS[new_level]
        await db_module.db.artisan_credits.update_one(
            {"artisan_id": artisan_id},
            {"$set": {
                "level": new_level,
                "credit_max": level_config["credit_max"],
                "commission_rate": level_config["commission_rate"],
                "updated_at": datetime.utcnow()
            }}
        )
        
        return {
            "level_changed": True,
            "old_level": current_level,
            "new_level": new_level,
            "new_credit_max": level_config["credit_max"],
            "new_commission_rate": level_config["commission_rate"]
        }
    
    return {"level_changed": False, "current_level": current_level}


async def get_credit_status(artisan_id: str) -> Dict[str, Any]:
    """Retourne le statut complet du crédit pour l'UI"""
    credit = await get_or_create_credit(artisan_id)
    artisan = await db_module.db.users.find_one({"_id": ObjectId(artisan_id)})
    
    total_missions = artisan.get("total_missions", 0) if artisan else 0
    
    # Calculer le prochain niveau
    current_level = credit["level"]
    next_level = None
    missions_to_next = None
    
    level_order = ["bronze", "silver", "gold", "diamond"]
    current_idx = level_order.index(current_level)
    
    if current_idx < len(level_order) - 1:
        next_level = level_order[current_idx + 1]
        next_config = LEVELS[next_level]
        missions_to_next = max(0, next_config["min_missions"] - total_missions)
    
    return {
        "artisan_id": artisan_id,
        "level": current_level,
        "level_name": LEVELS[current_level]["name"],
        "credit_remaining": credit["credit_remaining"],
        "credit_max": credit["credit_max"],
        "commission_due": credit["commission_due"],
        "commission_rate": credit["commission_rate"],
        "commission_rate_percent": f"{credit['commission_rate'] * 100:.0f}%",
        "is_blocked": credit["is_blocked"],
        "can_accept_mission": credit["credit_remaining"] > 0 and not credit["is_blocked"],
        "total_earned": credit["total_earned"],
        "total_paid": credit["total_paid"],
        "next_level": next_level,
        "next_level_name": LEVELS[next_level]["name"] if next_level else None,
        "missions_to_next_level": missions_to_next
    }
