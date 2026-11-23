package com.quarc.weather;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Turns one Open-Meteo forecast response into the entry the widget (and the morning briefing) draw from.
 *
 * The entry has exactly the shape the server's old /api/weather/overview used to produce
 * ({id, name, is_current_location, current, current_units, today, next_hours, timezone}), because
 * {@link WidgetData}, {@link WidgetCache} and {@link WidgetRenderer} were built around that shape — the
 * only thing that changed is WHO fetches the weather: the device does, directly.
 *
 * Open-Meteo's hourly timestamps are NAIVE wall-clock strings in the CITY's own zone ("2026-08-30T14:00").
 * They are only ever compared and copied as strings here — never put through Date/Calendar, which would
 * read the digits as the phone's zone and shift every hour by the gap between the phone and the city.
 * "Now" in the city comes from the response's own current.time for the same reason.
 *
 * No android.* types, so it is tested on a plain JVM.
 */
final class WidgetForecast {
    private WidgetForecast() {}

    /** How many hourly cells the widget's strip can ever show. */
    static final int HOURS = 6;

    private static final String ENDPOINT = "https://api.open-meteo.com/v1/forecast";

    /** The request for one place. forecast_days=2 so a late-evening strip can still run past midnight. */
    static String url(WidgetCities.Place place, boolean fahrenheit) {
        // Locale.ROOT: coordinates are machine text, never "41,0082" because the phone is set to Turkish.
        return ENDPOINT
            + "?latitude=" + String.format(Locale.ROOT, "%.4f", place.latitude)
            + "&longitude=" + String.format(Locale.ROOT, "%.4f", place.longitude)
            + "&current=temperature_2m,weather_code,is_day"
            + "&hourly=temperature_2m,weather_code,is_day"
            + "&daily=temperature_2m_max,temperature_2m_min"
            + "&timezone=auto"
            + "&forecast_days=2"
            + "&temperature_unit=" + (fahrenheit ? "fahrenheit" : "celsius");
    }

    /** The entry for one place, built from its forecast response. */
    static JSONObject entry(WidgetCities.Place place, JSONObject forecast) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", place.id);
        o.put("name", place.name);
        o.put("is_current_location", place.isPin ? 1 : 0);

        JSONObject current = forecast.optJSONObject("current");
        if (current != null) o.put("current", current);
        JSONObject units = forecast.optJSONObject("current_units");
        if (units != null) o.put("current_units", units);

        o.put("next_hours", nextHours(forecast.optJSONObject("hourly"), currentHour(current), HOURS));

        // "Today": with no past_days in the request, today is index 0 of the daily arrays.
        JSONObject daily = forecast.optJSONObject("daily");
        if (daily != null) {
            JSONObject today = new JSONObject();
            today.put("temperature_2m_max", first(daily.optJSONArray("temperature_2m_max")));
            today.put("temperature_2m_min", first(daily.optJSONArray("temperature_2m_min")));
            o.put("today", today);
        }
        o.put("timezone", forecast.optString("timezone", ""));
        return o;
    }

    /** "2026-08-30T14:15" → "2026-08-30T14:00": this hour on the CITY's clock, or null if unknown. */
    static String currentHour(JSONObject current) {
        if (current == null) return null;
        String time = current.optString("time", "");
        return time.length() >= 13 ? time.substring(0, 13) + ":00" : null;
    }

    /**
     * The next {@code count} hours starting at the current hour — the strip's cells. Hours are found by
     * comparing the naive timestamps as strings (same format, so lexical order is chronological order).
     * If the city's "now" is unknown, or later than every hour on offer, it starts from the first hour.
     */
    static JSONArray nextHours(JSONObject hourly, String nowHour, int count) throws JSONException {
        JSONArray out = new JSONArray();
        if (hourly == null) return out;
        JSONArray times = hourly.optJSONArray("time");
        if (times == null || times.length() == 0) return out;

        int start = 0;
        if (nowHour != null) {
            for (int i = 0; i < times.length(); i++) {
                if (times.optString(i, "").compareTo(nowHour) >= 0) {
                    start = i;
                    break;
                }
            }
        }

        JSONArray codes = hourly.optJSONArray("weather_code");
        JSONArray temps = hourly.optJSONArray("temperature_2m");
        JSONArray days = hourly.optJSONArray("is_day");
        for (int i = start; i < times.length() && out.length() < count; i++) {
            JSONObject h = new JSONObject();
            h.put("time", times.optString(i, ""));
            if (codes != null) h.put("weather_code", codes.opt(i));
            if (temps != null) h.put("temperature_2m", temps.opt(i));
            if (days != null) h.put("is_day", days.opt(i));
            out.put(h);
        }
        return out;
    }

    private static Object first(JSONArray a) {
        return a == null || a.length() == 0 ? JSONObject.NULL : a.opt(0);
    }
}
