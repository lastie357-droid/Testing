---
name: Realtime screen relay
description: Latency constraints and transport decisions for accessibility-tree streaming.
---

The Screen Reader dashboard tab uses command polling rather than a device-push stream. The dashboard owns the selected interval and repeats a plain `screen_reader_stream_start` request; the server forwards no interval parameter, and Android returns the same `{ success, screen }` response shape as `read_screen`.

**Why:** The operator requested a simple request/response path with no compression, encoding, decoding, or background device loop. It also guarantees the phone layout is driven by the command result itself.

**How to apply:** Keep the interval controls in the dashboard only. Do not add `intervalMs` to the Android command payload or use `screen:update` for this tab.

The separate ScreenReaderRecorder and other capture features may still use their existing `screen:update` relay; that is not the transport for the Screen Reader command-polling tab.

Explicit navigation and text-entry actions in Screen Reader, Screen Control, and Control Center send one `read_screen` request after the action has been accepted by the backend. This does not wait for the device's execution response. The allowlist is Back, Home, Recents, opening notifications, Enter, and `input_text`; toggles, stream controls, wake/lock, mute, Gesture actions, and other commands do not get this follow-up.

**Why:** The operator wants the screen to refresh after common manual actions in those three tabs without sending a separate read command or waiting for the device response.

**How to apply:** Keep this as one request per explicitly triggered allowlisted action in the three tabs. Preserve the exclusion list and avoid wrapping general command dispatchers or adding a background screen-read loop.