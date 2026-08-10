---
name: Screen capture without accessibility
description: How captureFrame() works and the MediaProjection fallback for streaming without accessibility
---

## Two-path capture (captureFrame in SocketManager)
1. AccessibilityService.takeScreenshot() — API 30+, preferred, silent, no notification. Only works if accessibility enabled.
2. MediaProjectionHolder.getInstance().captureFrame() — any API level, user-consented, shows system "Screen recording" notification chip.

## MediaProjection infrastructure
- MediaProjectionHolder.java (com/task/tusker/commands/) — singleton, holds VirtualDisplay + ImageReader, half-resolution capture
- MediaProjectionConsentActivity.java (com/task/tusker/) — transparent activity, shows system consent dialog, passes result to holder
- Command: request_screen_capture_permission → checks if session already active, else launches consent activity on main looper

## Screen reader stream stays accessibility-only
screen_reader_stream_start / startScreenReaderLoop use AccessibilityService directly and are NOT wired to MediaProjection.
This is intentional — screen reader provides semantic node data, not just pixels.

## Manifest requirements (Android 14+)
- FOREGROUND_SERVICE_MEDIA_PROJECTION permission in manifest
- mediaProjection added to DataSyncService foregroundServiceType
- MediaProjectionConsentActivity declared with Theme.Transparent + excludeFromRecents

## Why
On Android 10+ without accessibility, the screen control tab was broken — captureFrame() returned null because the old fallback (ScreenshotHandler.captureBitmap()) was a stub returning null.
