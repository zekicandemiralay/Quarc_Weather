package com.quarc.weather;

/**
 * Colour decisions for the widget: which sky mood a weather code means (the
 * same mapping the web app uses), what each solid background is, and what text
 * colour reads on top of it. Pure arithmetic — no android.* types — so it can
 * be unit-tested on a plain JVM.
 */
final class WidgetPalette {
    private WidgetPalette() {}

    static final int WHITE = 0xFFFFFFFF;
    static final int INK = 0xFF0F172A; // text on light backgrounds

    static final int SOLID_DARK = 0xFF111827;
    static final int SOLID_LIGHT = 0xFFF8FAFC;
    static final int SOLID_GLASS = 0xFF0F172A;

    /** The moods the app's sky gradients come in — one drawable each, day and night. */
    static final String[] SKY_BUCKETS = { "clear", "partly", "cloudy", "fog", "rain", "snow", "storm", "hot" };

    /**
     * Mirrors frontend/src/lib/weatherCodes.js (skyBucketFor): the WMO weather
     * code decides the mood, except that a scorching clear day (>= 32 C) turns
     * warm. `tempC` is Celsius whatever unit the user displays; NaN = unknown.
     */
    static String skyBucket(int code, double tempC) {
        String sky;
        switch (code) {
            case 0: case 1: sky = "clear"; break;
            case 2: sky = "partly"; break;
            case 45: case 48: sky = "fog"; break;
            case 51: case 53: case 55:
            case 61: case 63: case 65:
            case 80: case 81:
                sky = "rain"; break;
            case 56: case 57: case 66: case 67:
            case 71: case 73: case 75: case 77:
            case 85: case 86:
                sky = "snow"; break;
            case 82: case 95: case 96: case 99: sky = "storm"; break;
            default: sky = "cloudy"; // 3, and anything unrecognised
        }
        return "clear".equals(sky) && !Double.isNaN(tempC) && tempC >= 32 ? "hot" : sky;
    }

    /** The flat colour behind a non-sky, non-transparent background. */
    static int solidColor(WidgetSettings.Background background, int customColor) {
        switch (background) {
            case LIGHT: return SOLID_LIGHT;
            case GLASS: return SOLID_GLASS;
            case COLOR: return customColor | 0xFF000000;
            default: return SOLID_DARK;
        }
    }

    /** Text colour for a background + the user's tone choice. AUTO goes light on everything
     *  except backgrounds that are themselves light. */
    static int textColor(WidgetSettings.Background background, WidgetSettings.TextTone tone, int customColor) {
        if (tone == WidgetSettings.TextTone.LIGHT) return WHITE;
        if (tone == WidgetSettings.TextTone.DARK) return INK;
        switch (background) {
            case LIGHT: return INK;
            case COLOR: return isLight(customColor) ? INK : WHITE;
            default: return WHITE; // sky, dark, glass, transparent (over a wallpaper, white + shadow is the safest default)
        }
    }

    /** Dimmer text for secondary lines (condition, high/low, hour labels). */
    static int secondary(int textColor) {
        return (textColor & 0x00FFFFFF) | 0xCC000000;
    }

    /** True when black text would read better than white on this colour (WCAG relative luminance). */
    static boolean isLight(int argb) {
        double r = channel((argb >> 16) & 0xFF);
        double g = channel((argb >> 8) & 0xFF);
        double b = channel(argb & 0xFF);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
    }

    private static double channel(int c8) {
        double c = c8 / 255.0;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    /** 0..100 percent opacity as the 0..255 alpha Android wants. */
    static int alphaFromPercent(int percent) {
        int p = WidgetSettings.clampOpacity(percent);
        return Math.round(p * 255f / 100f);
    }
}
