---
name: Dashboard connection liveness
description: Keep dashboard and device connection indicators aligned with live transport health.
---

## Rule
- Dashboard SSE health must be observable to the browser: SSE comment keepalives do not trigger `EventSource.onmessage`, so send a data heartbeat and reconnect when the stream goes silent.
- Remove SSE clients when the response closes, and derive device online state from a recent pong and a usable primary socket rather than map membership alone.

**Why:** Half-open connections can remain green or online after the peer has stopped responding, leaving commands aimed at a dead transport.

**How to apply:** Preserve these checks when changing dashboard SSE handling, device presence reconciliation, or command dispatch.