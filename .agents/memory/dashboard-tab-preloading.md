---
name: Dashboard tab preloading
description: Browser UI bundle preloading without automatically mounting device tools or querying devices.
---

**Rule:** Preload lazy tab modules in the browser during idle time, but keep tool components unmounted and device commands/data requests opt-in until the user selects a tab.

**Why:** The user chose faster tab interfaces without automatically querying every device tool or starting tasks.

**How to apply:** Preload importers without rendering their components, run prefetch work sequentially, and keep the existing live event relay unchanged unless the user defines a specific additional requirement.