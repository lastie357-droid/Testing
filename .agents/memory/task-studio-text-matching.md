---
name: Task Studio text matching
description: User decisions for selecting dynamic text labels in the Task Studio watcher.
---

For each watched phrase, prefer an exact case-insensitive label over longer labels that contain the phrase. When more than one exact label is visible, tap every exact match. Do not hardcode examples of suffixes or screen coordinates; let users add configurable avoid phrases.

For a task-run Click Text step, scope matches to the nearest preceding enabled Open App package. Click up to three matches from the bottom upward, stopping the old match list when the accessibility frame changes and then advancing to the next step. If no match appears within eight seconds, restart the whole task from step one up to three times. Keyguard lock takes priority; unlocking restarts the task and resets Click Text retry counts.

**Why:** Carrier labels and their suffixes can change between screens. The user explicitly chose to click every exact match and avoid relying on fixed names or positions; they later specified bottom-up task clicks, app scoping, frame-change handling, timeout retries, and keyguard reset behavior.

**How to apply:** Keep watcher matching driven by the current Screen Reader response. For task runs, use the preceding Open App package, bottom-up clicks, a three-retry cap, and keyguard reset precedence.
