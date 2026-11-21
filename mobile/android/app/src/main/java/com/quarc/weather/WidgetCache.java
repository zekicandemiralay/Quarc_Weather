package com.quarc.weather;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The last thing WeatherWidgetWorker fetched: the raw /api/weather/overview
 * response (every saved city), plus whether the widget is in a normal,
 * signed-out or empty state. Every placed widget renders from this same cache,
 * each choosing its own city — so a refresh is one request, not one per widget.
 */
final class WidgetCache {
    private WidgetCache() {}

    static final String STATE_OK = "ok";
    static final String STATE_SIGNED_OUT = "signed_out";
    static final String STATE_EMPTY = "empty";
    static final String STATE_LOADING = "loading";

    private static final String PREFS = "quarc_weather_widget_cache";
    private static final String KEY_STATE = "state";
    private static final String KEY_OVERVIEW = "overview_json";

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String state(Context context) {
        return prefs(context).getString(KEY_STATE, STATE_LOADING);
    }

    static String overviewJson(Context context) {
        return prefs(context).getString(KEY_OVERVIEW, "[]");
    }

    static void setState(Context context, String state) {
        prefs(context).edit().putString(KEY_STATE, state).apply();
    }

    /** Stores a fresh overview. An empty list (no saved cities) is its own state. */
    static void saveOverview(Context context, String json, boolean empty) {
        prefs(context).edit()
            .putString(KEY_OVERVIEW, json)
            .putString(KEY_STATE, empty ? STATE_EMPTY : STATE_OK)
            .apply();
    }
}
