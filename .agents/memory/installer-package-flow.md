---
name: Installer package flow
description: Task and URI conventions for the generated APK installer.
---

The installer activity owns the APK install flow: use the default standard launch mode, handle APK install/view intents, and use a PackageInstaller session with `PACKAGE_SOURCE_STORE` on Android 13+ so the installer package is recorded as a store. A committed session can return `STATUS_PENDING_USER_ACTION`; its `EXTRA_INTENT` must be launched by a manifest receiver or the system confirmation dialog will never appear. Older versions use `ACTION_INSTALL_PACKAGE` with `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_NEW_DOCUMENT` via `startActivity`. Do not request `EXTRA_RETURN_RESULT`.

**Why:** Android's explicit store-source flag exists only on PackageInstaller sessions; those sessions may defer to a user-action confirmation callback. The legacy activity path needs a readable `content://` URI and installer metadata, while neither path should couple installation to an activity result callback.

**How to apply:** When changing installer installation behavior, update the installer manifest handlers, provider/cache paths, session source metadata, completion observation, and legacy activity flags together. Leave the main payload app module untouched.