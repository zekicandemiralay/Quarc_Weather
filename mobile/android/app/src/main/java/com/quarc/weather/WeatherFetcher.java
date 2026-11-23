package com.quarc.weather;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/**
 * Fetches the weather for the widget and the morning briefing straight from Open-Meteo — from the phone,
 * with no Quarc server in between (so no Tailscale needed) and no API key (Open-Meteo is keyless for
 * non-commercial use). Shared by {@link WeatherWidgetWorker} and {@link DailyBriefingWorker}.
 */
final class WeatherFetcher {
    private WeatherFetcher() {}

    private static final int TIMEOUT_MS = 12000;

    /** What a refresh produced: one entry per place, and how many of them are genuinely fresh. */
    static final class Result {
        final JSONArray entries = new JSONArray();
        int fresh = 0;
    }

    /**
     * Fetches every place. One city that can't be reached must not blank the widget, so it keeps its previous
     * entry (marked with the new name, in case that changed) or, if it never had one, an empty placeholder.
     */
    static Result fetchAll(List<WidgetCities.Place> places, boolean fahrenheit, JSONArray previous) {
        Result result = new Result();
        for (WidgetCities.Place place : places) {
            try {
                result.entries.put(fetchOne(place, fahrenheit));
                result.fresh++;
            } catch (Exception e) {
                result.entries.put(stale(place, previous));
            }
        }
        return result;
    }

    static JSONObject fetchOne(WidgetCities.Place place, boolean fahrenheit) throws Exception {
        String body = httpGet(WidgetForecast.url(place, fahrenheit));
        return WidgetForecast.entry(place, new JSONObject(body));
    }

    private static JSONObject stale(WidgetCities.Place place, JSONArray previous) {
        try {
            if (previous != null) {
                for (int i = 0; i < previous.length(); i++) {
                    JSONObject old = previous.optJSONObject(i);
                    if (old != null && place.id.equals(old.optString("id", null))) {
                        old.put("name", place.name);
                        old.put("is_current_location", place.isPin ? 1 : 0);
                        return old;
                    }
                }
            }
            JSONObject o = new JSONObject();
            o.put("id", place.id);
            o.put("name", place.name);
            o.put("is_current_location", place.isPin ? 1 : 0);
            o.put("next_hours", new JSONArray());
            return o;
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static String httpGet(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            int code = conn.getResponseCode();
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
}
