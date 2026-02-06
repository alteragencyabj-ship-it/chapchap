# Validation ChapChap — 2026-02-06

## Contexte
Validation runtime et lint suite a l'implementation des phases 1-5 (backend FastAPI/Mongo/Socket.IO + frontend Expo).

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

### Smoke test (OK)
Test execute via `fastapi.testclient.TestClient` (lifespan active):
- GET `/api/health` => 200
- GET `/openapi.json` => routers montes (requests/conversations/notifications + /api/admin/*)
- POST `/api/auth/register` (client + artisan)
- POST `/api/requests` (client, request ciblee artisan)
- POST `/api/requests/{id}/accept` (artisan) => conversation auto
- POST `/api/conversations/{id}/messages`
- POST `/api/requests/{id}/start` -> `/complete` -> `/confirm`
- GET `/api/notifications` (client + artisan)

### Petits ajustements de robustesse
- `backend/auth.py`: lit maintenant `JWT_SECRET` (et garde compat `JWT_SECRET_KEY`).
- `backend/server.py`: `uvicorn.run()` utilise `HOST` / `PORT` depuis `.env` (fallback 0.0.0.0:8001).

### Migration legacy (bookings -> service_requests)
- Script: `backend/scripts/migrate_bookings_to_service_requests.py`
  - Mode par defaut: `--dry-run`
  - Appliquer: `--apply`
- `ServiceRequest.location` est maintenant optionnel (support legacy bookings sans GeoJSON).

### Tests automatises (pytest)
- Ajoutes:
  - `tests/test_backend_smoke_e2e.py` (flow E2E principal)
  - `tests/test_backend_admin_rbac.py` (RBAC admin)
- Run: depuis `CHAPCHAP-main/` -> `.\.venv\Scripts\python.exe -m pytest -q`

## Frontend (C:/klawd-data/projects/chapchap/CHAPCHAP-main/frontend/)

### Deps / lint
- Ajout dependency: `expo-notifications` (via `expo install`).
- Fix peer deps: `@types/react` bump a `^19.1.0`.
- `npm run lint` => 0 erreur (warnings restantes seulement).

### Fix lint bloquants
- `frontend/eslint.config.js`: desactive `react/no-unescaped-entities` (bruyant pour React Native).
- `frontend/app/booking-confirmation.tsx`: suppression import `lottie-react-native` (inutilise + module manquant).
- `frontend/src/services/notifications.ts`: suppression import inutilise `Platform`.

### Config API
- `frontend/src/config/constants.ts`: `API_BASE_URL` configurable via `EXPO_PUBLIC_API_BASE_URL`.
  - Fallback aligne sur backend `.env` (port 8001).

## Commandes utiles

### Backend
Depuis `.../CHAPCHAP-main/backend/`:
- `..\.venv\Scripts\python.exe server.py`

### Frontend
Depuis `.../CHAPCHAP-main/frontend/`:
- `npm start`
- `npm run lint`

## Points connus (non bloques)
- Scheduler + rate limiter en memoire (perdus au restart).
- Push notifications: configuration projet Expo (projectId + setup iOS/Android) a completer.
