---
name: Chunked command acknowledgements
description: Dashboard handling for device commands that stream data in chunks before resolving their command request
---

Streamed device commands have two protocol events: an early transport acknowledgement that carries `streaming` metadata, and a later completed aggregate assembled from `data:chunk` events. A successful acknowledgement is not the command's data result.

**Why:** Treating the acknowledgement as the completed response can stop loading early, mark the command ID as consumed, and discard the actual chunk aggregate. This is especially easy to trigger for slower Android content-provider queries.

**How to apply:** Keep the completed aggregate on a distinct UI result identity, and have list consumers ignore successful streaming acknowledgements until the payload field they need is present. Preserve device-side errors instead of converting failed bulk reads into empty successful streams.