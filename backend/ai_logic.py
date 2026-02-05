import os
from typing import Dict, Any, List
# On utilisera ce script pour centraliser l'intelligence de l'app

async def analyze_service_request(description: str) -> Dict[str, Any]:
    """
    Simule une analyse IA du brief client.
    Plus tard, on connectera GPT-4 ou Claude ici.
    """
    description = description.lower()
    
    # Logique simple de "fallback" IA (en attendant le vrai LLM)
    category = "taches_quotidiennes"
    if any(kw in description for kw in ["tuyau", "fuite", "robinet", "évier"]):
        category = "plomberie"
    elif any(kw in description for kw in ["ampoule", "prise", "courant", "câble", "électricité"]):
        category = "electricite"
    elif any(kw in description for kw in ["peinture", "mur", "couleur"]):
        category = "bricolage"
    elif any(kw in description for kw in ["clim", "froid", "climatisation"]):
        category = "climatisation"
    
    return {
        "suggested_category": category,
        "urgency_score": 0.8 if "urgent" in description or "vite" in description else 0.3,
        "ai_summary": f"Demande analysée : {description[:50]}..."
    }
