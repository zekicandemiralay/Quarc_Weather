package com.quarc.weather;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Persists each placed widget's WidgetSettings, keyed by its appWidgetId — so
 * two widgets on the same home screen can look completely different.
 */
final class WidgetPrefs {
    private WidgetPrefs() {}

    private static final String PREFS = "quarc_weather_widget_settings";

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String key(int widgetId, String field) {
        return "w" + widgetId + "." + field;
    }

    /** Never null: a widget that has never been configured simply gets the defaults. */
    static WidgetSettings load(Context context, int widgetId) {
        SharedPreferences p = prefs(context);
        WidgetSettings s = WidgetSettings.defaults();
        s.layout = WidgetSettings.parseEnum(WidgetSettings.Layout.class, p.getString(key(widgetId, "layout"), null), s.layout);
        s.background = WidgetSettings.parseEnum(WidgetSettings.Background.class, p.getString(key(widgetId, "background"), null), s.background);
        s.text = WidgetSettings.parseEnum(WidgetSettings.TextTone.class, p.getString(key(widgetId, "text"), null), s.text);
        s.opacity = WidgetSettings.clampOpacity(p.getInt(key(widgetId, "opacity"), s.opacity));
        s.color = p.getInt(key(widgetId, "color"), s.color);
        s.cityId = p.getString(key(widgetId, "city"), "");
        return s;
    }

    static void save(Context context, int widgetId, WidgetSettings s) {
        prefs(context).edit()
            .putString(key(widgetId, "layout"), s.layout.name())
            .putString(key(widgetId, "background"), s.background.name())
            .putString(key(widgetId, "text"), s.text.name())
            .putInt(key(widgetId, "opacity"), WidgetSettings.clampOpacity(s.opacity))
            .putInt(key(widgetId, "color"), s.color)
            .putString(key(widgetId, "city"), s.cityId == null ? "" : s.cityId)
            .apply();
    }

    /** Called when the user removes widgets from the home screen. */
    static void delete(Context context, int[] widgetIds) {
        SharedPreferences.Editor e = prefs(context).edit();
        for (int id : widgetIds) {
            for (String field : new String[] { "layout", "background", "text", "opacity", "color", "city" }) {
                e.remove(key(id, field));
            }
        }
        e.apply();
    }
}
