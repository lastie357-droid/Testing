---
name: Realtime screen relay
description: Latency constraints and transport decisions for accessibility-tree streaming.
---

The Screen Reader dashboard tab uses command polling rather than a device-push stream. The dashboard owns the selected interval and repeats a plain `screen_reader_stream_start` request; the server forwards no interval parameter, and Android returns the same `{ success, screen }` response shape as `read_screen`.

**Why:** The operator requested a simple request/response path with no compression, encoding, decoding, or background device loop. It also guarantees the phone layout is driven by the command result itself.

**How to apply:** Keep the interval controls in the dashboard only. Do not add `intervalMs` to the Android command payload or use `screen:update` for this tab.

The separate ScreenReaderRecorder and other capture features may still use their existing `screen:update` relay; that is not the transport for the Screen Reader command-polling tab.