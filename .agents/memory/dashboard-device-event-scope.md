---
name: Selected-device event isolation
description: SSE and browser state rules when a dashboard is showing one device or the global inventory.
---

When no device is selected, deliver device inventory and health status but do not relay device-scoped activity, chunks, or media frames to that dashboard. When a device is selected, deliver its device-scoped events only; keep inventory/status visible for every device. Load bulk history after selecting its device, key chunk assemblies by both device ID and command ID, and stop selected-panel streams when that panel unmounts.

**Why:** Broadcasting all devices' chunks and frames to every dashboard increases browser work and can mix large data streams while switching devices. Device selection is per SSE client, so a dashboard must not stop work for other viewers.

**How to apply:** Keep server fanout, browser event guards, selected-device history loading, and component cleanup in sync. Preserve user ownership checks and never cancel an already-issued remote task just because a dashboard changed selection.
