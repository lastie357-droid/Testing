---
name: Pattern upload storage
description: Persistence boundary for uploaded gesture-pattern metadata.
---

Persist only a display name, source filename, screen dimensions, and timestamps for an uploaded pattern, scoped to its device and authenticated owner. Do not persist pattern cell sequences, cell coordinates, or uploaded JSON contents.

**Why:** the user selected metadata-only storage rather than storing the pattern itself.

**How to apply:** keep parsed pattern data in the browser session and enforce device and owner scoping on every metadata API operation.
