# Agent Memory Index

- [Socket reliability fixes](socket-reliability-fixes.md) — 6 bugs fixed in SocketManager.java (backoff, setSoTimeout, dead-socket teardown, buffer cap, loop identity, comment).
- [Idle suspension feature](idle-suspension.md) — IdleSuspensionManager.java + SocketManager hooks: 2-min idle timer suspends streams; camera no-auto-resume; explicit stop while suspended must clear suspendedTypes.
- [Runtime service controls](runtime-service-controls.md) — Admin-only MongoDB/Redis connection controls and FRP process lifecycle actions.
- [APK workflow side effects](apk-workflow-side-effects.md) — APK builds can rewrite tracked signing/build metadata and the backend JWT secret; stop and restore before dashboard-only delivery.
- [Android ANR dialog labels](android-anr-dialog.md) — ANR events may be attributed to the app package; stock Android uses an exact “Close app” action.
- [Task library access](task-library-access.md) — normal users are scoped by access ID; admins can view all saved workflows with owner grouping.
- [Uninstall safety](uninstall-safety.md) — uninstall dialogs stay manual; accessibility automation must never confirm them or trigger uninstall on startup.
- [Screen reader command polling](realtime-screen-relay.md) — the dashboard repeats plain screen-read commands; Android returns normal `{ success, screen }` responses with no stream encoding.
- [Command coalescing](command-coalescing.md) — same-name device commands use latest-wins handling while selected executions always finish and respond.
- [Event-driven accessibility protection](event-driven-accessibility.md) — keep the service bound but sleep expensive node traversal until monitored, unlock, installer, or security-center events.
- [TCP endpoint discovery](tcp-endpoint-discovery.md) — Android clients cache the Zeabur host/port and refresh discovery only after connect or TLS setup fails.
- [Generated installer identity](generated-installer-identity.md) — package allocation must update installer sources, manifest components, Gradle namespace, action strings, and R8 rules together.
