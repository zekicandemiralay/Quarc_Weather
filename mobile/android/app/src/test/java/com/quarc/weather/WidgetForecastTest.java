package com.quarc.weather;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Locale;

/**
 * The widget now fetches its own weather from Open-Meteo, so what it does with a response is checked here on
 * a plain JVM: the hourly strip (starts at the CITY's current hour, never the phone's), today's high and low,
 * the units, and the entry's compatibility with the parser the renderer already uses.
 *
 * src/test/resources/open-meteo-istanbul.json is a real response for the exact request WidgetForecast.url()
 * builds (current.time is 11:30 in Istanbul).
 */
public class WidgetForecastTest {

    private static final WidgetCities.Place ISTANBUL = new WidgetCities.Place("c_4101_2898", "Istanbul", 41.0082, 28.9784, false);

    private static JSONObject fixture() throws Exception {
        try (InputStream in = WidgetForecastTest.class.getResourceAsStream("/open-meteo-istanbul.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return new JSONObject(out.toString("UTF-8"));
        }
    }

    // --- the request ----------------------------------------------------------------------------

    @Test
    public void theRequestAsksForExactlyWhatTheWidgetDraws() {
        String url = WidgetForecast.url(ISTANBUL, false);
        assertTrue(url, url.startsWith("https://api.open-meteo.com/v1/forecast?"));
        assertTrue(url, url.contains("latitude=41.0082"));
        assertTrue(url, url.contains("longitude=28.9784"));
        assertTrue(url, url.contains("current=temperature_2m,weather_code,is_day"));
        assertTrue(url, url.contains("hourly=temperature_2m,weather_code,is_day"));
        assertTrue(url, url.contains("daily=temperature_2m_max,temperature_2m_min"));
        assertTrue(url, url.contains("timezone=auto"));
        assertTrue(url, url.contains("temperature_unit=celsius"));
        assertTrue(WidgetForecast.url(ISTANBUL, true).contains("temperature_unit=fahrenheit"));
    }

    @Test
    public void coordinatesNeverGetALocaleDecimalComma() {
        Locale before = Locale.getDefault();
        try {
            Locale.setDefault(new Locale("tr", "TR")); // formats 41.0082 as "41,0082" unless told otherwise
            String url = WidgetForecast.url(ISTANBUL, false);
            assertTrue(url, url.contains("latitude=41.0082"));
            assertFalse(url, url.contains("41,0082"));
        } finally {
            Locale.setDefault(before);
        }
    }

    // --- the hourly strip -----------------------------------------------------------------------

    @Test
    public void theStripStartsAtTheCitysCurrentHour() throws Exception {
        JSONObject entry = WidgetForecast.entry(ISTANBUL, fixture());
        JSONArray hours = entry.getJSONArray("next_hours");
        assertEquals(WidgetForecast.HOURS, hours.length());
        // current.time is 11:30 in Istanbul → the strip starts at 11:00, whatever zone the phone is in.
        assertEquals("2026-11-23T11:00", hours.getJSONObject(0).getString("time"));
        assertEquals("2026-11-23T12:00", hours.getJSONObject(1).getString("time"));
        assertEquals("2026-11-23T16:00", hours.getJSONObject(5).getString("time"));
    }

    @Test
    public void hourTimestampsAreCopiedVerbatimNeverReinterpretedInThePhonesZone() throws Exception {
        JSONObject fc = fixture();
        JSONArray source = fc.getJSONObject("hourly").getJSONArray("time");
        JSONArray hours = WidgetForecast.entry(ISTANBUL, fc).getJSONArray("next_hours");
        for (int i = 0; i < hours.length(); i++) {
            String t = hours.getJSONObject(i).getString("time");
            boolean found = false;
            for (int j = 0; j < source.length(); j++) if (t.equals(source.getString(j))) found = true;
            assertTrue("not one of the provider's own timestamps: " + t, found);
            assertTrue(t, t.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:00"));
        }
    }

    @Test
    public void aLateEveningStripRunsPastMidnightIntoTomorrow() throws Exception {
        JSONObject fc = new JSONObject("{"
            + "\"current\":{\"time\":\"2026-11-23T22:30\",\"temperature_2m\":9.0,\"weather_code\":3,\"is_day\":0},"
            + "\"hourly\":{\"time\":[\"2026-11-23T21:00\",\"2026-11-23T22:00\",\"2026-11-23T23:00\",\"2026-11-24T00:00\",\"2026-11-24T01:00\",\"2026-11-24T02:00\",\"2026-11-24T03:00\",\"2026-11-24T04:00\"],"
            + "\"weather_code\":[3,3,3,61,61,3,3,3],\"temperature_2m\":[10,9,9,8,8,7,7,6],\"is_day\":[0,0,0,0,0,0,0,0]}}");
        JSONArray hours = WidgetForecast.entry(ISTANBUL, fc).getJSONArray("next_hours");
        assertEquals(6, hours.length());
        assertEquals("2026-11-23T22:00", hours.getJSONObject(0).getString("time"));
        assertEquals("2026-11-24T00:00", hours.getJSONObject(2).getString("time"));
        assertEquals(61, hours.getJSONObject(2).getInt("weather_code"));
        assertEquals("2026-11-24T03:00", hours.getJSONObject(5).getString("time"));
    }

    @Test
    public void whenTheCitysNowIsUnknownTheStripStartsFromTheFirstHour() throws Exception {
        JSONObject hourly = fixture().getJSONObject("hourly");
        JSONArray hours = WidgetForecast.nextHours(hourly, null, 3);
        assertEquals(3, hours.length());
        assertEquals("2026-11-23T00:00", hours.getJSONObject(0).getString("time"));
    }

    @Test
    public void whenEveryHourIsInThePastTheStripStillShowsSomething() throws Exception {
        JSONObject hourly = fixture().getJSONObject("hourly");
        JSONArray hours = WidgetForecast.nextHours(hourly, "2099-01-01T00:00", 6);
        assertEquals(6, hours.length());
    }

    @Test
    public void theStripNeverRunsOffTheEndOfTheData() throws Exception {
        JSONObject hourly = fixture().getJSONObject("hourly");
        JSONArray times = hourly.getJSONArray("time");
        String last = times.getString(times.length() - 1);
        JSONArray hours = WidgetForecast.nextHours(hourly, last, 6);
        assertEquals(1, hours.length());
        assertEquals(last, hours.getJSONObject(0).getString("time"));
    }

    // --- the rest of the entry ------------------------------------------------------------------

    @Test
    public void todayIsTheFirstDayAndCarriesTheHighAndLow() throws Exception {
        JSONObject fc = fixture();
        JSONObject today = WidgetForecast.entry(ISTANBUL, fc).getJSONObject("today");
        JSONObject daily = fc.getJSONObject("daily");
        assertEquals(daily.getJSONArray("temperature_2m_max").getDouble(0), today.getDouble("temperature_2m_max"), 0.001);
        assertEquals(daily.getJSONArray("temperature_2m_min").getDouble(0), today.getDouble("temperature_2m_min"), 0.001);
    }

    @Test
    public void theEntryKeepsTheCurrentConditionsUnitsAndZone() throws Exception {
        JSONObject entry = WidgetForecast.entry(ISTANBUL, fixture());
        assertEquals("c_4101_2898", entry.getString("id"));
        assertEquals("Istanbul", entry.getString("name"));
        assertEquals(0, entry.getInt("is_current_location"));
        assertEquals(17.6, entry.getJSONObject("current").getDouble("temperature_2m"), 0.001);
        assertEquals("°C", entry.getJSONObject("current_units").getString("temperature_2m"));
        assertEquals("Europe/Istanbul", entry.getString("timezone"));
    }

    @Test
    public void myLocationIsFlaggedSoTheRendererPinsIt() throws Exception {
        WidgetCities.Place here = new WidgetCities.Place("here", "Cankurtaran", 41.0, 28.9, true);
        assertEquals(1, WidgetForecast.entry(here, fixture()).getInt("is_current_location"));
    }

    @Test
    public void aResponseMissingPiecesNeverCrashes() throws Exception {
        JSONObject entry = WidgetForecast.entry(ISTANBUL, new JSONObject("{}"));
        assertFalse(entry.has("current"));
        assertEquals(0, entry.getJSONArray("next_hours").length());
        assertFalse(entry.has("today"));
    }

    // --- compatibility with the parser the renderer uses ----------------------------------------

    @Test
    public void theEntryReadsBackThroughTheExistingParser() throws Exception {
        JSONObject fc = fixture();
        String overview = new JSONArray().put(WidgetForecast.entry(ISTANBUL, fc)).toString();
        List<WidgetData.City> cities = WidgetData.parse(overview);
        assertEquals(1, cities.size());
        WidgetData.City c = cities.get(0);
        assertEquals("c_4101_2898", c.id);
        assertEquals("Istanbul", c.name);
        assertFalse(c.isPin);
        assertEquals(17.6f, c.temp, 0.001f);
        assertEquals(17.6, c.tempC, 0.001);
        assertEquals(2, c.code);
        assertTrue(c.isDay);
        assertEquals(6, c.hours.size());
        assertEquals("2026-11-23T11:00", c.hours.get(0).time);
        assertEquals((float) fc.getJSONObject("daily").getJSONArray("temperature_2m_max").getDouble(0), c.hi, 0.001f);
    }

    @Test
    public void fahrenheitResponsesStillGiveACelsiusMoodTemperature() throws Exception {
        JSONObject fc = fixture();
        fc.getJSONObject("current").put("temperature_2m", 64.0);
        fc.getJSONObject("current_units").put("temperature_2m", "°F");
        WidgetData.City c = WidgetData.parse(new JSONArray().put(WidgetForecast.entry(ISTANBUL, fc)).toString()).get(0);
        assertEquals(64f, c.temp, 0.001f); // shown as asked
        assertEquals(17.78, c.tempC, 0.01); // the sky mood still works in Celsius
    }

    @Test
    public void aCityWithNoCurrentConditionsParsesAsUnknownNotAsZero() throws Exception {
        WidgetData.City c = WidgetData.parse(new JSONArray().put(WidgetForecast.entry(ISTANBUL, new JSONObject("{}"))).toString()).get(0);
        assertTrue(Float.isNaN(c.temp));
        assertTrue(Double.isNaN(c.tempC));
    }
}
