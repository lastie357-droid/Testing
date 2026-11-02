---
name: Storage permission toggle
description: Project rule for Android All Files Access automation.
---

The explicit storage-permission request may enable only this app-specific All Files Access switch. It must not press Allow/Grant/OK text controls or send Back; leave Android Settings open.

**Why:** The user reported the Settings screen closing immediately and explicitly required switch-only interactions without pressing “Allow” text.

**How to apply:** Scope scanning to the Settings or permission-controller screen and this app's label; target only the labeled All Files Access switch, and leave controls untouched when the screen cannot be identified safely.
