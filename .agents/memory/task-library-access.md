---
name: Task library access
description: Ownership and visibility rules for saved Task Studio workflows.
---

Saved workflows are private to a normal user's access ID, while admins may view the complete library grouped with owner/access-ID metadata. Authentication must be included on every task list and mutation request.

**Why:** The dashboard can successfully save a task and still appear empty if the subsequent list request is unauthenticated or the admin endpoint defaults to global-only records.

**How to apply:** Keep access-ID scoping and ownership checks in the backend; treat client-provided access IDs as advisory for users, and use authenticated requests for Task Studio and task-runner refreshes.

Task Studio workflows are intended to be one-time, ordered sequences, not recurring background jobs. A workflow saved as “Run once when device comes online” waits for one device connection and is then cleared.

**Why:** The user clarified that Task Studio is for one-time tasks, not surveillance or recurring execution.

**How to apply:** Preserve sequential, one-shot semantics and distinguish a task already delivered to the device (which can continue without the dashboard) from a server-side schedule waiting for the device to reconnect.

Task Studio only authors and submits workflows. The Android app owns task execution, retries, screen lock/unlock recovery, and completion.

**Why:** The user clarified that Task Studio sends the task and the app handles the rest.

**How to apply:** Keep execution, retry, and recovery decisions in the Android task runner. The dashboard may display progress, but it must not own task behavior.

When a new task arrives, replace the current or waiting task only if its executable ordered steps differ. A duplicate of the ongoing task is a no-op, regardless of its transport command ID; ignore dashboard-only `enabled` and `originalIndex` fields when comparing steps.

**Why:** The user wants a repeated delivery of the same task to leave its current run undisturbed, while genuinely different work replaces it.

**How to apply:** Compare the active task's ordered step content before cancelling workers or changing the current-task slot. Keep equality scoped to the task that is currently running or waiting, not previously completed tasks.