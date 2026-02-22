"""
Quick mock payment flow test (initiate -> webhook -> release).

Usage:
  python scripts/test_wave_flow.py

Assumes backend is running on http://localhost:8001 with PAYMENT_PROVIDER=mock.
Uses demo accounts provided in project context.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from typing import Any, Dict

import requests

BASE_URL = os.getenv("BACKEND_URL", "http://localhost:8001")
CLIENT_EMAIL = os.getenv("TEST_CLIENT_EMAIL", "demo.client@artisan.app")
ARTISAN_EMAIL = os.getenv("TEST_ARTISAN_EMAIL", "demo.artisan@artisan.app")
PASSWORD = os.getenv("TEST_PASSWORD", "demo123")
MOCK_WEBHOOK_SECRET = os.getenv("MOCK_WEBHOOK_SECRET", "mock-webhook-secret")


def _login(email: str, password: str) -> Dict[str, Any]:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _auth_header(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_and_accept_request(client_token: str, artisan_token: str, artisan_id: str) -> str:
    create_payload = {
        "service_type": "plomberie",
        "description": "Test paiement escrow mock",
        "photos": [],
        "address": "Abidjan Cocody",
        "location": {"type": "Point", "coordinates": [-3.99, 5.35]},
        "budget": 5000,
        "artisan_id": artisan_id,
    }

    r = requests.post(
        f"{BASE_URL}/api/requests",
        json=create_payload,
        headers=_auth_header(client_token),
        timeout=15,
    )
    r.raise_for_status()
    request_id = r.json()["_id"]

    r = requests.post(
        f"{BASE_URL}/api/requests/{request_id}/accept",
        headers=_auth_header(artisan_token),
        timeout=15,
    )
    r.raise_for_status()
    return request_id


def main() -> None:
    # 1) Login demo users
    client_login = _login(CLIENT_EMAIL, PASSWORD)
    artisan_login = _login(ARTISAN_EMAIL, PASSWORD)
    client_token = client_login["access_token"]
    artisan_token = artisan_login["access_token"]
    artisan_id = artisan_login["user"]["_id"]

    # 2) Create request and accept it
    request_id = _create_and_accept_request(client_token, artisan_token, artisan_id)

    # 3) Initiate escrow payment
    idempotency_key = f"itest-{secrets.token_hex(8)}"
    amount = 5000
    r = requests.post(
        f"{BASE_URL}/api/payments/initiate",
        json={
            "request_id": request_id,
            "amount": amount,
            "idempotency_key": idempotency_key,
        },
        headers=_auth_header(client_token),
        timeout=15,
    )
    r.raise_for_status()
    initiated = r.json()
    payment_intent_id = initiated["payment_intent_id"]

    # 4) Read provider_ref from status endpoint
    r = requests.get(
        f"{BASE_URL}/api/payments/status/{payment_intent_id}",
        headers=_auth_header(client_token),
        timeout=15,
    )
    r.raise_for_status()
    status_payload = r.json()
    provider_ref = status_payload["provider_ref"]

    # 5) Simulate provider webhook (mock signature)
    webhook_payload = {"id": provider_ref, "event": "checkout.session.completed"}
    webhook_body = json.dumps(webhook_payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.HMAC(
        MOCK_WEBHOOK_SECRET.encode("utf-8"), webhook_body, hashlib.sha256
    ).hexdigest()

    r = requests.post(
        f"{BASE_URL}/api/payments/webhook",
        data=webhook_body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
        },
        timeout=15,
    )
    r.raise_for_status()

    # 6) Release escrow to artisan
    r = requests.post(
        f"{BASE_URL}/api/payments/release/{payment_intent_id}",
        headers=_auth_header(client_token),
        timeout=15,
    )
    r.raise_for_status()
    released = r.json()

    # 7) Final status check
    r = requests.get(
        f"{BASE_URL}/api/payments/status/{payment_intent_id}",
        headers=_auth_header(client_token),
        timeout=15,
    )
    r.raise_for_status()
    final_status = r.json().get("status")

    print("[OK] Mock escrow flow passed")
    print(f"request_id={request_id}")
    print(f"payment_intent_id={payment_intent_id}")
    print(f"provider_ref={provider_ref}")
    print(f"final_status={final_status}")
    print(f"release_result={released}")


if __name__ == "__main__":
    main()
