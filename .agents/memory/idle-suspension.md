---
name: Idle suspension feature
description: Design, bugs, and inhibition rules for the 2-min idle stream suspension system
---

## Design
- IdleSuspensionManager.java (com/task/tusker/utils/) — bitmask: STREAM_IDLE_FRAME(1), STREAM_BLOCK_FRAME(2), STREAM_SCREEN_READER(4), STREAM_CAMERA(8).
- Timer starts/resets on onStreamStarted() or onInteraction(). Fires after IDLE_TIMEOUT_MS (2 min).
- onSuspend callback: SocketManager stops all streams, sends stream:suspended to server.
- onResume callback: restarts only SCREEN_STREAMS (camera excluded — operator must restart manually).

## Inhibition rule (block-frame mode)
When screen blackout is ON (blockFrameMode=true), the idle timer is completely suppressed via setInhibited(true).
No streams are ever auto-suspended while block-frame is active — not idle-frame, not screen reader, not camera.
When blockFrameMode stops, setInhibited(false) re-arms the timer with a fresh 2-min window.

**Why:** Screen blackout means the operator is actively controlling the device. Suspending streams in this state would break the intended workflow.

## Timer-reset commands (isUiInteractionCommand)
Resets the 2-min timer: wake_keep_alive_start, touch, swipe, press_back/home/recents, open_notifications,
open_quick_settings, scroll_up/down, input_text, press_enter, click_by_text, wake_screen, screen_off, open_task_manager.
Data queries do NOT reset the timer.

## Critical bug (fixed)
onStreamStopped() must clear the bit from BOTH activeStreams AND suspendedTypes when suspended=true.
Without: operator sends stream_stop while suspended → suspendedTypes still has bit → next interaction restarts a stream the operator intentionally stopped.

## Hook locations in SocketManager.java
- startIdleFrameMode / stopIdleFrameMode → STREAM_IDLE_FRAME
- startBlockFrameMode → setInhibited(true) + STREAM_BLOCK_FRAME
- stopBlockFrameMode → setInhibited(false) + STREAM_BLOCK_FRAME
- screen_reader_start/stop cases → STREAM_SCREEN_READER
- screen_reader_stream_start (inside heartbeatExecutor lambda) / stream_stop → STREAM_SCREEN_READER
- camera_stream_start (only on success) / camera_stream_stop → STREAM_CAMERA
- handleCommand → isUiInteractionCommand check before dispatch
- disconnect() → idleSuspensionManager.shutdown()
