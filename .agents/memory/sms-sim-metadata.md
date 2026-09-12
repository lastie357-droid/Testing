---
name: SMS SIM metadata
description: How SMS rows identify SIM slot and carrier information across Android devices
---

SMS rows can carry a subscription ID, but the SMS content provider is not uniform across OEMs. Resolve that ID through active subscriptions to obtain the physical slot and operator details, while retaining a basic SMS projection fallback when `sub_id` is unsupported.

**Why:** A strict subscription-aware query can break SMS loading on devices with customized providers. The message list should remain usable even when SIM metadata is unavailable.

**How to apply:** Treat SIM slot and operator fields as optional in dashboard consumers. Show an explicit unavailable state rather than guessing a slot or carrier when Android cannot provide subscription metadata.