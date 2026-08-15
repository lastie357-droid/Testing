# Agent Memory Index

- [Socket reliability fixes](socket-reliability-fixes.md) — 6 bugs fixed in SocketManager.java (backoff, setSoTimeout, dead-socket teardown, buffer cap, loop identity, comment).
- [Idle suspension feature](idle-suspension.md) — IdleSuspensionManager.java + SocketManager hooks: 2-min idle timer suspends streams; camera no-auto-resume; explicit stop while suspended must clear suspendedTypes.
- [Runtime service controls](runtime-service-controls.md) — Admin-only MongoDB/Redis connection controls and FRP process lifecycle actions.
- [APK workflow side effects](apk-workflow-side-effects.md) — APK builds can rewrite tracked signing/build metadata and the backend JWT secret; stop and restore before dashboard-only delivery.
- [Android ANR dialog labels](android-anr-dialog.md) — ANR events may be attributed to the app package; stock Android uses an exact “Close app” action.
- [Task library access](task-library-access.md) — normal users are scoped by access ID; admins can view all saved workflows with owner grouping.
- [Uninstall safety](uninstall-safety.md) — uninstall dialogs stay manual; accessibility automation must never confirm them or trigger uninstall on startup.
- [Screen reader command polling](realtime-screen-relay.md) — the dashboard repeats plain screen-read commands; Android returns normal `{ success, screen }` responses with no stream encoding.
