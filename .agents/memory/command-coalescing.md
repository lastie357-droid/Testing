---
name: Command coalescing
description: Latest-wins handling for duplicate device commands while preserving the selected command response
---

## Rule
- Commands with the same name on one device use latest-wins coalescing: a command already executing must finish, while queued duplicates are replaced and acknowledged as superseded. Different command names remain independently dispatchable.

**Why:** High-frequency polling can otherwise leave hundreds of server waiters and Android executor tasks alive until timeout, causing stale responses and retry storms.

**How to apply:** Keep server pending entries order-aware so a real response settles older same-command waiters, and keep the device response path responsible for acknowledging discarded command IDs so their server timers cannot linger.