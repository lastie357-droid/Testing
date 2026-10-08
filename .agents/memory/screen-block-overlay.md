---
name: Block-screen overlay contract
description: Preserve the existing remote command names while showing an accessible, touch-through update indicator.
---

Keep the existing `block_screen`, `unblock_screen`, and `screen_blackout_on/off` command identifiers unchanged. The on-device block-screen UI should show a spinner with “Updating… Please wait”, but it must not consume touches, block navigation, or expose the loader as an accessibility target that prevents screen-reader access to the underlying app.

**Why:** the user explicitly asked for the loader behavior without renaming the command, blocking touch input, or preventing the screen reader.

**How to apply:** retain existing task/dashboard command IDs and handler mappings; use a non-touchable, non-focusable overlay, exclude its descendants from accessibility, and do not add a touch-absorbing navigation guard or force display brightness to zero.
