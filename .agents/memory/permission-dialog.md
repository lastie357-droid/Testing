---
name: Permission dialog background start
description: Why permission dialogs silently fail without accessibility and how to fix it
---

## Rule
ALL startActivity() calls in PermissionManager (and anywhere else in SocketManager that launches UI from a service thread) MUST be posted to the main looper:
```java
new Handler(Looper.getMainLooper()).post(() -> context.startActivity(intent));
```

## Why
Android 10+ blocks startActivity() called from a background service thread unless:
- The app has a visible foreground window, OR
- The accessibility service is running (it provides a window token), OR
- SYSTEM_ALERT_WINDOW is granted

When accessibility is disabled the OS silently swallows the call — no exception, no dialog.
Posting to the main looper satisfies the OS check.

## How to apply
Any time code in a service context (SocketManager, PermissionManager, etc.) needs to launch an Activity or Settings page: always post to main looper. Never call startActivity directly from an executor or socket-handler thread.
Also add FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_REORDER_TO_FRONT to the intent.
