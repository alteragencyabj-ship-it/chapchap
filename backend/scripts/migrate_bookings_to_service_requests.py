"""
Migrate legacy `bookings` documents to `service_requests`.

Why:
- The app is moving from the legacy "bookings" model to the new "service_requests"
  model + state machine.
- Existing databases can contain `bookings` documents that should remain usable in
  the new flow.

Safety:
- Default mode is DRY RUN (no writes).
- The migration is idempotent using `legacy_booking_id`.

Notes:
- Legacy bookings do not always include a GeoJSON `location`. We keep `location=None`
  in migrated service requests (the model allows it for legacy data).

Usage (PowerShell):
  cd C:\klawd-data\projects\chapchap\CHAPCHAP-main\backend
  ..\.venv\Scripts\python.exe .\scripts\migrate_bookings_to_service_requests.py --dry-run
  ..\.venv\Scripts\python.exe .\scripts\migrate_bookings_to_service_requests.py --apply --limit 100
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient


STATUS_MAP = {
    # Legacy booking statuses -> new request statuses
    "pending_artisan": "published",
    "pending": "published",
    "published": "published",
    "accepted": "accepted",
    "in_progress": "in_progress",
    "completed": "completed",
    "cancelled": "cancelled",
}


def _coerce_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.utcnow()


def _build_service_request_from_booking(booking: Dict[str, Any]) -> Dict[str, Any]:
    booking_id = booking["_id"]
    booking_id_str = str(booking_id)

    service_name = booking.get("service_name")
    notes = booking.get("notes")
    description_parts = []
    if service_name:
        description_parts.append(str(service_name))
    if notes:
        description_parts.append(str(notes))
    description = "\n\n".join(description_parts) if description_parts else "Migrated from legacy booking."

    address = booking.get("address") or ""
    quartier = booking.get("quartier")
    if quartier:
        address = f"{address} ({quartier})" if address else str(quartier)

    legacy_status = booking.get("status") or "pending_artisan"
    status = STATUS_MAP.get(str(legacy_status), "published")

    created_at = _coerce_dt(booking.get("created_at"))
    updated_at = _coerce_dt(booking.get("updated_at")) if booking.get("updated_at") else None
    completed_at = _coerce_dt(booking.get("completed_at")) if booking.get("completed_at") else None

    client_id = booking.get("client_id")
    artisan_id = booking.get("artisan_id")

    doc: Dict[str, Any] = {
        # Core request fields
        "service_type": booking.get("category_id") or booking.get("service_type") or "unknown",
        "description": description,
        "photos": booking.get("photos") or [],
        "address": address,
        "location": booking.get("location"),  # may be None
        "budget": None,
        # Targeted artisan (booking was usually created after selecting artisan)
        "artisan_id": artisan_id,
        "assigned_artisan_id": artisan_id,
        # Booking compat / UI
        "service_name": service_name,
        "service_price": booking.get("service_price"),
        "phone": booking.get("phone"),
        "payment_method": booking.get("payment_method"),
        # Ownership
        "client_id": client_id,
        # State machine
        "status": status,
        "status_history": [
            {
                "from": None,
                "to": "published",
                "actor_id": client_id,
                "timestamp": created_at,
                "reason": "migrated_from_booking",
            }
        ],
        "created_at": created_at,
        # Idempotency marker
        "legacy_booking_id": booking_id_str,
    }

    # Add best-effort timeline/history
    if status in ("accepted", "in_progress", "completed", "confirmed"):
        ts = updated_at or created_at
        doc["accepted_at"] = ts
        doc["status_history"].append(
            {
                "from": "published",
                "to": "accepted",
                "actor_id": artisan_id,
                "timestamp": ts,
                "reason": "migrated_from_booking",
            }
        )

    if status in ("in_progress", "completed", "confirmed"):
        ts = updated_at or created_at
        doc["started_at"] = ts
        doc["status_history"].append(
            {
                "from": "accepted",
                "to": "in_progress",
                "actor_id": artisan_id,
                "timestamp": ts,
                "reason": "migrated_from_booking",
            }
        )

    if status in ("completed", "confirmed"):
        ts = completed_at or updated_at or created_at
        doc["completed_at"] = ts
        doc["status_history"].append(
            {
                "from": "in_progress",
                "to": "completed",
                "actor_id": artisan_id,
                "timestamp": ts,
                "reason": "migrated_from_booking",
            }
        )

    if status == "cancelled":
        ts = updated_at or created_at
        doc["cancelled_at"] = ts
        doc["cancel_reason"] = booking.get("notes")
        doc["status_history"].append(
            {
                "from": "published",
                "to": "cancelled",
                "actor_id": client_id,
                "timestamp": ts,
                "reason": "migrated_from_booking",
            }
        )

    return doc


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate bookings -> service_requests")
    parser.add_argument("--mongo-url", default=None, help="Override MONGO_URL")
    parser.add_argument("--db-name", default=None, help="Override DB_NAME")
    parser.add_argument("--limit", type=int, default=0, help="Max number of bookings to process (0 = no limit)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run (no writes). Default if --apply not set.")
    parser.add_argument("--apply", action="store_true", help="Apply migration (writes to DB)")
    args = parser.parse_args()

    apply = bool(args.apply)
    if not apply:
        args.dry_run = True

    backend_dir = Path(__file__).resolve().parents[1]
    load_dotenv(backend_dir / ".env")

    mongo_url = args.mongo_url or os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = args.db_name or os.getenv("DB_NAME", "artisan_connect")

    client = MongoClient(mongo_url)
    db = client[db_name]

    bookings = db.bookings.find({}).sort("created_at", 1)
    if args.limit and args.limit > 0:
        bookings = bookings.limit(args.limit)

    seen = 0
    created = 0
    skipped = 0
    errors = 0

    for booking in bookings:
        seen += 1
        try:
            legacy_booking_id = str(booking["_id"])
            existing = db.service_requests.find_one({"legacy_booking_id": legacy_booking_id}, {"_id": 1})
            if existing:
                skipped += 1
                continue

            doc = _build_service_request_from_booking(booking)

            if args.dry_run:
                continue

            result = db.service_requests.insert_one(doc)
            created += 1

            # Optional: tag booking as migrated (non-breaking)
            db.bookings.update_one(
                {"_id": booking["_id"]},
                {"$set": {"migrated_to_service_request_id": str(result.inserted_id), "migrated_at": datetime.utcnow()}},
            )
        except Exception:
            errors += 1

    client.close()

    mode = "APPLY" if apply else "DRY_RUN"
    print(f"[{mode}] bookings_seen={seen} created={created} skipped={skipped} errors={errors}")

    # Write JSON report
    import json
    report = {
        "mode": mode,
        "timestamp": datetime.utcnow().isoformat(),
        "mongo_url": mongo_url.split("@")[-1] if "@" in mongo_url else mongo_url,
        "db_name": db_name,
        "bookings_seen": seen,
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }
    report_path = Path(__file__).resolve().parents[2] / "migration_report.json"
    report_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"Report written to {report_path}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())

