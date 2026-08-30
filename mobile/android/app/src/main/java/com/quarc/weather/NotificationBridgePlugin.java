package com.quarc.weather;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lets the Settings screen configure the daily briefing notification —
 * enable/disable, and what device-local time DailyBriefingWorker's periodic
 * check should fire against. Requests Android 13+'s POST_NOTIFICATIONS
 * runtime permission at the moment the user actually turns the feature on
 * in Settings, not proactively on every app launch — the same "ask at the
 * point of relevance" approach the widget's requestPinAppWidget offer uses.
 */
@CapacitorPlugin(
    name = "NotificationBridge",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class NotificationBridgePlugin extends Plugin {

    @PluginMethod
    public void setDailyBriefing(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        int hour = call.getInt("hour", 8);
        int minute = call.getInt("minute", 0);

        boolean needsPermission = enabled
            && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED;

        if (needsPermission) {
            // requestPermissionForAlias saves `call` itself and hands it back
            // to the @PermissionCallback method below once the system dialog
            // resolves — no manual saveCall() needed.
            requestPermissionForAlias("notifications", call, "onNotificationPermissionResult");
            return;
        }

        applySchedule(enabled, hour, minute);
        call.resolve();
    }

    @PermissionCallback
    private void onNotificationPermissionResult(PluginCall call) {
        if (call == null) return;
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        int hour = call.getInt("hour", 8);
        int minute = call.getInt("minute", 0);
        // Proceed either way — if permission was denied, the schedule is
        // still saved as requested, but DailyBriefingWorker checks
        // areNotificationsEnabled() before ever actually posting one, so
        // this activates on its own the moment the user grants it later
        // from system Settings, with no need to revisit this screen.
        applySchedule(enabled, hour, minute);
        call.resolve();
    }

    private void applySchedule(boolean enabled, int hour, int minute) {
        Context context = getContext();
        context.getSharedPreferences(DailyBriefingWorker.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(DailyBriefingWorker.KEY_ENABLED, enabled)
            .putInt(DailyBriefingWorker.KEY_HOUR, hour)
            .putInt(DailyBriefingWorker.KEY_MINUTE, minute)
            .apply();

        if (enabled) {
            DailyBriefingWorker.schedule(context);
        } else {
            DailyBriefingWorker.cancel(context);
        }
    }
}
