# ARTISAN -- Operations Runbook

## Quick Reference

| Action | Command |
|--------|---------|
| Start backend (local) | `.\.venv\Scripts\python.exe backend\server.py` |
| Start frontend (local) | `cd frontend && npm start` |
| Run tests | `.\.venv\Scripts\python.exe -m pytest tests/ -q` |
| Check health | `Invoke-RestMethod https://<host>/api/health` |
| Check DB | `Invoke-RestMethod https://<host>/api/health/db` |
| Check version | `Invoke-RestMethod https://<host>/api/health/version` |

---

## 1. Incident Response

### Backend Not Responding

1. Check health endpoint: `GET /api/health`
2. If 503 on `/api/health/db` -> MongoDB is down or unreachable
   - Atlas: Check cluster status at https://cloud.mongodb.com
   - Local: `mongosh --eval "db.adminCommand('ping')"` or restart MongoDB service
3. Check Render logs: Dashboard -> Service -> Logs
4. Restart service: Render Dashboard -> Manual Deploy

### Database Connection Timeout

1. Verify `MONGO_URL` env var is correct
2. Check Atlas network access (IP whitelist)
3. Check Atlas cluster status (maintenance window?)
4. Temporary fix: Restart backend service

### Payment Webhook Not Processing

1. Check `/api/health` is up
2. Verify `PAIEMENTPRO_WEBHOOK_SECRET` matches PaiementPro dashboard
3. Check payment_events collection for raw webhook data:
   ```javascript
   db.payment_events.find({event_type: "webhook_received"}).sort({created_at: -1}).limit(5)
   ```
4. Verify webhook URL in PaiementPro dashboard matches production URL
5. Check Render logs for signature verification errors

### Push Notifications Not Delivered

1. Verify user has `push_token` in DB:
   ```javascript
   db.users.findOne({email: "user@example.com"}, {push_token: 1})
   ```
2. Check Expo Push receipt: https://exp.host/--/api/v2/push/getReceipts
3. Verify `notification_preferences.push_enabled` is not false
4. Check quiet hours settings
5. Verify FCM/APNs credentials in EAS

---

## 2. Logs

### Structured Log Format
Backend uses Python logging with correlation IDs:
```
2026-02-06 14:30:00 - server - INFO - [cid:abc123] Request processed
```

### Key Log Locations
- **Render**: Dashboard -> Service -> Logs (real-time streaming)
- **Local**: stdout (terminal where server.py runs)
- **MongoDB audit_log**: Admin actions with actor, resource, timestamp

### Useful Log Queries (Render)
- Errors: Filter by `ERROR` level
- Payment issues: Search for `payment` or `webhook`
- Auth failures: Search for `401` or `Invalid token`

---

## 3. Rollback Procedures

### Backend Rollback (Render)
1. Go to Render Dashboard -> Service -> Deploys
2. Find last known good deploy
3. Click "Redeploy" on that commit
4. Verify health check passes

### Database Rollback
MongoDB Atlas daily backup:
1. Atlas Dashboard -> Cluster -> Backup
2. Choose restore point (before incident)
3. Restore to new cluster (never overwrite prod directly)
4. Update `MONGO_URL` to point to restored cluster
5. Verify data integrity
6. Switch DNS or env var back

### Frontend Rollback (EAS Updates)
```powershell
# List published updates
npx eas-cli update:list --branch production

# Republish a previous update
npx eas-cli update:republish --group <update-group-id>
```

---

## 4. Database Operations

### TTL Index Reindex
If TTL indexes are not cleaning up old data:
```javascript
// Check existing TTL indexes
db.notifications.getIndexes()
db.audit_log.getIndexes()

// Force reindex (will briefly lock collection)
db.notifications.reIndex()
db.audit_log.reIndex()
```

### Manual Notification Cleanup
```javascript
// Delete notifications older than 90 days manually
db.notifications.deleteMany({
  created_at: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
})
```

### Payment Intent Investigation
```javascript
// Find stuck payment intents
db.payment_intents.find({
  status: "initiated",
  created_at: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
})

// View payment events for a specific intent
db.payment_events.find({ payment_intent_id: "<id>" }).sort({ created_at: 1 })
```

### Index Maintenance
```javascript
// Check index usage stats
db.service_requests.aggregate([{ $indexStats: {} }])
db.users.aggregate([{ $indexStats: {} }])
```

---

## 5. Migration Operations

### Legacy Bookings Migration

**Dry run** (no writes):
```powershell
cd C:\klawd-data\projects\servicio-app
.\.venv\Scripts\python.exe backend\scripts\migrate_bookings_to_service_requests.py --dry-run
```

**Apply** (with limit for safety):
```powershell
.\.venv\Scripts\python.exe backend\scripts\migrate_bookings_to_service_requests.py --apply --limit 100
```

**Full apply**:
```powershell
.\.venv\Scripts\python.exe backend\scripts\migrate_bookings_to_service_requests.py --apply
```

**Report**: Check `migration_report.json` in project root after each run.

**Rollback**: If migration created bad data:
```javascript
// Remove all migrated service_requests (they have legacy_booking_id)
db.service_requests.deleteMany({ legacy_booking_id: { $exists: true } })

// Remove migration markers from bookings
db.bookings.updateMany(
  { migrated_to_service_request_id: { $exists: true } },
  { $unset: { migrated_to_service_request_id: "", migrated_at: "" } }
)
```

---

## 6. Scaling

### When to Scale

| Signal | Action |
|--------|--------|
| API response time > 2s | Scale Render to Standard plan |
| MongoDB connections > 80% | Upgrade Atlas tier |
| Push delivery delay > 30s | Check Expo status page |
| Payment webhook timeouts | Check Render instance health |

### Render Scaling
- Staging: Free tier (512MB RAM, 0.1 CPU)
- Production: Starter ($7/mo, 512MB RAM, 0.5 CPU)
- Growth: Standard ($25/mo, 2GB RAM, 1 CPU)

### MongoDB Atlas Scaling
- Staging: M0 (free, 512MB storage)
- Production: M10 ($57/mo, 10GB, dedicated)
- Growth: M20 ($140/mo, 32GB, auto-scaling)

---

## 7. Security Checklist (Monthly)

- [ ] Rotate JWT_SECRET (update env var, redeploy)
- [ ] Review Atlas access list (remove unused IPs)
- [ ] Check audit_log for suspicious admin actions
- [ ] Verify CORS origins match expected domains
- [ ] Review rate limit logs for abuse patterns
- [ ] Check payment_intents for anomalies (stuck, duplicate)
- [ ] Update dependencies (`pip install --upgrade`, `yarn upgrade`)

---

## 8. Monitoring Setup

### Render
- Enable health check: `/api/health` every 30s
- Alert on: service down, deploy failure
- Metrics: CPU, memory, response time

### MongoDB Atlas
- Enable alerts: connections > 80%, storage > 80%, slow queries > 100ms
- Enable Performance Advisor for index recommendations

### Uptime Monitoring (External)
Recommended: UptimeRobot (free) or Better Uptime
- Monitor: `GET /api/health` every 5 minutes
- Monitor: `GET /api/health/db` every 15 minutes
- Alert via: email + Telegram

