
import asyncio
import database
from database import connect_to_mongo, close_mongo_connection
import bcrypt
from datetime import datetime

async def check_and_seed_demo_users():
    await connect_to_mongo()
    
    if database.db is None:
        print("ERROR: Database not initialized")
        return

    # Check Artisan
    artisan_email = "demo.artisan@artisan.app"
    artisan = await database.db.users.find_one({"email": artisan_email})
    
    if not artisan:
        print(f"Creating demo artisan: {artisan_email}")
        hashed = bcrypt.hashpw("demo123".encode(), bcrypt.gensalt()).decode()
        new_artisan = {
            "name": "Jean Dupont",
            "email": artisan_email,
            "password_hash": hashed,
            "role": "artisan",
            "phone": "+2250707070707",
            "city": "Abidjan",
            "specialties": ["plomberie", "electricite"],
            "verified": True,
            "average_rating": 4.8,
            "total_missions": 42,
            "created_at": datetime.utcnow(),
            "last_seen_at": datetime.utcnow()
        }
        await database.db.users.insert_one(new_artisan)
    else:
        print(f"Demo artisan exists: {artisan_email}")
        
    # Check Client
    client_email = "demo.client@artisan.app"
    client = await database.db.users.find_one({"email": client_email})
    
    if not client:
        print(f"Creating demo client: {client_email}")
        hashed = bcrypt.hashpw("demo123".encode(), bcrypt.gensalt()).decode()
        new_client = {
            "name": "Marie Kone",
            "email": client_email,
            "password_hash": hashed,
            "role": "client",
            "phone": "+2250101010101",
            "city": "Abidjan",
            "created_at": datetime.utcnow(),
            "last_seen_at": datetime.utcnow()
        }
        await database.db.users.insert_one(new_client)
    else:
        print(f"Demo client exists: {client_email}")

    await close_mongo_connection()

if __name__ == "__main__":
    asyncio.run(check_and_seed_demo_users())
