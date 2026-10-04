---
name: Event-driven accessibility protection
description: Resource and crash-safety rules for accessibility monitoring and protection
---

Keep the accessibility service bound for Android event delivery, but keep expensive node traversal dormant unless a configured monitored app, lock/unlock surface, package-installer window, or supported security-center window is active. Coalesce relevant window events rather than polling the tree.

**Why:** Continuous accessibility-tree loops caused unnecessary work and contributed to crashes/ANRs while most foreground apps were unrelated.

**How to apply:** Clear unlock-only work on `ACTION_USER_PRESENT`/screen-off, run protection only from installer/security-center window events, and keep monitored-app logging/snapshots gated by the monitored package set. Activate protection immediately when the service binds; a single delayed retry is acceptable for missed/rendering-late pages, but never wait on unrelated dangerous runtime permissions or become a continuous scanner.

The accessibility service runs in the private `:accessibility` process. A null static service instance in the main process does not mean accessibility is disabled; heartbeat checks report liveness, but UI commands still need an IPC path into the service process.

**Why:** Java statics are process-local, so Task Studio commands received by the main-process socket manager cannot call the isolated service directly.

**How to apply:** Preserve process isolation for service stability, use the shared heartbeat to distinguish an active service, and relay accessibility actions into `:accessibility` rather than relying on the main-process singleton.