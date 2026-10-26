---
name: Realtime screen relay
description: Latency constraints and transport decisions for accessibility-tree streaming.
---

The Screen Reader dashboard tab uses command polling rather than a device-push stream. The dashboard owns the selected interval and repeats a plain `screen_reader_stream_start` request; the server forwards no interval parameter, and Android returns the same `{ success, screen }` response shape as `read_screen`.

**Why:** The operator requested a simple request/response path with no compression, encoding, decoding, or background device loop. It also guarantees the phone layout is driven by the command result itself.

**How to apply:** Keep the interval controls in the dashboard only. Do not add `intervalMs` to the Android command payload or use `screen:update` for this tab.

The separate ScreenReaderRecorder and other capture features may still use their existing `screen:update` relay; that is not the transport for the Screen Reader command-polling tab.

Explicit navigation and text-entry actions in Screen Reader, Screen Control, and Control Center send one `read_screen` request after the action has been accepted by the backend. Manual phone-layout taps and swipes in Screen Reader and Screen Control also get one follow-up only when that tab's screen stream is inactive; an active stream already refreshes the screen. Automated guided settings actions keep their own scheduled reads and must not get a duplicate follow-up. These requests do not wait for the device's execution response.

**Why:** The operator wants the screen to refresh after common manual actions without sending a separate read command, while avoiding redundant reads during active streams or guided actions.

**How to apply:** Keep this as one request per explicitly triggered navigation/text action, and gate manual tap/swipe follow-ups on the local stream state. Preserve the exclusions for toggles, stream controls, wake/lock, mute, and Gesture actions; do not wrap general command dispatchers or add a background screen-read loop.