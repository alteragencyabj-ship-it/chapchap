"""
Smoke test: verify push token registration in MongoDB.

Usage (PowerShell):
  cd C:\\klawd-data\\projects\\chapchap\\CHAPCHAP-main
  .\\.venv\\Scripts\\python.exe backend\\scripts\\smoke_push_token.py

Checks:
1. Connects to MongoDB.
2. Counts users with a push_token field set.
3. Prints summary.

Exit code 0 = at least one token found, 1 = no tokens, 2 = connection error.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

backend_dir = Path(__file__).resolve().parents[1]
load_dotenv(backend_dir / ".env")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.getenv("DB_NAME", "artisan_connect")


def main() -> int:
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except Exception as e:
        print(f"[ERROR] Cannot connect to MongoDB: {e}")
        return 2

    db = client[DB_NAME]

    total_users = db.users.count_documents({})
    with_token = db.users.count_documents({"push_token": {"$exists": True, "$ne": None, "$ne": ""}})
    without_token = total_users - with_token

    print(f"[PUSH TOKEN SMOKE TEST]")
    print(f"  Total users:       {total_users}")
    print(f"  With push_token:   {with_token}")
    print(f"  Without:           {without_token}")

    if with_token > 0:
        # Show sample (redacted)
        sample = db.users.find_one(
            {"push_token": {"$exists": True, "$ne": None, "$ne": ""}},
            {"_id": 0, "name": 1, "role": 1, "push_token": 1},
        )
        if sample:
            token = sample.get("push_token", "")
            redacted = token[:20] + "..." if len(token) > 20 else token
            print(f"  Sample: {sample.get('name')} ({sample.get('role')}) -> {redacted}")
        print("[OK] Push tokens found in database")
        return 0
    else:
        print("[WARN] No push tokens found. Register via the mobile app first.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
