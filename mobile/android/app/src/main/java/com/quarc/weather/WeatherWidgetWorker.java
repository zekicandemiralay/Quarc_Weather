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

import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Does the actual work behind the widget: fetches the weather for every place the app last handed over
 * (WidgetBridgePlugin keeps that list in SharedPreferences) straight from Open-Meteo, stores the result in
 * WidgetCache, and asks WidgetRenderer to repaint every placed widget (each draws its own city, in its own
 * style). On any failure it repaints from the last cache instead.
 *
 * No Quarc server and no login token are involved — the phone talks to the weather provider itself, so the
 * widget keeps updating with Tailscale off. And it runs entirely outside the WebView/app process, which is
 * what lets the widget stay fresh even when the app itself hasn't been opened in hours.
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

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences stored = context.getSharedPreferences(WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE);
        String citiesJson = stored.getString(WidgetBridgePlugin.KEY_CITIES, null);

        // Nothing handed over yet (the app was never opened since this version, or the user signed out):
        // the widget says to open the app, there is nothing to fetch.
        if (citiesJson == null) {
            WidgetCache.setState(context, WidgetCache.STATE_SIGNED_OUT);
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        }

        List<WidgetCities.Place> places = WidgetCities.parse(citiesJson);
        if (places.isEmpty()) {
            WidgetCache.saveOverview(context, "[]", true);
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.success();
        }

        boolean fahrenheit = "imperial".equals(stored.getString(WidgetBridgePlugin.KEY_UNITS, "metric"));
        JSONArray previous = null;
        try {
            previous = new JSONArray(WidgetCache.overviewJson(context));
        } catch (Exception ignored) {
            // No usable previous overview — failed cities just get an empty placeholder.
        }

        WeatherFetcher.Result fetched = WeatherFetcher.fetchAll(places, fahrenheit, previous);
        if (fetched.fresh == 0) {
            // Offline, or the provider is down: leave whatever was last cached on screen instead of an
            // error; WorkManager retries on its own backoff schedule.
            paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
            return Result.retry();
        }
        // The whole overview is stored, so each widget can pick (and re-pick) its own city without another request.
        WidgetCache.saveOverview(context, fetched.entries.toString(), false);
        paintFromCache(context, AppWidgetManager.getInstance(context), widgetIds(context));
        return Result.success();
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
