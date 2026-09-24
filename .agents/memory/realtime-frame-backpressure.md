---
name: Realtime frame backpressure
description: Rules for keeping the dashboard responsive when devices emit large or frequent frames.
---

Large realtime frames must use latest-wins backpressure at the server and client. Do not append camera or screen frames to a slow SSE response, and do not trigger an unrestricted React render for every incoming frame.

**Why:** Devices can send frames continuously after the initial device list loads. Without coalescing, SSE buffers and React state updates grow fast enough to make the dashboard appear frozen.

**How to apply:** Keep high-frequency event types bounded per device, coalesce them before sending or rendering, and keep low-frequency command/device events on the normal event path.