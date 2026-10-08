---
name: Screen stream ownership
description: Preserve the separate Android TCP channels while keeping screen capture to one persistent stream.
---

Keep the primary/control, screen-frame, and live-event TCP channels separate. A dashboard screen-view session should send one `stream_start`; subsequent frames travel over the existing screen-frame channel and are forwarded to the dashboard. Only one screen-stream owner should be active per device panel, and leaving that view should stop its stream.

**Why:** the user chose “Keep 3 channels; enforce one screen stream” to reduce duplicate stream starts without merging the channel responsibilities.

**How to apply:** do not add per-frame `stream_start` polling or combine the three TCP channels. Keep Android stream starts idempotent, stop on explicit view exit, and preserve reconnect recovery while ensuring an explicit stop cancels auto-resume.
