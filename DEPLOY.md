# ARTISAN -- Deployment Guide

## Architecture Decision: Escrow at Acceptance

**Decision**: Payment intent is created when **artisan accepts** the request.

**Justification**:
- The artisan knows funds are secured before starting work.
- Client pays upfront into escrow (not charged until confirmation).
- Release happens after client confirms satisfaction (or auto-release after 72h).
- Platform commission is fixed at 2 000 FCFA per mission (cycle of 5 missions).
- This is the standard marketplace escrow pattern (Uber, Fiverr, etc.).

If service is disputed, admin resolves and can trigger refund or partial release.

---

## Stack

| Component | Provider | Plan |
|-----------|----------|------|
| Backend | **Render** (Web Service) | Free tier for staging, Starter ($7/mo) for prod |
| Database | **MongoDB Atlas** | M0 Free (staging), M10+ (prod) |
| Frontend | **EAS Build** + **Expo Updates** | Free for dev, Production ($99/mo) |
| Payments | **PaiementPro** | SOAP API (merchant account required) |
| Push | **Expo Push** (via FCM/APNs) | Free (included with EAS) |

---

## 1. MongoDB Atlas Setup

### Staging
1. Create free cluster at https://cloud.mongodb.com
2. Database name: `artisan_staging`
3. Create user: `artisan_staging` with read/write access
4. Whitelist Render IPs (or 0.0.0.0/0 for staging)
5. Get connection string: `mongodb+srv://artisan_staging:<password>@cluster0.xxxxx.mongodb.net/artisan_staging`

### Production
1. Upgrade to M10 dedicated cluster
2. Database name: `artisan_prod`
3. Enable backup (daily snapshots)
4. IP whitelist: Render static IPs only
5. Enable audit logging

---

## 2. Backend Deployment (Render)

### Create Web Service
1. Connect GitHub repo
2. Runtime: Python 3.11
3. Build command: `pip install -r backend/requirements.txt`
4. Start command: `cd backend && uvicorn server:socket_app --host 0.0.0.0 --port $PORT`
5. Root directory: (leave empty, build from repo root)

### Environment Variables (Render Dashboard)

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `ENVIRONMENT` | Yes | `staging` or `production` | Controls CORS, secrets validation |
| `MONGO_URL` | Yes | `mongodb+srv://...` | Atlas connection string |
| `DB_NAME` | Yes | `artisan_staging` | Database name |
| `JWT_SECRET` | Yes | (32+ char random string) | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `JWT_ALGORITHM` | No | `HS256` | Default: HS256 |
| `HOST` | No | `0.0.0.0` | Default: 0.0.0.0 |
| `PORT` | No | `10000` | Render sets this automatically |
| `ALLOWED_ORIGINS` | Yes | `https://artisan.ci,https://staging.artisan.ci` | Comma-separated, NO wildcard in prod |
| `PAYMENT_PROVIDER` | Yes | `mock` (staging) or `paiementpro` (prod) | Provider to use |
| `PAIEMENTPRO_MERCHANT_ID` | Prod only | `PP-F6917` | PaiementPro merchant ID |
| `PAIEMENTPRO_WEBHOOK_SECRET` | Prod only | (from PaiementPro dashboard) | For hashcode verification |
| `PAIEMENTPRO_WSDL_URL` | No | `https://www.paiementpro.net/webservice/OnlineServicePayment_v2.php?wsdl` | Default production WSDL |
| `PAIEMENTPRO_CURRENCY_CODE` | No | `952` | XOF (FCFA) |
| `EXPO_ACCESS_TOKEN` | Optional | (from expo.dev) | For server-side push if needed |

### Generate JWT Secret (PowerShell)
```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

### Verify Deployment
```powershell
# Health check
Invoke-RestMethod -Uri "https://artisan-api.onrender.com/api/health"

# DB connectivity
Invoke-RestMethod -Uri "https://artisan-api.onrender.com/api/health/db"

