---
name: Task keyguard recovery
description: Task Studio's run behavior when Android keyguard locks and releases.
---

When keyguard locks during a Task Studio run, pause execution; after keyguard release, restart the entire enabled task from step one rather than resuming the interrupted step. Previously completed actions may run again. Also reset any Click Text timeout retry counts on unlock.

**Why:** The user explicitly requested a full restart when the device is locked and again when keyguard is released, with Click Text retry counters reset by that restart.

**How to apply:** Keep the task pending while locked, clear progress and Click Text retry counters on unlock, then rerun from the first enabled step.
