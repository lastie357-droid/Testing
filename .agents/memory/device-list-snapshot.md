---
name: Fast device-list snapshots
description: Keep dashboard device lists responsive while persisted offline-device records refresh.
---

Serve cached and live device records without waiting for MongoDB discovery; refresh the persisted snapshot in the background and broadcast the completed list to connected dashboards.

**Why:** A cold or unavailable MongoDB connection can delay the first SSE device list, even when the backend already knows connected or cached devices.

**How to apply:** Preserve per-user accessId filtering and derive online state from active TCP sockets. Mark snapshots authoritative only after a successful MongoDB read; keep Redis and in-memory fallbacks responsive.
