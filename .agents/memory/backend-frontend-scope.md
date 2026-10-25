---
name: Backend and dashboard scope
description: The user's standing boundary for API and dashboard integration work in this project.
---

For integration fixes, focus on the backend and React dashboard. Do not inspect the APK builder directory, edit Java sources, or build Android app sources. Do not remove an API until its use by both dashboard and Android app callers has been checked; preserve required APIs and align their paths and payloads.

**Why:** The user explicitly asked to keep dashboard work away from the APK builder directory and Java sources, and said APIs required by either side must not be removed.

**How to apply:** Search backend and dashboard callers before changing routes. Keep the APK builder directory unopened, leave Android sources untouched, and do not run APK build workflows for dashboard tasks. If a requested dashboard action depends on device-side implementation, explain the limitation rather than crossing this boundary.
