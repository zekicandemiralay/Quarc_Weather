package com.quarc.weather;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The places the home-screen widget and the morning briefing show: the app's saved cities plus this
 * device's My Location, in display order (My Location first). The web app pushes the list through
 * {@link WidgetBridgePlugin} whenever it changes; the background workers then fetch the weather for each
 * place straight from the weather provider — no Quarc server and no login token involved, so the widget
 * keeps working with Tailscale off.
 *
 * No android.* types here so the rules can be tested on a plain JVM. Parsing never throws: a malformed
 * entry is dropped rather than taking the whole widget down with it.
 */
final class WidgetCities {
    private WidgetCities() {}

    static final class Place {
        final String id;
        final String name;
        final double latitude;
        final double longitude;
        /** True for the device's own location (the old "is_current_location" flag the renderer keys on). */
        final boolean isPin;

        Place(String id, String name, double latitude, double longitude, boolean isPin) {
            this.id = id;
            this.name = name;
            this.latitude = latitude;
            this.longitude = longitude;
            this.isPin = isPin;
        }
    }

    /** Parses the stored/pushed list, silently skipping entries that can't be used. */
    static List<Place> parse(String json) {
        List<Place> out = new ArrayList<>();
        if (json == null || json.isEmpty()) return out;
        JSONArray arr;
        try {
            arr = new JSONArray(json);
        } catch (JSONException e) {
            return out;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id", "");
            double lat = o.optDouble("latitude", Double.NaN);
            double lon = o.optDouble("longitude", Double.NaN);
            if (id.isEmpty() || Double.isNaN(lat) || Double.isNaN(lon)) continue;
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
            String name = o.optString("name", "");
            out.add(new Place(id, name.isEmpty() ? "—" : name, lat, lon, o.optBoolean("isPin", false)));
        }
        return out;
    }

    /** The cleaned list back to the JSON that gets stored. */
    static String toJson(List<Place> places) {
        JSONArray arr = new JSONArray();
        for (Place p : places) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", p.id);
                o.put("name", p.name);
                o.put("latitude", p.latitude);
                o.put("longitude", p.longitude);
                o.put("isPin", p.isPin);
                arr.put(o);
            } catch (JSONException ignored) {
                // Only thrown for a non-finite number, which parse() already rejects.
            }
        }
        return arr.toString();
    }
}
