---
name: Generated installer identity
description: Constraints for changing the installer package and generated component identifiers during APK builds.
---

The installer application identity must be changed as one unit: Java package declarations, generated component class names, manifest component references, Gradle namespace, package-scoped R8 rules, and package-qualified action strings must all agree.

**Why:** Changing only the Android application ID leaves source or manifest references pointing at the in-tree identity, which can compile successfully but fail when Android tries to create the launcher activity or service. Build-time identity rewrites also must not delete pre-existing build override files.

**How to apply:** Keep the rewrite isolated to the build workspace, restore the original source/configuration at exit, preserve any override files that existed before the build, and verify both the merged manifest and the release R8 mapping for the allocated package.

APK hardening must not alter ZIP CRC fields after alignment. Use APK Signature Scheme v2/v3/v4 plus authenticated encryption for protected assets, and reassert only compatible ZIP flags before the final signing step.

**Why:** `apksigner` validates local and central CRC records for all entries; CRC-based pseudo-decryption markers make the package fail signing rather than improve protection.

**How to apply:** Treat the APK signature as the package-wide integrity boundary. For installer payloads, verify the authenticated AES container and an embedded SHA-256 digest after extraction, before handing the APK to PackageInstaller.