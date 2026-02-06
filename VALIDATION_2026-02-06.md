# Validation ChapChap -- 2026-02-06 (v2 -- staging-ready)

## Contexte
Validation runtime et lint suite a l'implementation des phases 1-5 + hardening staging/prod.

## Backend (C:/klawd-data/projects/chapchap/CHAPCHAP-main/backend/)

### Installation
- Venv creee: `C:/klawd-data/projects/chapchap/CHAPCHAP-main/.venv/`
- Deps installees depuis `backend/requirements.txt` (1 package non-PyPI commente: `emergentintegrations==0.1.0`).

### Fix critique (startup)
- Probleme: crash au demarrage MongoDB lors de la creation d'index TTL sur `audit_log.timestamp`.
  - Cause: index `timestamp_1` cree une premiere fois sans TTL, puis recreation avec `expireAfterSeconds` => `IndexOptionsConflict`.
- Fix: `backend/database.py`
  - Ajout helper `_ensure_ttl_index()` qui drop l'index equivalent existant si options incompatibles, puis recree le TTL.
  - Applique a `audit_log.timestamp` (365j) et `notifications.created_at` (90j).

### Tests automatises (pytest)
```
5 passed, 24 warnings in 2.99s
```
- `tests/test_backend_smoke_e2e.py` -- Flow E2E (register -> request -> accept -> chat -> lifecycle -> notifications)
- `tests/test_backend_admin_rbac.py` -- RBAC permission enforcement (2 tests)
- `tests/test_payments.py` -- Payment initiation + idempotency + webhook processing (2 tests)

### Backend Hardening (NEW)
- [x] CORS: env-driven `ALLOWED_ORIGINS` (no wildcard in production)
- [x] Socket.IO CORS aligned with `ALLOWED_ORIGINS`
- [x] Secrets validation: fail-fast if `JWT_SECRET` is default in `ENVIRONMENT=production`
- [x] Correlation ID middleware (`X-Correlation-ID` header on every request)
- [x] Rate limiting: 60 req/min per IP (in-memory, skips health + socketio)
- [x] Structured logging with environment-aware log level

### Health Endpoints (NEW)
- [x] `GET /api/health` -- liveness probe (200 OK)
- [x] `GET /api/health/db` -- MongoDB ping (200 or 503)
- [x] `GET /api/health/version` -- git SHA `dfdbcab`, environment, payment provider

### Payments MVP (NEW)
- [x] Adapter pattern: `MockPaymentAdapter` (dev) + `WavePaymentAdapter` (prod)
- [x] Escrow at acceptance: client pays when artisan accepts
- [x] Release after confirmation: commission deducted per artisan credit tier
- [x] Idempotency keys (unique index, blocks double charges)
- [x] Endpoints: `/api/payments/initiate`, `/webhook`, `/status/{id}`, `/by-request/{id}`
- [x] Mock adapter: deterministic, no credentials needed, tests pass offline
- [x] DB collections: `payment_intents` (6 indexes), `payment_events` (2 indexes)

### Migration legacy (bookings -> service_requests)
- Script: `backend/scripts/migrate_bookings_to_service_requests.py`
  - Mode par defaut: `--dry-run`
  - Migration appliquee: `[APPLY] bookings_seen=1 created=1 skipped=0 errors=0`
  - Rapport JSON: `migration_report.json`
- Idempotent via `legacy_booking_id`

### Petits ajustements de robustesse
- `backend/auth.py`: lit maintenant `JWT_SECRET` (et garde compat `JWT_SECRET_KEY`).
- `backend/server.py`: `uvicorn.run()` utilise `HOST` / `PORT` depuis `.env` (fallback 0.0.0.0:8001).

## Frontend (C:/klawd-data/projects/chapchap/CHAPCHAP-main/frontend/)

### Lint
```
0 errors, 10 warnings
```

### Config
- `frontend/src/config/constants.ts`: `API_BASE_URL` configurable via `EXPO_PUBLIC_API_BASE_URL`.
- `frontend/.env.example` cree (API_BASE_URL, EXPO_PROJECT_ID, GOOGLE_MAPS_KEY).
- `frontend/eas.json` cree (profils dev, staging, production).

## CI/CD
- GitHub Actions workflow: `backend pytest` + `frontend lint`
- **BLOQUE**: Compte GitHub `alteragencyabj-ship-it` verrouille pour billing -- corriger dans Settings > Billing

## Deploiement
- `render.yaml` cree -- Render Blueprint (1-click deploy)
- `DEPLOY.md` -- guide complet (Render + Atlas + EAS)
- `RUNBOOK.md` -- operations, incidents, rollback

## Commandes utiles

```powershell
# Backend
cd C:\klawd-data\projects\chapchap\CHAPCHAP-main
.\.venv\Scripts\python.exe backend\server.py

# Tests
.\.venv\Scripts\python.exe -m pytest tests/ -q

# Frontend
cd frontend && npm start && npm run lint

# Migration
.\.venv\Scripts\python.exe backend\scripts\migrate_bookings_to_service_requests.py --dry-run

# Push token smoke
.\.venv\Scripts\python.exe backend\scripts\smoke_push_token.py
```

## Blockers restants
1. GitHub billing (bloque CI)
2. Wave merchant account (pas encore cree)
3. FCM/APNs credentials (besoin EAS + Apple/Google dev)
4. MongoDB Atlas (cluster a creer)
5. Render service (render.yaml pret, 1-click)
