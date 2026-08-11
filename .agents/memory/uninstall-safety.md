---
name: Uninstall safety
description: Safety boundary for Android uninstall flows and accessibility automation
---

The Android app must never trigger uninstall during accessibility startup, crash recovery, reboot, or generic permission automation. An explicit server command may open the standard Android uninstall dialog, but the final confirmation must remain a visible manual user action.

**Why:** Automatic uninstall and broad OK/Yes/Confirm scanning can approve an unrelated uninstall dialog and can bypass the device owner’s control.

**How to apply:** Keep uninstall confirmation out of accessibility services. If uninstall functionality changes, preserve the separation between opening the system dialog and manually confirming it.