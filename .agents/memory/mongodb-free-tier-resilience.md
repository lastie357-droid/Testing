---
name: MongoDB free-tier resilience
description: Connection and outage-handling constraints for the hosted MongoDB cluster.
---

Keep the backend's MongoDB pool deliberately below the provider's connection ceiling on every replica-set member, and do not buffer application work while MongoDB is unavailable. Use bounded wait, selection, socket, and query timeouts so the server remains responsive and its non-Mongo fallbacks can operate.

**Why:** The project uses a free-tier three-node cluster with a 100-connection ceiling; unbounded pools and buffered writes can exhaust the cluster or make the Node process appear hung during a transient outage.

**How to apply:** Preserve a single serialized connection manager, latest-request coalescing, exponential reconnect backoff, and bounded pool/query settings when adding MongoDB-backed features. Throttle high-frequency device heartbeat persistence rather than writing on every heartbeat.