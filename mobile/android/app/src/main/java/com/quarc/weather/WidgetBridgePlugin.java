package com.quarc.weather;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.CookieManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the app's web session into native code, so the home-screen widget
 * (which runs in its own process, with no access to the WebView or its
 * cookies) can refresh itself in the background without the app being open.
 *
 * The session cookie is httpOnly — JS can never read it via document.cookie,
 * that's the whole point of httpOnly. Android's CookieManager operates below
 * the JS sandbox at the WebView engine level though, so it can read what the
 * server actually set. This plugin is the only bridge between those two
 * worlds.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    static final String PREFS = "quarc_weather_widget";
    static final String KEY_TOKEN = "session_token";
    static final String KEY_SERVER = "server_origin";
    private static final String KEY_PIN_OFFERED = "pin_offered";

    /**
     * Called from JS right after login / a successful session check. Reads
     * the "token" cookie set by quarc-auth for the given server origin and
     * stores it for WeatherWidgetWorker's own, independent HTTP calls.
     */
    @PluginMethod
    public void syncSession(PluginCall call) {
        String serverOrigin = call.getString("serverOrigin");
        if (serverOrigin == null || serverOrigin.isEmpty()) {
            call.reject("serverOrigin required");
            return;
        }

        String token = null;
        String raw = CookieManager.getInstance().getCookie(serverOrigin);
        if (raw != null) {
            for (String part : raw.split(";")) {
                String trimmed = part.trim();
                if (trimmed.startsWith("token=")) {
                    token = trimmed.substring("token=".length());
                    break;
                }
            }
        }

        SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (token != null && !token.isEmpty()) {
            editor.putString(KEY_TOKEN, token);
            editor.putString(KEY_SERVER, serverOrigin);
            editor.apply();
            // Refresh right away so a freshly-logged-in widget doesn't sit on
            // stale/empty data until the next scheduled cycle.
            WeatherWidgetWorker.refreshNow(getContext());
        }
        // Not finding a cookie yet isn't an error worth surfacing to JS —
        // this gets called defensively on every checkSession(), and most of
        // those calls simply have nothing new to harvest.
        call.resolve();
    }

    /** Called on logout so a stale token can't keep refreshing the widget
     *  after the user has explicitly signed out. */
    @PluginMethod
    public void clearSession(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_TOKEN)
            .remove(KEY_SERVER)
            .apply();
        call.resolve();
    }

    /**
     * Shows the OS's native "Add to Home Screen?" confirmation for the
     * weather widget — once ever. Android has no API to place a widget
     * silently (by design; a third-party app silently cluttering the home
     * screen would be a serious UX/security problem), only to request a
     * one-tap OS-owned confirmation via requestPinAppWidget (API 26+). This
     * quietly no-ops on older Android or launchers that don't support
     * pinning, rather than failing.
     */
    @PluginMethod
    public void offerPin(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_PIN_OFFERED, false)) {
            call.resolve();
            return;
        }
        prefs.edit().putBoolean(KEY_PIN_OFFERED, true).apply();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
            ComponentName provider = new ComponentName(getContext(), WeatherWidgetProvider.class);
            if (mgr.isRequestPinAppWidgetSupported()) {
                mgr.requestPinAppWidget(provider, null, null);
            }
        }
        call.resolve();
    }
}
