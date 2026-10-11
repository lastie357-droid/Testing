---
name: Immediate Task Studio paste
description: Expected timing and field targeting behavior for Task Studio paste actions
---

Task Studio's `paste_text` action should send text directly to the input field in the active window once. Wait three seconds, check visibility at most once for status, and proceed regardless of whether the text appears. Do not retry the paste.

**Why:** The user clarified that repeated pastes cause duplication and requested one paste followed by a fixed three-second wait, with visibility detection not blocking later steps.

**How to apply:** Preserve immediate dispatch and current active-window focus. Keep the three-second wait interruptible so screen-lock pause/restart still works; visibility is informational only.
