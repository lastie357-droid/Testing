---
name: SSE streaming
description: Low-latency delivery requirements for dashboard server-sent events.
---

Dashboard SSE endpoints should bypass HTTP compression. Gzip middleware can buffer event frames and leave clients with an open HTTP 200 response but no initial device snapshot.

**Why:** the initial SSE list must arrive immediately for dashboard counts to reflect the backend snapshot; flushing through compression did not reliably release the first event.

**How to apply:** when changing compression middleware or adding streaming endpoints, exclude SSE routes from compression and test the initial event with a client that advertises gzip.
