---
name: Immediate Task Studio paste
description: Expected timing and field targeting behavior for Task Studio paste actions
---

Task Studio's `paste_text` action should send text directly to the input field in the active window when the step runs. Do not add repeated `get_input_fields` scans or a multi-second wait before dispatching `input_text`. After dispatch, verify the full text is visible in the accessibility tree; repeat the paste-and-check cycle until it is visible or the task is paused/replaced.

**Why:** The field-scan loop made a paste step take several seconds even when the user had already switched windows or focused an input. The user also reported that pasting can happen before the destination field is ready and requested confirmation with retries before proceeding.

**How to apply:** Preserve immediate dispatch and current active-window focus. Use post-paste text visibility as the readiness check; do not delay the first paste while scanning unrelated editable fields elsewhere in the accessibility tree.
