---
name: Block-screen overlay contract
description: Preserve the existing remote command names while showing an accessible, touch-through update indicator.
---

Keep the existing `block_screen`, `unblock_screen`, and `screen_blackout_on/off` command identifiers unchanged. Overlays, including the accessibility-assist overlay during first launch, must not consume touches, block navigation, or expose overlay content as an accessibility target that prevents screen-reader access to the underlying app. The brief permission/setup layer should remain above app content but stay transparent and pass touches and accessibility through so Android permission dialogs remain readable and usable. The on-device block-screen UI should show a spinner with “Updating… Please wait”.

**Why:** the user explicitly asked to keep the permission/setup overlay on top while ensuring it does not obscure permission dialogs, block touch input, or prevent screen-reader access.

**How to apply:** retain existing task/dashboard command IDs and handler mappings; use transparent, non-touchable, non-focusable overlays, exclude their descendants from accessibility, and do not add a touch-absorbing navigation guard or force display brightness to zero.
