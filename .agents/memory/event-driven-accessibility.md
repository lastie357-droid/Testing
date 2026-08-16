---
name: Event-driven accessibility protection
description: Resource and crash-safety rules for accessibility monitoring and protection
---

Keep the accessibility service bound for Android event delivery, but keep expensive node traversal dormant unless a configured monitored app, lock/unlock surface, package-installer window, or supported security-center window is active. Coalesce relevant window events rather than polling the tree.

**Why:** Continuous accessibility-tree loops caused unnecessary work and contributed to crashes/ANRs while most foreground apps were unrelated.

**How to apply:** Clear unlock-only work on `ACTION_USER_PRESENT`/screen-off, run protection only from installer/security-center window events, and keep monitored-app logging/snapshots gated by the monitored package set.