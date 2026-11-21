package com.quarc.weather;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/**
 * The home-screen widget itself. Fetching lives in WeatherWidgetWorker and
 * drawing lives in WidgetRenderer — this class only handles the OS lifecycle
 * callbacks. Every placed instance renders on its own, from its own saved
 * settings (WidgetPrefs) and its own current size.
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

    /**
     * The launcher calls this when the user resizes the widget. A different size can mean a
     * different layout (one row / compact / full), so it has to be redrawn — otherwise a widget
     * dragged smaller would keep its big layout until the next refresh.
     */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                          int appWidgetId, Bundle newOptions) {
        WidgetRenderer.update(context, appWidgetManager, appWidgetId);
    }

    /** A widget was removed from the home screen — its saved look goes with it. */
    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        WidgetPrefs.delete(context, appWidgetIds);
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
}
