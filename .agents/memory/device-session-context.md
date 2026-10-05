---
name: Device session context
description: Device tools must keep the selected device ID and dashboard auth role together across commands, requests, and session resets.
---

Keep each device panel bound to the exact device ID and the explicit dashboard role that opened it. Do not infer admin mode or choose a token by checking whichever local-storage token happens to exist first. Device-specific resets and cached-result cleanup must not affect other devices.

**Why:** Switching devices must not let late callbacks, stale admin credentials, or broad cache clearing cross into another device's session.

**How to apply:** Key the panel by device ID, pass the role's token storage key from the dashboard, force tool commands and device-scoped requests through that panel context, and authorize direct device endpoints against the selected device.
