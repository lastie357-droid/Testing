---
name: Android client update boundary
description: Device-side command fixes require updating the installed controller APK
---

## Rule
Backend and dashboard changes do not update the Android client already installed on a device. Device-side command behavior changes take effect only after installing a rebuilt controller APK with the same package ID as the existing client.

**Why:** A connected device continues running its installed binary, so server-side changes can succeed while an older client still exhibits the previous behavior.

**How to apply:** For Android command-handler fixes, verify the APK build and tell the user that the matching client APK must be installed on the device; restarting the backend alone is not sufficient.
