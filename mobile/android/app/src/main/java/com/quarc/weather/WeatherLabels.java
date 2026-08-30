package com.quarc.weather;

/**
 * Small English condition label + emoji lookups shared between the
 * home-screen widget and the daily briefing notification, so both describe
 * the same WMO weather code the same way — kept in one place instead of
 * copy-pasted between WeatherWidgetWorker and DailyBriefingWorker, which is
 * how these two surfaces would otherwise silently drift apart over time.
 */
final class WeatherLabels {
    private WeatherLabels() {}

    static String emojiFor(int code, boolean isDay) {
        if (code == 0) return isDay ? "☀️" : "🌙";
        if (code == 1 || code == 2) return isDay ? "⛅" : "☁️";
        if (code == 3) return "☁️";
        if (code == 45 || code == 48) return "🌫️";
        if (code >= 51 && code <= 57) return "🌦️";
        if (code >= 61 && code <= 67) return "🌧️";
        if (code >= 71 && code <= 77) return "❄️";
        if (code >= 80 && code <= 82) return "🌧️";
        if (code == 85 || code == 86) return "🌨️";
        if (code >= 95) return "⛈️";
        return "☁️";
    }

    static String labelFor(int code) {
        switch (code) {
            case 0: return "Clear";
            case 1: return "Mainly clear";
            case 2: return "Partly cloudy";
            case 3: return "Overcast";
            case 45: return "Fog";
            case 48: return "Rime fog";
            case 51: return "Light drizzle";
            case 53: return "Drizzle";
            case 55: return "Heavy drizzle";
            case 56: return "Freezing drizzle";
            case 57: return "Heavy freezing drizzle";
            case 61: return "Light rain";
            case 63: return "Rain";
            case 65: return "Heavy rain";
            case 66: return "Freezing rain";
            case 67: return "Heavy freezing rain";
            case 71: return "Light snow";
            case 73: return "Snow";
            case 75: return "Heavy snow";
            case 77: return "Snow grains";
            case 80: return "Light showers";
            case 81: return "Showers";
            case 82: return "Violent showers";
            case 85: return "Light snow showers";
            case 86: return "Heavy snow showers";
            case 95: return "Thunderstorm";
            case 96: return "Thunderstorm with hail";
            case 99: return "Severe thunderstorm";
            default: return "Overcast";
        }
    }

    /** True for any code representing active rain/drizzle/snow/showers/storm —
     *  used to decide whether the daily briefing mentions upcoming precipitation. */
    static boolean isPrecipitation(int code) {
        return (code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95;
    }
}
