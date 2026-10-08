---
name: Dashboard SSE liveness
description: Keep the browser dashboard status aligned with its live server event stream.
---

## Rule
- Dashboard SSE health must be observable to the browser: SSE comment keepalives do not trigger `EventSource.onmessage`, so send a data heartbeat and reconnect when the stream goes silent.
- Remove SSE clients when the response closes.
- Device presence is owned by the active primary TCP channel; a secondary channel heartbeat must not bring a device online.
- Publish offline state to memory and dashboards before attempting database persistence. Throttle routine presence updates and route per-device latency only to dashboards viewing that device.

**Why:** Half-open event streams can remain green after the browser has stopped receiving server events, and slow or unavailable persistence must not delay accurate device presence or make every dashboard process routine heartbeats.

**How to apply:** Preserve the visible heartbeat, silence watchdog, bounded reconnect, and response-close cleanup when changing dashboard SSE handling. Keep device online/offline changes independent from MongoDB/Redis latency, and fan out only the health data each dashboard needs.