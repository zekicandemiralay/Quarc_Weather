package com.quarc.weather;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import java.util.List;

/**
 * Turns (settings + data + size) into the RemoteViews a widget shows.
 *
 * The same {@link #build} serves the home-screen widget AND the live preview on
 * the settings screen, so the preview is the real thing, not a look-alike.
 *
 * The decisions (which layout, which colours, how many hours) are made by the
 * android-free WidgetLayoutSpec / WidgetPalette / WidgetSettings, which are
 * unit-tested; this class only applies them to views.
 */
final class WidgetRenderer {
    private WidgetRenderer() {}

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

    /** Repaints one placed widget from the cache, using its own saved settings and its current size. */
    static void update(Context context, AppWidgetManager manager, int widgetId) {
        WidgetSettings settings = WidgetPrefs.load(context, widgetId);
        String state = WidgetCache.state(context);
        WidgetData.City city = null;

        if (WidgetCache.STATE_OK.equals(state)) {
            city = WidgetData.pick(WidgetData.parse(WidgetCache.overviewJson(context)), settings.cityId);
            if (city == null) state = WidgetCache.STATE_EMPTY;
        }

        int[] size = sizeDp(context, manager.getAppWidgetOptions(widgetId));
        manager.updateAppWidget(widgetId, build(context, settings, state, city, size[0], size[1], true));
    }

