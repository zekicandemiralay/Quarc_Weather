package com.quarc.weather;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The slice of /api/weather/overview the widget draws, one {@link City} per
 * saved city. Parsing never throws — a malformed or partial response yields
 * fewer cities rather than a crashed widget.
 */
final class WidgetData {
    private WidgetData() {}

    static final class Hour {
        /** Open-Meteo's naive local wall-clock string for the CITY ("2026-08-30T14:00"). */
        final String time;
        final int code;
        final boolean isDay;
        final float temp;

        Hour(String time, int code, boolean isDay, float temp) {
            this.time = time;
            this.code = code;
            this.isDay = isDay;
            this.temp = temp;
        }
    }

    static final class City {
        String id = "";
        String name = "—";
        boolean isPin;
        float temp = Float.NaN;
        /** The same temperature in Celsius whatever unit is displayed (the sky mood depends on it). */
        double tempC = Double.NaN;
        int code = 3;
        boolean isDay = true;
        float hi = Float.NaN;
        float lo = Float.NaN;
        List<Hour> hours = new ArrayList<>();
    }

    static List<City> parse(String overviewJson) {
        List<City> out = new ArrayList<>();
        JSONArray arr;
        try {
            arr = new JSONArray(overviewJson);
        } catch (Exception e) {
            return out;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            City c = new City();
            c.id = o.optString("id", "");
            c.name = o.optString("name", "—");
            c.isPin = o.optInt("is_current_location", 0) == 1;

            JSONObject current = o.optJSONObject("current");
            if (current != null) {
                c.temp = (float) current.optDouble("temperature_2m", Double.NaN);
                c.code = current.optInt("weather_code", 3);
                c.isDay = current.optInt("is_day", 1) == 1;
            }
            JSONObject units = o.optJSONObject("current_units");
            boolean fahrenheit = units != null && units.optString("temperature_2m", "").contains("F");
            c.tempC = Float.isNaN(c.temp) ? Double.NaN : (fahrenheit ? (c.temp - 32) * 5.0 / 9.0 : c.temp);

            JSONObject today = o.optJSONObject("today");
            if (today != null) {
                c.hi = (float) today.optDouble("temperature_2m_max", Double.NaN);
                c.lo = (float) today.optDouble("temperature_2m_min", Double.NaN);
            }

            JSONArray hours = o.optJSONArray("next_hours");
            if (hours != null) {
                for (int h = 0; h < hours.length(); h++) {
                    JSONObject ho = hours.optJSONObject(h);
                    if (ho == null) continue;
                    c.hours.add(new Hour(
                        ho.optString("time", ""),
                        ho.optInt("weather_code", 3),
                        ho.optInt("is_day", 1) == 1,
                        (float) ho.optDouble("temperature_2m", Double.NaN)));
                }
            }
            out.add(c);
        }
        return out;
    }

    /** The city a widget was set to, or the first in the list (My Location sorts first) if it's
     *  unset or no longer exists — a widget pointing at a deleted city should still show something. */
    static City pick(List<City> cities, String cityId) {
        if (cities == null || cities.isEmpty()) return null;
        if (cityId != null && !cityId.isEmpty()) {
            for (City c : cities) if (cityId.equals(c.id)) return c;
        }
        return cities.get(0);
    }

    /** Stand-in data so the settings preview shows something real-looking before the first refresh. */
    static City sample(String name) {
        City c = new City();
        c.name = name;
        c.isPin = true;
        c.temp = 18;
        c.tempC = 18;
        c.code = 2;
        c.isDay = true;
        c.hi = 21;
        c.lo = 13;
        int[] codes = { 2, 2, 3, 61, 61, 3 };
        float[] temps = { 18, 19, 19, 17, 16, 15 };
        for (int i = 0; i < codes.length; i++) {
            // Locale.ROOT: this is a machine-readable timestamp, never a localised number.
            c.hours.add(new Hour(String.format(Locale.ROOT, "2026-01-01T%02d:00", 14 + i), codes[i], true, temps[i]));
        }
        return c;
    }
}
