---
name: Help tutorial replay
description: Lifecycle and timing constraints for the bundled Android help animation.
---

The help tutorial is an HTML animation rendered in a WebView, not a baked video file. Its editable instructional captions live in the asset’s central copy configuration.

**Why:** The WebView cleanup pauses timers globally, so a later help dialog can load successfully while its JavaScript animation remains stopped unless the newly-created WebView resumes timers. The original final slide also used a zero delay, which prevented the animation from ever reaching its replay handler.

**How to apply:** On every help-dialog open, create a fresh WebView and resume its timers before loading the asset. Ensure the final tutorial step has a positive hold duration and advances to the loop handler; destroying the WebView on dismiss keeps the loop scoped to the help page.