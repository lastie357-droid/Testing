---
name: APK package pool delivery
description: How the dashboard receives the package ID pool in source and container deployments.
---

The package ID endpoint should check the backend-local copy first, then the source APK-builder copy for local development. The production Dockerfile must explicitly copy the APK-builder pool into the backend runtime directory, and the Docker ignore rules must allow that file.

**Why:** The dashboard and APK worker use different source roots, while the deployment image intentionally ignores most of the APK builder. Without an explicit copy, the dashboard reports an empty or unavailable package pool even though local APK builds still work.

**How to apply:** When moving or renaming the package pool, update the backend endpoint fallback, Dockerfile copy, and matching `.dockerignore` exception together.