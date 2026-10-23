---
name: SSE streaming
description: Low-latency delivery requirements for dashboard server-sent events.
---

Dashboard SSE endpoints should bypass HTTP compression. Gzip middleware can buffer event frames and leave clients with an open HTTP 200 response but no initial device snapshot.

**Why:** the initial SSE list must arrive immediately for dashboard counts to reflect the backend snapshot; flushing through compression did not reliably release the first event.

**How to apply:** when changing compression middleware or adding streaming endpoints, exclude SSE routes from compression and test the initial event with a client that advertises gzip.

SSE disconnect cleanup must be registered immediately after adding the client, before any awaited history replay.

**Why:** clients can close after the initial event but before replay finishes; attaching the response close handler afterward leaves stale sessions registered.

**How to apply:** bind an idempotent response-close handler before database/history awaits, and stop replay when that client is removed.
