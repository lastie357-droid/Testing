# RemoteAccess — APK Build & Dashboard

## What this is
Backend (Node/Express) + React/Vite dashboard + Android client. Backend runs on port 5000 (HTTP/SSE) and 6000 (TCP for devices). MongoDB for persistence, Redis optional.

## Workflows
- **Backend Server**: `cd backend && npm install --prefer-offline && npm run build && node server.js` — listens on 0.0.0.0:5000.
- **APK Build**: `cd Apk-builder && BUILD_URL="${BUILD_URL:-http://localhost:5000}" BUILD_API_KEY="${BUILD_API_KEY:-${BUILD_API:-$BUILD_WORKER_API}}" bash build.sh --worker` — polls `/api/build/worker/poll`. Worker scripts live in `Apk-builder/`, NOT project root.

## Captcha
Disabled. `backend/utils/captcha.js → verifyCaptcha()` short-circuits to `return true`. The `<Captcha>` component was removed from `Login.jsx`, `UserLogin.jsx` (signin + register tabs), and `UserRegister.jsx`.

## Build start guards (front-end)
`react-dashboard/src/components/BuildApkTab.jsx` uses `submitting` state + optimistic `setRunning(true)` on click. The "Build APK" button is disabled when `running || submitting || !accessId`, label flips to "Starting…" / "Building…". Server-side `POST /api/build/apk` already returns 409 on duplicate per accessId, so the user cannot stop/restart an in-flight job.

## Key code paths
- `backend/server.js` — main API, SSE, device TCP server.
- `backend/models/User.js` — user model with trial + paid subscription fields.
- `backend/routes/userAuth.js` — user signup/login/me.
- `backend/middleware/auth.js` — admin/user JWT middleware (server.js also defines `requireAdmin`, `requireUserOrAdmin`, `requireActiveSubscription`).
- `react-dashboard/src/components/UserDashboard.jsx` — user view; renders `<PaywallOverlay>` when locked.
- `react-dashboard/src/components/PaywallOverlay.jsx` — "Buy us a coffee" lock UI.
- `react-dashboard/src/components/SettingsTab.jsx` — admin sees the NOWPayments webhook URL + IPN secret config.
- `react-dashboard/src/hooks/useTcpStream.js` — falls back to `user_token` if no `admin_token`; surfaces 402 from `/api/commands` as a `subscription:locked` event.

## Trial + paid subscription
- Every user gets a 7-day free trial set in the User pre-save hook (`trialEndDate`).
- After expiry, `POST /api/commands` returns **402 Payment Required** with a `paywall` payload; the dashboard renders the lock screen instead of `<DeviceControl>`.
- Payment unlocks 30 days at a time via `paidUntil`. `User.isTrialActive()` returns true if either `paidUntil` or `trialEndDate` is in the future.

## Payment endpoints
- `GET  /api/payment/me` — current sub status + personalised payment URL (auth: user or admin).
- `POST /api/payment/webhook/nowpayments` — IPN endpoint. Verifies `x-nowpayments-sig` as `HMAC-SHA512(JSON-with-recursively-sorted-keys, ipnSecret)`. On `finished`/`confirmed`/`partially_paid`, locates the user by `order_id` (= our Mongo `_id`) or by `customer_email`, then extends `paidUntil` by 30 days. Idempotent on `payment_id`.
- `GET  /api/admin/payment` — returns webhook URL + secret status (admin).
- `POST /api/admin/payment` — set IPN secret / payment URL / price / duration (admin).
- `POST /api/admin/users/:id/grant-month` — admin manually credits N days (default 30).
- `POST /api/admin/users/:id/revoke-paid` — admin clears paid window.

## NOWPayments setup (admin)
1. Open the dashboard → **Settings → NOWPayments Webhook** card.
2. Copy the **Webhook URL** shown there.
3. In NOWPayments → Account → Store Settings, paste the URL into **IPN Callback URL**.
4. Copy the **IPN Secret** from the same NOWPayments page back into the dashboard and Save.
5. The default payment link (`iid=5745424570&paymentId=4699655886`) is pre-filled and editable. The dashboard appends `order_id=<userId>` and `customer_email=<email>` so the webhook can attribute payments.

