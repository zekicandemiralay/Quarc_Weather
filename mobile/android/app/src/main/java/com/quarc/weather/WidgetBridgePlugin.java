package com.quarc.weather;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the app into native code, so the home-screen widget and the morning briefing (which run in their
 * own process, with no access to the WebView or its database) can refresh themselves in the background
 * without the app being open.
 *
 * What crosses the bridge is just the list of places to show — the saved cities plus this device's My
 * Location, as names and coordinates — and the unit setting. The background workers then ask the weather
 * provider directly; there is no login token and no Quarc server on that path.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    static final String PREFS = "quarc_weather_widget";
    /** The places to show, as the JSON {@link WidgetCities} reads. */
    static final String KEY_CITIES = "cities_json";
    /** "metric" or "imperial" — decides whether the workers ask the provider for °C or °F. */
    static final String KEY_UNITS = "units";
    private static final String KEY_PIN_OFFERED = "pin_offered";

    /**
     * Called from JS whenever the list of places or the unit setting changes. Stores them for the workers
     * and refreshes the widget — but only if something actually changed, so reopening the app does not hit
     * the weather provider every time.
     */
    @PluginMethod
    public void syncCities(PluginCall call) {
        JSArray raw = call.getArray("cities");
        if (raw == null) {
            call.reject("cities required");
            return;
        }
        // Stored cleaned: anything that is not a usable place (bad coordinates, no id) is dropped here.
        String cities = WidgetCities.toJson(WidgetCities.parse(raw.toString()));
        String units = "imperial".equals(call.getString("units")) ? "imperial" : "metric";

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean changed = !cities.equals(prefs.getString(KEY_CITIES, null)) || !units.equals(prefs.getString(KEY_UNITS, null));
        if (changed) {
            prefs.edit().putString(KEY_CITIES, cities).putString(KEY_UNITS, units).apply();
            // Refresh right away so the widget does not sit on stale or empty data until the next cycle.
            WeatherWidgetWorker.refreshNow(getContext());
        }
        call.resolve();
    }

    /** Called on logout: the widget stops showing (and refreshing) the previous person's places. */
    @PluginMethod
    public void clearCities(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_CITIES)
            .remove(KEY_UNITS)
            .apply();
        // Repaint now ("open the app to sign in") rather than at the next scheduled refresh.
        WeatherWidgetWorker.refreshNow(getContext());
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

    /** How many copies of the widget are on the home screen — the app's Settings uses this to
     *  offer "Customize widget" only when there is something to customize. */
    @PluginMethod
    public void widgetCount(PluginCall call) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
        int[] ids = mgr.getAppWidgetIds(new ComponentName(getContext(), WeatherWidgetProvider.class));
        JSObject result = new JSObject();
        result.put("count", ids.length);
        call.resolve(result);
    }

    /** Opens the widget's settings screen (style, background incl. transparent, layout, city). */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(getContext(), WidgetConfigActivity.class);
        intent.putExtra(WidgetConfigActivity.EXTRA_FROM_APP, true);
        getActivity().startActivity(intent);
        call.resolve();
    }

    /**
     * Asks Android to add the widget to the home screen, on demand — unlike offerPin, which
     * is a one-time first-run nudge, this is what an explicit "Add widget" button calls.
     * Resolves {supported:false} where the launcher can't pin widgets (the user then has to
     * add it from the widget picker themselves).
     */
    @PluginMethod
    public void requestPin(PluginCall call) {
        boolean supported = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
            if (mgr.isRequestPinAppWidgetSupported()) {
                supported = mgr.requestPinAppWidget(new ComponentName(getContext(), WeatherWidgetProvider.class), null, null);
            }
        }
        JSObject result = new JSObject();
        result.put("supported", supported);
        call.resolve(result);
    }
}
