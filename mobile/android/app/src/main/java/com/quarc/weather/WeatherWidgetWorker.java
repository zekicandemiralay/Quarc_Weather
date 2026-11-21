package com.quarc.weather;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

/**
 * Does the actual work behind the widget: an independent HTTPS call to
 * /api/weather/overview using the session token WidgetBridgePlugin stashed
 * in SharedPreferences, stores the whole response in WidgetCache, and asks
 * WidgetRenderer to repaint every placed widget (each draws its own city,
 * in its own style). On any failure it repaints from the last cache instead.
 *
 * Runs entirely outside the WebView/app process — this is what lets the
 * widget stay fresh even when the app itself hasn't been opened in hours.
 */
public class WeatherWidgetWorker extends Worker {

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
            WidgetCache.setState(context, WidgetCache.STATE_SIGNED_OUT);
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        }

        try {
            String json = httpGet(server + "/api/weather/overview", token);
            // Parsed only to learn whether there is anything to show; the raw response is what's
            // stored, so each widget can pick (and re-pick) its own city without another request.
            WidgetCache.saveOverview(context, json, new JSONArray(json).length() == 0);
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        } catch (AuthException e) {
            WidgetCache.setState(context, WidgetCache.STATE_SIGNED_OUT);
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

    private static int[] widgetIds(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        return mgr.getAppWidgetIds(new ComponentName(context, WeatherWidgetProvider.class));
    }

    /**
     * Repaints the given widgets from whatever is currently cached. Used both for the instant
     * first paint right after a widget is placed (before any network round trip has had time to
     * complete) and as the fallback whenever a refresh fails — the widget should degrade to
     * "last known good", never to a blank or broken view.
     */
    static void paintFromCache(Context context, AppWidgetManager mgr, int[] ids) {
        if (ids == null) return;
        for (int id : ids) {
            WidgetRenderer.update(context, mgr, id);
        }
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
