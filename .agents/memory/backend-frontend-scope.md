---
name: Backend and dashboard scope
description: The user's standing boundary for API and dashboard integration work in this project.
---

For integration fixes, focus on the backend and React dashboard. Do not build or edit Android app sources. Do not remove an API until its use by both dashboard and Android app callers has been checked; preserve required APIs and align their paths and payloads.

**Why:** The user repeatedly specified backend/frontend-only work and said APIs required by either side must not be removed.

**How to apply:** Search backend and dashboard callers before changing routes. Keep Android sources untouched and do not run APK build workflows for backend/dashboard tasks.
