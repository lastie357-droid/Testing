---
name: Backend TCP reconnect grace
description: Prevent false offline broadcasts while a replacement primary connection is registering.
---

When a primary TCP socket closes, its offline grace timer must account for replacement registrations already in flight. Database-backed registration can take longer than the grace window under connection fan-in.

**Why:** concurrent reconnects can wait several seconds on database operations; a fixed timer can publish offline before the replacement socket becomes active.

**How to apply:** track pending per-device registrations before asynchronous work, defer the old socket's offline transition while any replacement is pending, and clear the pending entry on acceptance, rejection, or socket close.
