package com.quarc.weather;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

/**
 * Does the actual work behind the widget: an independent HTTPS call to
 * /api/weather/overview using the session token WidgetBridgePlugin stashed
 * in SharedPreferences, then renders the result (or the last cached result,
 * on any failure) into RemoteViews.
 *
 * Runs entirely outside the WebView/app process — this is what lets the
 * widget stay fresh even when the app itself hasn't been opened in hours.
 */
public class WeatherWidgetWorker extends Worker {

    private static final String CACHE_PREFS = "quarc_weather_widget_cache";
    private static final String KEY_STATE = "state"; // "ok" | "signed_out" | "loading"
    private static final String KEY_NAME = "name";
    private static final String KEY_PIN = "is_pin";
    private static final String KEY_TEMP = "temp";
    private static final String KEY_COND = "condition";
    private static final String KEY_IS_DAY = "is_day";
    private static final String KEY_HI = "hi";
    private static final String KEY_LO = "lo";
    private static final String KEY_HOURLY = "hourly_json"; // raw next_hours JSON array

    private static final int[] HOUR_COL_IDS = {
        R.id.widget_h0, R.id.widget_h1, R.id.widget_h2, R.id.widget_h3, R.id.widget_h4, R.id.widget_h5,
    };
    private static final int[] HOUR_TIME_IDS = {
        R.id.widget_h0_time, R.id.widget_h1_time, R.id.widget_h2_time,
        R.id.widget_h3_time, R.id.widget_h4_time, R.id.widget_h5_time,
    };
    private static final int[] HOUR_ICON_IDS = {
        R.id.widget_h0_icon, R.id.widget_h1_icon, R.id.widget_h2_icon,
        R.id.widget_h3_icon, R.id.widget_h4_icon, R.id.widget_h5_icon,
    };
    private static final int[] HOUR_TEMP_IDS = {
        R.id.widget_h0_temp, R.id.widget_h1_temp, R.id.widget_h2_temp,
        R.id.widget_h3_temp, R.id.widget_h4_temp, R.id.widget_h5_temp,
    };

    private static final String PERIODIC_WORK_NAME = "quarc_weather_widget_refresh";
    private static final String ONE_TIME_WORK_NAME = "quarc_weather_widget_refresh_now";

    // WorkManager clamps anything shorter than 15 minutes anyway; 45 keeps
    // the widget reasonably fresh without hammering the server or battery.
    private static final long PERIODIC_MINUTES = 45;

    public WeatherWidgetWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    private static class AuthException extends Exception {}

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences session = context.getSharedPreferences(WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE);
        String token = session.getString(WidgetBridgePlugin.KEY_TOKEN, null);
        String server = session.getString(WidgetBridgePlugin.KEY_SERVER, null);

        if (token == null || server == null) {
            writeState(context, "signed_out");
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        }

