---
name: Workflow side effects
description: Generated project changes that can result from running or restarting backend and APK workflows.
---

Backend and APK workflow runs can rewrite tracked signing/build metadata, rotate the backend JWT secret, and add Replit port mappings when they discover auxiliary listeners.

**Why:** Workflow setup is not isolated to its configured build command; restarting the backend during dashboard work has also changed signing material and `.replit` port configuration.

**How to apply:** After workflow restarts, inspect generated configuration and signing changes before final review. Keep port mappings only when the exposed listener is required, restore accidental generated changes, and never include or expose secret contents.

APK verification can also be blocked by the shared `/tmp/android-sdk` cache: the workflow may fail while provisioning an NDK or report cached Build Tools as corrupted before compiling source.

**Why:** The APK workflow's provisioning/build environment is separate from Java source correctness, and its partial setup can leave generated files behind.

**How to apply:** Read the APK workflow tail first. If it fails before `compile...JavaWithJavac`, report the SDK/NDK blocker separately and still restore generated tracked artifacts before reviewing the final diff.

Installer identity sources may already be checked in under generated class names rather than `MainActivity`/`BlockVpnService`.

**Why:** The installer source tree is identity-hardened in the repository, so a build script that assumes the original filenames fails before Gradle starts.

**How to apply:** Discover the activity and VPN service classes from their Java declarations before copying or rewriting them, and update the manifest/ProGuard references from those discovered names.

The dashboard build emits hashed bundles into `backend/public`, which is the directory served by the running backend; those generated bundles must remain aligned with the source when the preview is restarted.

**Why:** Restoring public assets after a successful source build makes the running preview serve stale dashboard code even though the source build passed.

**How to apply:** Keep the feature-related `backend/public` bundle/index changes after a dashboard build, but restore unrelated APK metadata such as the obfuscation dictionary and payload package marker.