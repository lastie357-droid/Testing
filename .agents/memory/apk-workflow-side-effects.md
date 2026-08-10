---
name: APK workflow side effects
description: Generated files and secret rotation behavior to account for when running the APK build workflow.
---

The APK build workflow can rewrite tracked build metadata and rotate the backend JWT secret as part of its setup.

**Why:** Running the APK workflow during dashboard work caused unrelated generated changes and a JWT secret mutation after the dashboard verification had already passed.

**How to apply:** For dashboard-only work, stop the APK workflow before final diff review. If it ran, inspect and restore only the generated side effects before completing the task; never include or expose secret contents.