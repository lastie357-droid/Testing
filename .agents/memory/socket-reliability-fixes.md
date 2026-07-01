---
name: Socket reliability fixes
description: What was wrong with SocketManager.java reconnect/socket handling and how it was fixed
---

## Rules
- All three sockets (primary, stream, live) must use setSoTimeout(90_000). setSoTimeout(0) causes readLine() to block forever on silent server death.
- Reconnect loops must use exponential backoff (base 1500ms, cap 60s). Fixed delay hammers server during outage.
- forceReconnect() must: (1) bump loopGeneration counter, (2) interrupt sleeping loop threads, (3) reset all three backoff delays. Without the interrupt a sleeping thread stays alive and creates duplicate loops.
- Dead primary socket (checkError()) must close ALL channels (primary+stream+live).
- offlineFrameBuffer must be capped (<=300 frames, evict oldest) to prevent OOM.
- KeepAliveManager WAKE_DELAY_MS = 300_000 (5 min) — Javadoc said "1m30s", now fixed.

**Why:** Network partitions kill TCP without FIN. Uncapped reconnects flood server. Stale loops cause duplicate state.

**How to apply:** Any future socket rework: keep setSoTimeout(90s), keep loopGeneration pattern, keep backoff fields volatile.
