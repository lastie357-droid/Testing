---
name: Redis connection resilience
description: Reliability rules for the hosted Redis service used by the backend.
---

The backend's Redis connection must remain warm with a lightweight periodic PING, retry indefinitely with bounded exponential backoff, and preserve existing keys across application restarts. Redis availability is an enhancement over the in-memory fallback, so reconnect failures must not block server startup.

**Why:** The hosted Redis plan can suspend after several hours without traffic, and startup-wide FLUSHALL would erase device, activity, notification, and command state whenever the backend restarts.

**How to apply:** Keep the keepalive interval shorter than the provider's idle window, use bounded connection and request timeouts, leave reconnect attempts enabled, and clear only narrowly scoped cache keys when an explicit cleanup action requires it.