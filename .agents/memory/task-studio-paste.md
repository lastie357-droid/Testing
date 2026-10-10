---
name: Immediate Task Studio paste
description: Expected timing and field targeting behavior for Task Studio paste actions
---

Task Studio's `paste_text` action should send text directly to the input field in the active window when the step runs. Do not add repeated `get_input_fields` scans or a multi-second wait before dispatching `input_text`.

**Why:** The field-scan loop made a paste step take several seconds even when the user had already switched windows or focused an input.

**How to apply:** If paste behavior needs adjustment, preserve immediate dispatch and use the current active-window focus rather than waiting for an unrelated editable field elsewhere in the accessibility tree.
