---
name: Idle suspension feature
description: Design and critical bug in the 2-min idle stream suspension system
---

## Design
- IdleSuspensionManager.java (com/task/tusker/utils/) — bitmask: STREAM_IDLE_FRAME(1), STREAM_BLOCK_FRAME(2), STREAM_SCREEN_READER(4), STREAM_CAMERA(8).
- Timer starts/resets on onStreamStarted() or onInteraction(). Fires after 2 min.
- onSuspend callback: SocketManager stops all streams, sends stream:suspended to server.
- onResume callback: restarts only SCREEN_STREAMS (camera excluded — operator must restart manually).
- isUiInteractionCommand(): touch/swipe/press_back/home/recents/scroll/input_text/press_enter/click_by_text/wake_screen/screen_off/open_task_manager reset timer. Data queries do NOT.

## Critical bug (fixed)
onStreamStopped() must clear the bit from BOTH activeStreams AND suspendedTypes when suspended=true.
Without: operator sends stream_stop while suspended → suspendedTypes still has bit → next interaction restarts a stream the operator intentionally stopped.

**Why:** suspendedTypes is the resume mask. Any explicit operator stop during suspension must remove that stream from it.

## Hook locations in SocketManager.java
- startIdleFrameMode / stopIdleFrameMode → STREAM_IDLE_FRAME
- startBlockFrameMode / stopBlockFrameMode → STREAM_BLOCK_FRAME
- screen_reader_start/stop cases → STREAM_SCREEN_READER
- screen_reader_stream_start (inside heartbeatExecutor lambda) / stream_stop → STREAM_SCREEN_READER
- camera_stream_start (only on success) / camera_stream_stop → STREAM_CAMERA
- handleCommand → isUiInteractionCommand check before dispatch
- disconnect() → idleSuspensionManager.shutdown()
