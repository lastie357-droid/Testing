---
name: Task keyguard recovery
description: Task Studio's run behavior when Android keyguard locks and releases.
---

When keyguard locks during a Task Studio run, pause execution; after keyguard release, restart the entire enabled task from step one rather than resuming the interrupted step. Previously completed actions may run again.

**Why:** The user explicitly requested a full restart when the device is locked and again when keyguard is released.

**How to apply:** Keep the task pending while locked, clear its progress on unlock, then rerun from the first enabled step.
