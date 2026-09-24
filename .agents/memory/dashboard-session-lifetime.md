---
name: Dashboard session lifetime
description: Authentication and SSE rules that keep the dashboard from silently freezing.
---

Keep the JWT signing key stable for at least the full token lifetime, and validate browser sessions before opening or endlessly retrying an SSE stream. When validation fails, clear the stale token and return the user to login instead of leaving a frozen dashboard.

**Why:** A daily signing-key rotation invalidated 7-day user tokens at midnight, while EventSource did not expose HTTP 401 details and the dashboard could remain in a silent reconnect loop.

**How to apply:** If token expiry or rotation changes, update the session validation path and the browser's reconnect behavior together. Keep the lightweight session check independent of MongoDB so a database outage does not masquerade as an authentication failure.