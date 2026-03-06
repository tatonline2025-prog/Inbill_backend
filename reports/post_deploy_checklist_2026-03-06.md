# Inbill Backend - Post-Deploy Checklist (Quick Verify)

Date: 2026-03-06  
Target: Production quick verification after deploy

## 1) Pre-check

- Confirm deployment target URL:
  - Example: `https://api.dvtienich.vn`
- Confirm env vars exist on server:
  - `MONGO_URI`
  - `JWT_SECRET`
  - optional: `APP_VERSION`, `NODE_ENV`
- Run local quality gate before deploy:
  - `npm run check:all`
  - optional auto-repair mojibake in source comments/messages: `npm run fix:mojibake`

## 2) Health check (must pass first)

### PowerShell
```powershell
$BASE_URL="https://api.dvtienich.vn"
Invoke-RestMethod -Method GET "$BASE_URL/health" | ConvertTo-Json -Depth 5
```

### Expected
- HTTP: `200`
- `status`: `ok`
- `db.state`: `connected`
- `uptimeSeconds`: number > 0

If `/health` returns `503`:
- Check DB connectivity (`MONGO_URI`, network, firewall)
- Check app logs for startup errors

## 3) Auth smoke tests

### Login (replace credentials)
```powershell
$BASE_URL="https://api.dvtienich.vn"
$body = @{ userName="admin"; password="***" } | ConvertTo-Json
$login = Invoke-RestMethod -Method POST "$BASE_URL/api/auth/login" -ContentType "application/json" -Body $body
$token = $login.token
$token
```

### Me endpoint
```powershell
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method GET "$BASE_URL/api/auth/me" -Headers $headers | ConvertTo-Json -Depth 5
```

### Expected
- Login HTTP: `200`, token not empty
- `/api/auth/me` HTTP: `200`

## 4) Authorization checks (security regression)

Use a non-admin token (user role) and verify forbidden endpoints.

```powershell
# Example endpoint must be blocked for non-admin
Invoke-WebRequest -Method GET "$BASE_URL/api/user/fetchall" -Headers @{ Authorization = "Bearer $userToken" } -SkipHttpErrorCheck
```

### Expected
- HTTP: `403` for:
  - `/api/user/fetchall`
  - `/api/user/:userId/update-fee`
  - `/api/transaction/admin/export`
  - `/api/v1/finance/optimal-sum`
  - invoice export admin endpoints

## 5) Critical route sanity

With admin token:
- `GET /api/user/fetchall` -> `200`
- `GET /api/transaction/admin` -> `200`
- `GET /api/transaction/admin/export` -> file stream (`200`)
- `GET /api/invoices/exportExcelCollected?...` -> file stream (`200`)  

## 6) Data integrity quick checks

- Create one safe transaction in staging-like flow, then:
  - verify list endpoint returns it
  - verify export endpoint includes it
- Create one invoice via controlled endpoint and ensure:
  - appears in fetch endpoint
  - no unexpected duplicate conflict logic regressions

## 7) Operational checks

- Logs:
  - no startup crash/restart loops
  - no unhandled exceptions on key routes
- Resources:
  - CPU/memory stable during first 5-10 minutes
- CORS:
  - frontend domains can call API successfully

## 8) Rollback trigger conditions

Rollback immediately if any:
- `/health` not stable at `200`
- Auth flow broken (`/login`, `/me`)
- Admin critical flows fail (user list/export/transaction admin)
- Error rate or latency spikes significantly after deploy

## 9) Command summary (one-shot)

```powershell
$BASE_URL="https://api.dvtienich.vn"
Invoke-WebRequest "$BASE_URL/health" -SkipHttpErrorCheck
```

If this fails, stop and inspect logs before deeper tests.

## 10) Encoding guard (anti-mojibake)

```powershell
npm run scan:encoding
```

Expected:
- Exit code `0`
- Output: `Encoding scan passed: no UTF-8/mojibake issue detected.`
