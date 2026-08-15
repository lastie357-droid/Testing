---
name: Realtime screen relay
description: Latency constraints and transport decisions for accessibility-tree streaming.
---

The accessibility-tree stream uses a persistent TCP live channel and SSE dashboard fan-out. Realtime frames should stay compressed through the backend, use monotonically increasing sequences, and use latest-frame-wins backpressure so slow dashboards never display an old queue.

**Why:** Synchronous decompression and full-tree polling add avoidable delay; TCP remains appropriate because accessibility trees require reliable ordered delivery.

**How to apply:** Keep device stream intervals around 100–150 ms, prefer fast compression, decode asynchronously in the browser, and avoid introducing polling or a second transport on the healthy SSE path.

Screen-reader stream start should return one full accessibility-tree snapshot in the command response, while subsequent compressed `screen:update` events must be decoded asynchronously by the dashboard before rendering.

**Why:** The first live event can arrive after the user opens the tab, and compressed SSE envelopes do not contain a directly renderable `screen` object.

**How to apply:** Keep the initial snapshot and the live relay on the same `{ success, screen }` contract; use polling only as a recovery path for delayed or disconnected SSE.