        try {
            String json = httpGet(server + "/api/weather/overview", token);
            JSONArray cities = new JSONArray(json);
            if (cities.length() == 0) {
                writeState(context, "empty");
            } else {
                cacheCity(context, cities.getJSONObject(0));
            }
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        } catch (AuthException e) {
            writeState(context, "signed_out");
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        } catch (Exception e) {
            // Network hiccup, malformed response, etc. — leave whatever was
            // last successfully cached on screen instead of showing an
            // error; WorkManager retries this on its own backoff schedule.
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.retry();
        }
    }

    private String httpGet(String urlStr, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Cookie", "token=" + token);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);

            int code = conn.getResponseCode();
            if (code == 401) throw new AuthException();
            if (code != 200) throw new Exception("HTTP " + code);

            InputStream in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            in.close();
            return out.toString("UTF-8");
        } finally {
            conn.disconnect();
        }
    }

    private void cacheCity(Context context, JSONObject city) {
        JSONObject current = city.optJSONObject("current");
        JSONObject today = city.optJSONObject("today");
        JSONArray nextHours = city.optJSONArray("next_hours");

        SharedPreferences.Editor cache = context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).edit();
        cache.putString(KEY_STATE, "ok");
        cache.putString(KEY_NAME, city.optString("name", "—"));
        cache.putBoolean(KEY_PIN, city.optInt("is_current_location", 0) == 1);
        cache.putFloat(KEY_TEMP, (float) (current != null ? current.optDouble("temperature_2m", Double.NaN) : Double.NaN));
        cache.putInt(KEY_COND, current != null ? current.optInt("weather_code", 3) : 3);
        cache.putBoolean(KEY_IS_DAY, current == null || current.optInt("is_day", 1) == 1);
        cache.putFloat(KEY_HI, (float) (today != null ? today.optDouble("temperature_2m_max", Double.NaN) : Double.NaN));
        cache.putFloat(KEY_LO, (float) (today != null ? today.optDouble("temperature_2m_min", Double.NaN) : Double.NaN));
        cache.putString(KEY_HOURLY, nextHours != null ? nextHours.toString() : "[]");
        cache.apply();
    }

    private void writeState(Context context, String state) {
        context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).edit().putString(KEY_STATE, state).apply();
    }

    private static int[] widgetIds(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        return mgr.getAppWidgetIds(new ComponentName(context, WeatherWidgetProvider.class));
    }

    /**
     * Renders whatever is currently cached. Used both for the instant first
     * paint right after a widget is placed (before any network round trip
     * has had time to complete) and as the fallback whenever a refresh
     * fails — the widget should degrade to "last known good", never to a
     * blank or broken view.
     */
    static void paintFromCache(Context context, AppWidgetManager mgr, int[] ids) {
        if (ids == null || ids.length == 0) return;

        SharedPreferences cache = context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE);
        String state = cache.getString(KEY_STATE, "loading");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.weather_widget);

        if ("ok".equals(state)) {
            String name = cache.getString(KEY_NAME, "—");
            boolean isPin = cache.getBoolean(KEY_PIN, false);
            float temp = cache.getFloat(KEY_TEMP, Float.NaN);
            int code = cache.getInt(KEY_COND, 3);
            boolean isDay = cache.getBoolean(KEY_IS_DAY, true);
            float hi = cache.getFloat(KEY_HI, Float.NaN);
            float lo = cache.getFloat(KEY_LO, Float.NaN);

            views.setTextViewText(R.id.widget_city, name);
            views.setViewVisibility(R.id.widget_location_icon, isPin ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.widget_temp, formatTemp(temp));
            views.setTextViewText(R.id.widget_icon, WeatherLabels.emojiFor(code, isDay));
            views.setTextViewText(R.id.widget_condition, WeatherLabels.labelFor(code));
            views.setTextViewText(R.id.widget_hilo, "H:" + formatTemp(hi) + "  L:" + formatTemp(lo));
            views.setViewVisibility(R.id.widget_message, View.GONE);
            views.setViewVisibility(R.id.widget_data, View.VISIBLE);

            paintHourly(views, cache.getString(KEY_HOURLY, "[]"));
        } else if ("signed_out".equals(state)) {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_signed_out));
            views.setViewVisibility(R.id.widget_message, View.VISIBLE);
            views.setViewVisibility(R.id.widget_data, View.GONE);
        } else {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_loading));
            views.setViewVisibility(R.id.widget_message, View.VISIBLE);
            views.setViewVisibility(R.id.widget_data, View.GONE);
        }

        WeatherWidgetProvider.apply(context, views);
    }

    /**
     * Fills the 6 fixed hourly-strip columns from a cached next_hours JSON
     * array (see backend's weather.js `nextHours()`). Any column beyond what
     * data is available gets hidden rather than left blank.
     */
    private static void paintHourly(RemoteViews views, String hourlyJson) {
        JSONArray hours;
        try {
            hours = new JSONArray(hourlyJson);
        } catch (Exception e) {
            hours = new JSONArray();
        }
        for (int i = 0; i < HOUR_COL_IDS.length; i++) {
            if (i >= hours.length()) {
                views.setViewVisibility(HOUR_COL_IDS[i], View.GONE);
                continue;
            }
            JSONObject h = hours.optJSONObject(i);
            if (h == null) {
                views.setViewVisibility(HOUR_COL_IDS[i], View.GONE);
                continue;
            }
            int hCode = h.optInt("weather_code", 3);
            boolean hIsDay = h.optInt("is_day", 1) == 1;
            float hTemp = (float) h.optDouble("temperature_2m", Double.NaN);

            views.setViewVisibility(HOUR_COL_IDS[i], View.VISIBLE);
            views.setTextViewText(HOUR_TIME_IDS[i], wallClockTime(h.optString("time", null)));
            views.setTextViewText(HOUR_ICON_IDS[i], WeatherLabels.emojiFor(hCode, hIsDay));
            views.setTextViewText(HOUR_TEMP_IDS[i], formatTemp(hTemp));
        }
    }

    /**
     * Open-Meteo's hourly.time strings are NAIVE local wall-clock for the
     * city's own timezone (e.g. "2026-08-30T14:00" means 14:00 in that city,
     * regardless of what timezone this device is set to) — the backend
     * already resolved them relative to the city's zone. Parsing this into a
     * java.util.Date/Calendar here would silently re-interpret the digits in
     * the DEVICE's zone and shift every hour shown, the same class of bug
     * just fixed on the frontend. Extracting the "HH:mm" substring directly
     * is the correct, zone-free way to read it — always 24-hour, matching
     * the rest of the app.
     */
    private static String wallClockTime(String iso) {
        if (iso == null || iso.length() < 16) return "--:--";
        return iso.substring(11, 16);
    }

    private static String formatTemp(float value) {
        return Float.isNaN(value) ? "--°" : Math.round(value) + "°";
    }

    // --- WorkManager scheduling ---------------------------------------------

    static void schedulePeriodic(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                WeatherWidgetWorker.class, PERIODIC_MINUTES, TimeUnit.MINUTES
            )
            .setConstraints(constraints)
            .build();
        // KEEP — re-enqueuing on every onUpdate() (which fires whenever a
        // widget is resized, etc.) must not reset an already-running schedule.
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancelPeriodic(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME);
    }

    /** An immediate, one-shot refresh — used right after login and right
     *  after a widget is first placed, so it doesn't sit on stale or empty
     *  data until the next periodic cycle happens to run. */
    static void refreshNow(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(WeatherWidgetWorker.class)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context)
            .enqueueUniqueWork(ONE_TIME_WORK_NAME, ExistingWorkPolicy.REPLACE, request);
    }
}
