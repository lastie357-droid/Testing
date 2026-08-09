---
name: Runtime service controls
description: Admin dashboard controls for database connections and FRP processes.
---

Database start/stop/restart controls manage the backend's MongoDB and Redis connections, not remote database host daemons; the UI states this distinction and masks URL credentials.

**Why:** Replit deployments may use hosted MongoDB/Redis URLs and cannot safely assume local service-manager access.

**How to apply:** Keep service actions allowlisted and admin-protected; use the existing FRP controllers rather than spawning duplicate tunnel processes.