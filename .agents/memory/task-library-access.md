---
name: Task library access
description: Ownership and visibility rules for saved Task Studio workflows.
---

Saved workflows are private to a normal user's access ID, while admins may view the complete library grouped with owner/access-ID metadata. Authentication must be included on every task list and mutation request.

**Why:** The dashboard can successfully save a task and still appear empty if the subsequent list request is unauthenticated or the admin endpoint defaults to global-only records.

**How to apply:** Keep access-ID scoping and ownership checks in the backend; treat client-provided access IDs as advisory for users, and use authenticated requests for Task Studio and task-runner refreshes.