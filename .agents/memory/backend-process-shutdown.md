---
name: Backend process shutdown
description: Safe listener ownership and storage teardown for backend restarts.
---

On startup, treat `EADDRINUSE` as a fatal lifecycle/configuration error: report the port and exit rather than killing its owner or retrying indefinitely. On SIGINT/SIGTERM, stop accepting HTTP/TCP traffic, close active streams, and drain bounded in-flight work before disconnecting Redis and MongoDB. Prevent reconnect timers and periodic persistence jobs from running after shutdown begins.

**Why:** A stale backend can retain ports while a replacement loops on bind failures; closing storage first lets active device traffic write against closed Redis clients or MongoDB pools.

**How to apply:** Keep each service port single-owner. After changing backend lifecycle behavior, restart the configured workflow once and verify one backend process, storage connections, and an HTTP health response.
