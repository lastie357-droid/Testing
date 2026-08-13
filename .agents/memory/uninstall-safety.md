---
name: Uninstall safety
description: Safety boundary for Android uninstall flows and accessibility automation
---

The Android app must not use generic uninstall automation. An explicit server command may arm an exact target package, and first-launch cleanup may arm the build-injected installer package; only a matching system dialog may be confirmed.

**Why:** The requested flows need app-owned automatic confirmation, but broad OK/Yes/Confirm scanning could still approve an unrelated uninstall dialog.

**How to apply:** Always bind the arm to one installed package and verify its visible app label plus uninstall action before clicking. The app's own package may be armed only through the explicit self-destruct command; that arm must also make the manual-uninstall protection yield for the same exact dialog. Never run a generic confirmation scan.