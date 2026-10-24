---
name: Task Studio text matching
description: User decisions for selecting dynamic text labels in the Task Studio watcher.
---

For each watched phrase, prefer an exact case-insensitive label over longer labels that contain the phrase. When more than one exact label is visible, tap every exact match. Do not hardcode examples of suffixes or screen coordinates; let users add configurable avoid phrases.

**Why:** Carrier labels and their suffixes can change between screens. The user explicitly chose to click every exact match and avoid relying on fixed names or positions.

**How to apply:** Keep Task Studio matching driven by the current Screen Reader response. Preserve exact-label preference, all-exact-matches behavior, and user-configured exclusions when changing the watcher.
