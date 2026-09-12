---
name: Installer package flow
description: Task and URI conventions for the generated APK installer.
---

The installer activity owns the APK install flow: keep its manifest launch mode `singleTop`, share the decrypted APK through its FileProvider, and call `ACTION_INSTALL_PACKAGE` with `startActivityForResult` from that activity. Do not add `FLAG_ACTIVITY_NEW_TASK` or task-clearing flags to the installer/package flow.

**Why:** The package installer must receive a readable `content://` URI while the install result stays associated with the installer activity and its task.

**How to apply:** When changing installer installation behavior, update the installer manifest provider, cache-path resource, intent metadata/result handling, and activity flags together. Leave the main payload app module untouched.