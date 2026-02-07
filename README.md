# ARTISAN

Marketplace mobile connectant clients et artisans qualifies en Cote d'Ivoire.

**Stack**: Expo/React Native + FastAPI + MongoDB + Socket.IO

---

## Quickstart

### Prerequisites
- Python 3.11+
- Node.js 20+
- MongoDB (local or Atlas)
- Git

### Backend
```powershell
cd C:\klawd-data\projects\servicio-app

# Create venv + install deps
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# Copy and edit env
Copy-Item backend\.env.example backend\.env
# Edit backend\.env with your values

# Start server
.\.venv\Scripts\python.exe backend\server.py
# -> http://localhost:8001
# -> OpenAPI docs: http://localhost:8001/docs
```

### Frontend
```powershell
cd C:\klawd-data\projects\servicio-app\frontend

# Install deps
yarn install

# Copy and edit env
Copy-Item .env.example .env
# Set EXPO_PUBLIC_API_BASE_URL to your machine IP

# Start Expo dev server
npm start
# Scan QR code with Expo Go on your phone
```

### Tests
```powershell
cd C:\klawd-data\projects\servicio-app

# Backend tests (requires MongoDB running)
.\.venv\Scripts\python.exe -m pytest tests/ -q

# Frontend lint
cd frontend && npm run lint
```

---

## Project Structure

```
servicio-app/
  backend/
    server.py              # FastAPI app + legacy routes
    database.py            # MongoDB connection + indexes
    models.py              # Pydantic models
    auth.py                # JWT + Firebase auth
    permissions.py         # RBAC (super_admin, staff, finance, support)
    state_machine.py       # Service request lifecycle
    events.py              # Async event bus
    event_handlers.py      # Event -> notification/credit cascade
    notification_service.py # Multi-channel notifications
    scheduler.py           # Delayed notification scheduler
    credit_system.py       # Artisan fixed-cycle credits + commission
    socketio_server.py     # Real-time chat
    middleware.py           # Correlation ID + rate limiting
    payments/              # Escrow payment system (PaiementPro adapter + mock)
    routes/                # Modular API routes
    scripts/               # Migration + smoke test scripts
  frontend/
    app/                   # Expo Router screens
    src/config/            # Constants, service catalog
    src/services/          # API client, Socket.IO, notifications
    src/store/             # Zustand auth store
  tests/                   # pytest E2E + RBAC + payment tests
  .github/workflows/       # CI/CD (GitHub Actions)
  DEPLOY.md                # Deployment guide (Render + Atlas + EAS)
  RUNBOOK.md               # Operations runbook
```

---

## API Overview

| Prefix | Description |
|--------|-------------|
| `/api/auth/*` | Register, login, current user |
| `/api/requests/*` | Service request CRUD + lifecycle |
| `/api/conversations/*` | Chat conversations + messages |
| `/api/notifications/*` | User notifications + push token |
| `/api/payments/*` | Escrow payments (initiate, webhook, status) |
| `/api/credit/*` | Artisan credit system |
| `/api/health/*` | Health checks (liveness, DB, version) |
| `/api/admin/*` | Admin RBAC endpoints |

Full OpenAPI docs at `http://localhost:8001/docs`

---

## Key Flows

1. **Client creates request** -> artisan notified
2. **Artisan accepts** -> conversation auto-created, payment intent available
3. **Client pays (escrow)** -> funds held by platform
4. **Artisan starts -> completes** -> client notified
5. **Client confirms** -> funds released, commission deducted, credit consumed

---

## Deployment

See [DEPLOY.md](DEPLOY.md) for full staging + production deployment guide.
See [RUNBOOK.md](RUNBOOK.md) for operations, incidents, and rollback procedures.

---

## Environment Variables

See `backend/.env.example` and `frontend/.env.example` for complete lists.

