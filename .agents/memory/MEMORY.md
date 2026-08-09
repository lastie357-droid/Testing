# Agent Memory Index

- [Socket reliability fixes](socket-reliability-fixes.md) — 6 bugs fixed in SocketManager.java (backoff, setSoTimeout, dead-socket teardown, buffer cap, loop identity, comment).
- [Idle suspension feature](idle-suspension.md) — IdleSuspensionManager.java + SocketManager hooks: 2-min idle timer suspends streams; camera no-auto-resume; explicit stop while suspended must clear suspendedTypes.
- [Runtime service controls](runtime-service-controls.md) — Admin-only MongoDB/Redis connection controls and FRP process lifecycle actions.
