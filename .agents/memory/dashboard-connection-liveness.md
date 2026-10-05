---
name: Dashboard SSE liveness
description: Keep the browser dashboard status aligned with its live server event stream.
---

## Rule
- Dashboard SSE health must be observable to the browser: SSE comment keepalives do not trigger `EventSource.onmessage`, so send a data heartbeat and reconnect when the stream goes silent.
- Remove SSE clients when the response closes.

**Why:** Half-open event streams can remain green after the browser has stopped receiving server events.

**How to apply:** Preserve the visible heartbeat, silence watchdog, bounded reconnect, and response-close cleanup when changing dashboard SSE handling.