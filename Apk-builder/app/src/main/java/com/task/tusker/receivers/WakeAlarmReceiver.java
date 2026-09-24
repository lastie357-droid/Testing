package com.task.tusker.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import com.task.tusker.services.ServiceWatchdog;
import com.task.tusker.services.WakeWorker;

/**
 * WakeAlarmReceiver — Method 4: AlarmManager exact repeating heartbeat.
 *
 * Fired by ServiceWatchdog.scheduleWakeAlarm() every 15 minutes via
 * setExactAndAllowWhileIdle (RTC_WAKEUP) — works even in Doze mode.
 *
 * On each fire it:
 *   1. Ensures both foreground services are running.
 *   2. Re-schedules itself for another 15 minutes (exact alarms are one-shot).
 *   3. Re-queues the WorkManager task in case it was cancelled.
 *
 * Registered in AndroidManifest with the custom action
 * "com.task.tusker.action.WAKE_ALARM".
 */
public class WakeAlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "WakeAlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (!ServiceWatchdog.ALARM_ACTION.equals(action)) return;

        Log.i(TAG, "Wake alarm fired — checking services");

        // Capture this before the receiver's work can recreate services.
        // Do not interrupt an app session that is already active.
        boolean appWasRunning = ServiceWatchdog.isAppRunning(context);

        // 1. Restart any stopped foreground services
        ServiceWatchdog.ensureServicesRunning(context);

        // 2. Revive the accessibility service if it has died
        ServiceWatchdog.ensureAccessibilityRunning(context);

        // 3. Re-arm for next cycle (exact alarms are one-shot on API 23+)
        ServiceWatchdog.scheduleWakeAlarm(context);

        // 4. Re-queue WorkManager in case it was purged
        WakeWorker.schedule(context);

        // Match the boot entry behavior only for a cold app wake. If the app
        // already had a task, foreground activity, or service, leave its UI
        // and task stack untouched.
        if (!appWasRunning) {
            try {
                BootReceiver.launchApp(context);
                Log.i(TAG, "App was stopped — opened MainActivity");
            } catch (Exception e) {
                Log.w(TAG, "Could not open app after alarm wake: " + e.getMessage());
            }
        } else {
            Log.d(TAG, "App already running — no app launch needed");
        }
    }
}
