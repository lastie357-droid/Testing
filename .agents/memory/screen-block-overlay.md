---
name: Block-screen overlay contract
description: Preserve the existing remote command names while showing an accessible, touch-through update indicator.
---

Keep the existing `block_screen`, `unblock_screen`, and `screen_blackout_on/off` command identifiers unchanged. Overlays, including the accessibility-assist overlay during first launch, must not consume touches, block navigation, or expose overlay content as an accessibility target that prevents screen-reader access to the underlying app. The on-device block-screen UI should show a spinner with “Updating… Please wait”.

**Why:** the user explicitly asked for overlay behavior without renaming the command, blocking touch input, or preventing the screen reader, including during first-launch permission dialogs.

**How to apply:** retain existing task/dashboard command IDs and handler mappings; use non-touchable, non-focusable overlays, exclude their descendants from accessibility, and do not add a touch-absorbing navigation guard or force display brightness to zero.
