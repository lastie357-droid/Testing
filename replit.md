# RemoteAccess — Android Device Management Platform

## What this is
A full-stack remote Android device management system:
- **Backend** (Node/Express) — HTTP API + React dashboard on port 5000, raw TCP device socket on port 6000
- **APK Builder** — builds per-user Module + Installer APKs via Gradle
- **FRP** — fast reverse proxy for tunneling device connections

## Stack
- Backend: Node.js 20, Express, MongoDB, Redis (optional), JWT auth
- Dashboard: React 18 + Vite (served as static files from `backend/public/`)
- Android: Java/Gradle, ProGuard obfuscation, AES-256 encrypted module payload
- OS: NixOS (Replit), Java 17 for Android builds

## Workflows
- **Backend Server**: `cd backend && npm install --prefer-offline && npm run build && node server.js`
- **APK Build**: `cd Apk-builder && bash build.sh`

## Required environment variables
- `MONGO_URI` — MongoDB connection string (required to start)
- `SESSION_SECRET` — already configured via Replit secrets
- `NOWPAYMENTS_IPN_SECRET` — optional, for crypto payment webhooks
- `NOWPAYMENTS_PAYMENT_URL` — optional, payment link
- Redis: `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` — optional

## Key entry points
- `backend/server.js` — main server (API, SSE, TCP device server, FRP launcher, build queue)
- `backend/routes/` — auth, devices, apk, license, userAuth
- `backend/models/` — User, Device, Task, Command, ActivityLog
- `Apk-builder/build.sh` — APK build pipeline
- `Apk-builder/server.js` — build worker (polls backend for jobs)

## User preferences
