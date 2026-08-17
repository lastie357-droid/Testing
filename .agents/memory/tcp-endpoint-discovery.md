---
name: TCP endpoint discovery
description: Runtime discovery and caching rules for the Android TCP forwarding route.
---

The Android client must treat the public TCP host and port as runtime data. It bootstraps from the plain-text endpoint service, caches the validated host/port in private app preferences, and reuses that value across all socket channels.

**Why:** Zeabur TCP forwarding ports can change or become unavailable while the APK remains installed; baking a forwarding address into each build makes those devices unrecoverable until a new APK is distributed.

**How to apply:** Keep discovery serialized and cache-first. Invalidate the cached route only when opening the TCP connection or completing TLS setup fails; ordinary post-handshake disconnects should use the normal reconnect path before forcing discovery.