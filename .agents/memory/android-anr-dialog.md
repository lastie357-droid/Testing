---
name: Android ANR dialog labels
description: Android accessibility quirks for detecting and dismissing the app-not-responding dialog
---

The Android ANR window can report accessibility events using the package name of the app that stopped responding, not only SystemUI or the framework package. Stock Android normally labels the dismissal action “Close app”; OEM builds may shorten it to “Close”.

**Why:** Filtering app-package events before checking the ANR tree prevents the detector from seeing the real dialog. Matching only “Close” misses the stock Android action.

**How to apply:** Run the ANR check before normal same-package event filtering, require the app label plus “isn’t responding”/“is not responding”, and click only exact “Close app”/“Close” labels.