# Version info
Invoke-RestMethod -Uri "https://artisan-api.onrender.com/api/health/version"
```

---

## 3. Frontend Deployment (EAS)

### Prerequisites
1. Install EAS CLI: `npm install -g eas-cli`
2. Login: `eas login`
3. Configure project: `eas init`

### EAS Build Profiles

Add to `frontend/eas.json`:
```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "staging": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://artisan-api.onrender.com"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://api.artisan.ci"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Build Commands
```powershell
cd C:\klawd-data\projects\servicio-app\frontend

# Staging (internal distribution)
npx eas-cli build --platform android --profile staging
npx eas-cli build --platform ios --profile staging

# Production
npx eas-cli build --platform all --profile production
```

### Push Notifications Setup
1. **Android (FCM)**: Upload `google-services.json` to EAS secrets
2. **iOS (APNs)**: Upload push notification key (.p8) to EAS
3. Set `EXPO_PUBLIC_EXPO_PROJECT_ID` in frontend `.env`
4. Backend already handles token registration via `/api/notifications/register-token`

### OTA Updates (Expo Updates)
```powershell
# Push JS update without rebuilding native
npx eas-cli update --branch staging --message "Bug fix v1.0.1"
```

---

## 4. PaiementPro Integration (Production)

### Setup
1. Register merchant account at https://www.paiementpro.net
2. Get merchant credentials from PaiementPro dashboard
3. Configure webhook URL: `https://api.artisan.ci/api/payments/webhook`
4. Set `PAIEMENTPRO_MERCHANT_ID` and `PAIEMENTPRO_WEBHOOK_SECRET` in Render env vars
5. Set `PAYMENT_PROVIDER=paiementpro` in Render env vars

### Test in Staging
- Keep `PAYMENT_PROVIDER=mock` in staging
- Mock adapter returns deterministic success/failure
- Test E2E flow without real money

### Webhook Security
- PaiementPro sends `hashcode` as HMAC-SHA256(merchantId + referenceNumber + amount)
- Signature source is payload field `hashcode`
- Backend verifies before processing

---

## 5. CI/CD

### GitHub Actions
- **On push/PR to main**: Backend pytest + Frontend lint
- **Manual dispatch**: Staging deploy (Render API + EAS build)

### Required GitHub Secrets

| Secret | Where to get |
|--------|-------------|
| `RENDER_API_KEY` | Render Dashboard -> Account -> API Keys |
| `RENDER_SERVICE_ID` | Render Dashboard -> Service -> Settings |
| `EXPO_TOKEN` | expo.dev -> Account -> Access Tokens |

---

## 6. DNS & Custom Domain (Production)

1. Register `artisan.ci` domain
2. Render: Add custom domain `api.artisan.ci` -> auto-SSL
3. Frontend: Configure deep links with `artisan://` scheme (already in app.json)

---

## 7. Staging Checklist

- [ ] MongoDB Atlas cluster created (M0 free)
- [ ] Render web service created
- [ ] All env vars set in Render
- [ ] `ALLOWED_ORIGINS` set to staging frontend URL
- [ ] `PAYMENT_PROVIDER=mock`
- [ ] Health check returns 200
- [ ] Health/db returns "connected"
- [ ] Register user via API works
- [ ] E2E flow works (request -> accept -> complete -> confirm)
- [ ] Frontend `.env` points to staging backend
- [ ] EAS staging build succeeds
- [ ] Push token registration works (device)

---

## 8. Production Checklist

- [ ] MongoDB Atlas upgraded (M10+, backup enabled)
- [ ] `ENVIRONMENT=production`
- [ ] `JWT_SECRET` is 64+ char random string
- [ ] `ALLOWED_ORIGINS` = production domain only
- [ ] `PAYMENT_PROVIDER=paiementpro`
- [ ] PaiementPro credentials set and webhook configured
- [ ] FCM/APNs credentials uploaded to EAS
- [ ] HTTPS enforced everywhere
- [ ] Rate limiting active (60 req/min per IP)
- [ ] Monitoring configured (Render metrics + Atlas alerts)
- [ ] Legacy bookings migration applied (`--apply`)
- [ ] First admin user created with `super_admin` role


