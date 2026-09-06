---
name: APK workflow side effects
description: Generated files and secret rotation behavior to account for when running the APK build workflow.
---

The APK build workflow can rewrite tracked build metadata and rotate the backend JWT secret as part of its setup.

**Why:** Running the APK workflow during dashboard work caused unrelated generated changes and a JWT secret mutation after the dashboard verification had already passed.

**How to apply:** For dashboard-only work, stop the APK workflow before final diff review. If it ran, inspect and restore only the generated side effects before completing the task; never include or expose secret contents.

APK verification can also be blocked by the shared `/tmp/android-sdk` cache: the workflow may fail while provisioning an NDK or report cached Build Tools as corrupted before compiling source.

**Why:** The APK workflow's provisioning/build environment is separate from Java source correctness, and its partial setup can leave generated files behind.

**How to apply:** Read the APK workflow tail first. If it fails before `compile...JavaWithJavac`, report the SDK/NDK blocker separately and still restore generated tracked artifacts before reviewing the final diff.

The installer identity rewrite must discover the current generated Activity/VpnService class names instead of assuming legacy `MainActivity` and `BlockVpnService` filenames.

**Why:** The checked-in installer source uses generated entry-class names; an interrupted or older build script can otherwise fail before Gradle starts while trying to copy files that no longer exist.

**How to apply:** Keep identity generation based on the source class declarations and manifest/proguard references, and remove stale Java staging backups before moving a fresh source tree into place.

The APK worker can stall during Android SDK license/provisioning setup and mutate package/obfuscation metadata before reaching module-key selection.

**Why:** SDK setup runs before compilation and cleanup is not guaranteed when the workflow is stopped mid-run.

**How to apply:** Treat a pre-compilation stall as environment-blocked verification; stop it, restore unrelated generated metadata, and do not claim the full APK build passed.

The dashboard build emits hashed bundles into `backend/public`, which is the directory served by the running backend; those generated bundles must remain aligned with the source when the preview is restarted.

**Why:** Restoring public assets after a successful source build makes the running preview serve stale dashboard code even though the source build passed.

**How to apply:** Keep the feature-related `backend/public` bundle/index changes after a dashboard build, but restore unrelated APK metadata such as the obfuscation dictionary and payload package marker.