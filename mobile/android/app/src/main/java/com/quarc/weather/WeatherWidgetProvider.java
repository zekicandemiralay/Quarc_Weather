package com.quarc.weather;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * The home-screen widget itself. Actual data fetching and RemoteViews
 * construction live in WeatherWidgetWorker — this class only handles the
 * OS lifecycle callbacks and wires the "tap to open the app" action.
 */
public class WeatherWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // The OS invokes this on its own schedule (a minimum of ~30 minutes,
        // and only ever a suggestion, not a guarantee) — WeatherWidgetWorker's
        // own WorkManager schedule is the real, reliable refresh path. This
        // just makes sure the widget shows *something* immediately: whatever
        // was last cached, plus kicks off a fresh fetch.
        WeatherWidgetWorker.paintFromCache(context, appWidgetManager, appWidgetIds);
        WeatherWidgetWorker.refreshNow(context);
    }

    @Override
    public void onEnabled(Context context) {
        // First widget instance placed on a home screen — start the
        // recurring background refresh.
        WeatherWidgetWorker.schedulePeriodic(context);
    }

    @Override
    public void onDisabled(Context context) {
        // Last widget instance removed — no point refreshing in the
        // background for a widget nobody can see.
        WeatherWidgetWorker.cancelPeriodic(context);
    }

    /** Attaches the "tap opens the app" action and pushes the views to every
     *  placed instance of this widget. Shared by both the cache-paint path
     *  and the network-refresh path so they stay in sync. */
    static void apply(Context context, RemoteViews views) {
        Intent openApp = new Intent(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(context, 0, openApp, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new android.content.ComponentName(context, WeatherWidgetProvider.class));
        for (int id : ids) {
            mgr.updateAppWidget(id, views);
        }
    }
}
