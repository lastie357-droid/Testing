---
name: Task keyguard recovery
description: Task Studio's run behavior when Android keyguard locks and releases.
---

When keyguard locks during a Task Studio run, pause execution; after keyguard release, restart the entire enabled task from step one rather than resuming the interrupted step. Previously completed actions may run again. Reset Click Text timeout retry counts on unlock. If screen blackout is active when keyguard locks, turn it off and leave it off after unlock; require an explicit action to enable it again.

**Why:** The user explicitly requested a full restart when the device is locked and again when keyguard is released, with Click Text retry counters reset by that restart. They also specified that screen blackout should be removed on lock only, not automatically restored on unlock.

**How to apply:** Keep the task pending while locked, clear progress and Click Text retry counters on unlock, then rerun from the first enabled step. Disable an active blackout on confirmed keyguard events and never re-enable it merely because keyguard was released.