Optional env vars (used at boot, overridable at runtime via the admin UI):
- `NOWPAYMENTS_IPN_SECRET`
- `NOWPAYMENTS_PAYMENT_URL`
- `NOWPAYMENTS_PRICE_USD` (default 25)
- `NOWPAYMENTS_EXTEND_DAYS` (default 30)

## Auth model recap
- Admin: hex tokens in `global._adminTokens` (24h TTL).
- User: JWT (`getJwtSecret()` from `backend/jwtSecret.js`), stored in localStorage as `user_token`.
- `requireUserOrAdmin` accepts either; `requireActiveSubscription` then enforces the trial/paid gate (admins always pass).

## Build pipeline note
`build.sh` was previously SIGPIPE-killed by `python3 - <<PYEOF` in `send_logs`. Fixed by writing the helper to a file and exec'ing `python3 -u <file>`. Build is now stable end-to-end (~60s for both APKs).

## Running the build worker on commercial PaaS hosts (Heroku/Zeabur/Render/Fly/Railway)
The backend in `backend/server.js` and the worker repo `lastie357-droid/Apk-builder` (cloned to `Apk-builder/` here for reference) are both fully portable — there is no Replit-specific lock-in. To wire them together on any commercial host:

1. Deploy the backend. Set env vars:
   - `MONGODB_URL` (or whatever you used)
   - **`BUILD_WORKER_API_KEY`** = a long random string (this is the persistent source of truth; the in-dashboard "Settings → Build worker key" field is in-memory only and is wiped on every restart).
   - Anything else (NOWPayments, etc.) you actually use.
2. Deploy the worker (`Apk-builder` repo) on its own host. Set env vars:
   - `BUILD_URL` = `https://<your-backend-domain>`  (no trailing slash, no path)
   - `BUILD_API_KEY` = the **same** random string you put in `BUILD_WORKER_API_KEY`.
3. Verify by hitting the public health endpoint from anywhere:
   ```
   curl -s https://<your-backend-domain>/api/build/worker/health | jq
   ```
   Expected: `apiKeyConfigured: true`, `apiKeyLength: <N>`, and once the worker has polled at least once, `workerOnline: true`.

### Diagnostics added for commercial deployments
- **Startup banner** (every backend boot): `[BUILD] Worker API key: configured (length=N)` or `NOT configured` with instructions.
- **Public no-auth endpoint** `GET /api/build/worker/health` returns `{ok, backendReachable, publicUrl, apiKeyConfigured, apiKeyLength, workerOnline, workerLastSeenAgoMs, pendingJobs, activeJob}`. Safe to expose — contains no secret material.
- **Failure logging in `requireBuildWorker`**: every failed worker auth attempt logs the reason — `API key not configured`, `worker sent no Authorization header`, or `key mismatch — worker sent length=X, backend expects length=Y` — with caller IP/UA, rate-limited to one log line per 5 s. This is what you read on Heroku/Zeabur to diagnose why the worker shows offline.
- **Whitespace-tolerant key load**: the env-var-loaded `BUILD_WORKER_API_KEY` is `.trim()`-ed at startup, and incoming worker tokens are trimmed too. Copy-paste artefacts (trailing newline in PaaS dashboard) no longer cause silent mismatches.

### Triage matrix when "worker offline" on a commercial host
| `health` says | Backend log says | Action |
|---|---|---|
| `apiKeyConfigured: false` | `API key NOT configured` at boot | Set `BUILD_WORKER_API_KEY` env var on the **backend** and redeploy. |
| `apiKeyConfigured: true`, `workerOnline: false`, log shows `key mismatch` | `worker sent length=X, backend expects length=Y` | Lengths differ → re-paste. Lengths same → check whitespace, or that the worker has the right `BUILD_API_KEY`. |
| `apiKeyConfigured: true`, `workerOnline: false`, log empty | No `Worker auth FAILED` lines | Worker isn't reaching the backend. Check the **worker's** logs and verify `BUILD_URL` resolves and is the right scheme/host. |
| `curl` returns HTML or 404 | n/a | `BUILD_URL` on the worker is wrong. |