    /** The widget's size in dp as the launcher reports it ({0,0} when it hasn't yet). */
    static int[] sizeDp(Context context, Bundle options) {
        if (options == null) return new int[] { 0, 0 };
        boolean landscape = context.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        // The launcher gives a min and a max for each axis (the widget's size when the device is
        // held either way up): portrait is min-width x max-height, landscape is max-width x min-height.
        int w = options.getInt(landscape
            ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = options.getInt(landscape
            ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        return new int[] { w, h };
    }

    /**
     * @param interactive true for the real widget (tapping it opens the app); false for the preview
     */
    static RemoteViews build(Context context, WidgetSettings s, String state, WidgetData.City city,
                             int widthDp, int heightDp, boolean interactive) {
        WidgetLayoutSpec spec = WidgetLayoutSpec.compute(s.layout, widthDp, heightDp);
        RemoteViews v = new RemoteViews(context.getPackageName(), layoutFor(spec.mode));

        boolean ok = WidgetCache.STATE_OK.equals(state) && city != null;
        String bucket = ok ? WidgetPalette.skyBucket(city.code, city.tempC) : "cloudy";
        boolean day = !ok || city.isDay;

        applyBackground(v, s, bucket, day);

        int fg = WidgetPalette.textColor(s.background, s.text, s.color);
        int fg2 = WidgetPalette.secondary(fg);

        if (interactive) attachOpenApp(context, v);

        if (!ok) {
            int message = WidgetCache.STATE_SIGNED_OUT.equals(state) ? R.string.widget_signed_out
                : WidgetCache.STATE_EMPTY.equals(state) ? R.string.widget_no_cities
                : R.string.widget_loading;
            v.setTextViewText(R.id.widget_message, context.getString(message));
            v.setTextColor(R.id.widget_message, fg);
            v.setViewVisibility(R.id.widget_message, View.VISIBLE);
            v.setViewVisibility(R.id.widget_data, View.GONE);
            return v;
        }

        v.setViewVisibility(R.id.widget_message, View.GONE);
        v.setViewVisibility(R.id.widget_data, View.VISIBLE);

        // --- the current conditions ---
        v.setTextViewText(R.id.widget_city, city.name);
        v.setTextColor(R.id.widget_city, fg);
        v.setViewVisibility(R.id.widget_location_icon, city.isPin ? View.VISIBLE : View.GONE);
        v.setInt(R.id.widget_location_icon, "setColorFilter", fg);

        v.setTextViewText(R.id.widget_temp, formatTemp(city.temp));
        v.setTextColor(R.id.widget_temp, fg);
        v.setTextViewTextSize(R.id.widget_temp, TypedValue.COMPLEX_UNIT_SP, spec.tempSp);

        v.setTextViewText(R.id.widget_icon, WeatherLabels.emojiFor(city.code, city.isDay));
        v.setTextViewText(R.id.widget_condition, WeatherLabels.labelFor(city.code));
        v.setTextColor(R.id.widget_condition, fg2);
        v.setTextViewText(R.id.widget_hilo, "H:" + formatTemp(city.hi) + "  L:" + formatTemp(city.lo));
        v.setTextColor(R.id.widget_hilo, fg2);
        v.setViewVisibility(R.id.widget_hilo, spec.showHiLo ? View.VISIBLE : View.GONE);

        if (spec.mode == WidgetLayoutSpec.Mode.SINGLE_ROW) {
            // The icon scales with the temperature so the two stay in proportion at any height.
            v.setTextViewTextSize(R.id.widget_icon, TypedValue.COMPLEX_UNIT_SP, Math.round(spec.tempSp * 0.8f));
            v.setViewVisibility(R.id.widget_text_col, spec.showTextColumn ? View.VISIBLE : View.GONE);
        }

        // --- the hourly strip ---
        v.setViewVisibility(R.id.widget_hourly, spec.hourColumns > 0 ? View.VISIBLE : View.GONE);
        List<WidgetData.Hour> hours = city.hours;
        for (int i = 0; i < HOUR_COL_IDS.length; i++) {
            boolean show = i < spec.hourColumns && i < hours.size();
            v.setViewVisibility(HOUR_COL_IDS[i], show ? View.VISIBLE : View.GONE);
            if (!show) continue;
            WidgetData.Hour h = hours.get(i);
            v.setTextViewText(HOUR_TIME_IDS[i], wallClockTime(h.time));
            v.setTextColor(HOUR_TIME_IDS[i], fg2);
            v.setTextViewText(HOUR_ICON_IDS[i], WeatherLabels.emojiFor(h.code, h.isDay));
            v.setTextViewText(HOUR_TEMP_IDS[i], formatTemp(h.temp));
            v.setTextColor(HOUR_TEMP_IDS[i], fg);
        }
        return v;
    }

    private static int layoutFor(WidgetLayoutSpec.Mode mode) {
        switch (mode) {
            case SINGLE_ROW: return R.layout.weather_widget_single_row;
            case COMPACT: return R.layout.weather_widget_compact;
            default: return R.layout.weather_widget;
        }
    }

    /**
     * Sky = the app's own gradient for the current conditions; everything else is one white
     * rounded shape tinted to a colour; Transparent draws no background at all. Opacity is
     * applied to the background only — never the text — so a faded widget stays readable.
     */
    private static void applyBackground(RemoteViews v, WidgetSettings s, String bucket, boolean day) {
        if (s.background == WidgetSettings.Background.TRANSPARENT) {
            v.setViewVisibility(R.id.widget_bg, View.GONE);
            v.setViewVisibility(R.id.widget_border, View.GONE);
            return;
        }

        if (s.background == WidgetSettings.Background.SKY) {
            v.setImageViewResource(R.id.widget_bg, skyDrawable(bucket, day));
        } else {
            v.setImageViewResource(R.id.widget_bg, R.drawable.widget_bg_solid);
            v.setInt(R.id.widget_bg, "setColorFilter", WidgetPalette.solidColor(s.background, s.color));
        }
        v.setInt(R.id.widget_bg, "setImageAlpha", WidgetPalette.alphaFromPercent(s.opacity));
        v.setViewVisibility(R.id.widget_bg, View.VISIBLE);
        v.setViewVisibility(R.id.widget_border, s.background == WidgetSettings.Background.GLASS ? View.VISIBLE : View.GONE);
    }

    /** Explicit lookup (not getIdentifier) so a missing drawable is a compile error, not a runtime blank. */
    static int skyDrawable(String bucket, boolean day) {
        switch (bucket) {
            case "clear": return day ? R.drawable.widget_bg_sky_clear_day : R.drawable.widget_bg_sky_clear_night;
            case "partly": return day ? R.drawable.widget_bg_sky_partly_day : R.drawable.widget_bg_sky_partly_night;
            case "fog": return day ? R.drawable.widget_bg_sky_fog_day : R.drawable.widget_bg_sky_fog_night;
            case "rain": return day ? R.drawable.widget_bg_sky_rain_day : R.drawable.widget_bg_sky_rain_night;
            case "snow": return day ? R.drawable.widget_bg_sky_snow_day : R.drawable.widget_bg_sky_snow_night;
            case "storm": return day ? R.drawable.widget_bg_sky_storm_day : R.drawable.widget_bg_sky_storm_night;
            case "hot": return day ? R.drawable.widget_bg_sky_hot_day : R.drawable.widget_bg_sky_hot_night;
            default: return day ? R.drawable.widget_bg_sky_cloudy_day : R.drawable.widget_bg_sky_cloudy_night;
        }
    }

    private static void attachOpenApp(Context context, RemoteViews v) {
        Intent openApp = new Intent(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, openApp, flags));
    }

    /**
     * Open-Meteo's hourly.time strings are NAIVE local wall-clock for the city's own timezone
     * ("2026-08-30T14:00" means 14:00 in that city, whatever this device's zone is). Parsing it
     * into a Date/Calendar would silently re-interpret the digits in the DEVICE's zone and shift
     * every hour shown, so the "HH:mm" part is read straight out of the string — always 24-hour,
     * matching the rest of the app.
     */
    static String wallClockTime(String iso) {
        if (iso == null || iso.length() < 16) return "--:--";
        return iso.substring(11, 16);
    }

    static String formatTemp(float value) {
        return Float.isNaN(value) ? "--°" : Math.round(value) + "°";
    }
}
