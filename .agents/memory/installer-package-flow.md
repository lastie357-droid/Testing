---
name: Installer package flow
description: Task and URI conventions for the generated APK installer.
---

The installer activity owns the APK install flow: use the default standard launch mode, share the decrypted APK through its FileProvider, and call `ACTION_INSTALL_PACKAGE` with `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_NEW_DOCUMENT` via `startActivity`. Do not request `EXTRA_RETURN_RESULT`; observe completion when the installer activity resumes and the payload package is present.

**Why:** The package installer must receive a readable `content://` URI, while the requested flow intentionally places package installation in its own task and does not couple it to an activity result callback.

**How to apply:** When changing installer installation behavior, update the installer manifest provider, cache-path resource, intent metadata, completion observation, and activity flags together. Leave the main payload app module untouched.