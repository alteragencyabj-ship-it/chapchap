from pymongo import MongoClient
from passlib.context import CryptContext
from datetime import datetime

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
c = MongoClient("mongodb://localhost:27017/")
db = c["servicio"]

users = [
    {
        "name": "Client Demo",
        "email": "demo.client@artisan.app",
        "phone": "+22500000001",
        "role": "client",
        "password_hash": pwd_context.hash("demo123"),
        "is_verified": True,
        "created_at": datetime.utcnow(),
        "credits": 100,
        "location": {"type": "Point", "coordinates": [-3.9962, 5.3600]},
    },
    {
        "name": "Artisan Demo",
        "email": "demo.artisan@artisan.app",
        "phone": "+22500000002",
        "role": "artisan",
        "password_hash": pwd_context.hash("demo123"),
        "is_verified": True,
        "created_at": datetime.utcnow(),
        "credits": 50,
        "specialties": ["plomberie", "electricite"],
        "location": {"type": "Point", "coordinates": [-3.9962, 5.3600]},
        "rating": 4.8,
        "completed_missions": 24,
    },
]

for u in users:
    db.users.update_one({"email": u["email"]}, {"$set": u}, upsert=True)
    print(f"Seeded: {u['email']}")
print("Done!")
