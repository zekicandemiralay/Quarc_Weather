package com.quarc.weather;

/**
 * What the user picked for ONE placed widget: how much it shows, what's behind
 * it, how the text is coloured, and which city it follows.
 *
 * Deliberately free of any android.* types, so the rules around it can be
 * unit-tested on a plain JVM (see WidgetLogicTest). Persistence lives in
 * WidgetPrefs; rendering lives in WidgetRenderer.
 */
final class WidgetSettings {

    /**
     * How much the widget shows, smallest to largest. AUTO picks by the widget's size (see
     * WidgetLayoutSpec). The declaration order is the order of the chips on the settings screen.
     */
    enum Layout { AUTO, MINIMAL, SINGLE_ROW, COMPACT, FULL }

    /** What sits behind the content. TRANSPARENT draws nothing at all. */
    enum Background { SKY, DARK, LIGHT, GLASS, COLOR, TRANSPARENT }

    /** AUTO chooses light or dark text to suit the background. */
    enum TextTone { AUTO, LIGHT, DARK }

    /** Solid-colour choices for Background.COLOR. */
    static final int[] SWATCHES = {
        0xFF2563EB, // blue
        0xFF4F46E5, // indigo
        0xFF7C3AED, // violet
        0xFFDB2777, // pink
        0xFFDC2626, // red
        0xFFEA580C, // orange
        0xFF16A34A, // green
        0xFF0D9488, // teal
    };

    /** Glass is a see-through tint, so it starts out translucent rather than opaque. */
    static final int GLASS_DEFAULT_OPACITY = 45;

    Layout layout = Layout.AUTO;
    Background background = Background.SKY;
    /** 0..100. Applies to every background except TRANSPARENT (which has none). */
    int opacity = 100;
    TextTone text = TextTone.AUTO;
    int color = SWATCHES[0];
    /** A city id from /api/weather/overview, or "" for "the first one in my list". */
    String cityId = "";

    static WidgetSettings defaults() {
        return new WidgetSettings();
    }

    WidgetSettings copy() {
        WidgetSettings c = new WidgetSettings();
        c.layout = layout;
        c.background = background;
        c.opacity = opacity;
        c.text = text;
        c.color = color;
        c.cityId = cityId;
        return c;
    }

    /** Switching background also moves the opacity somewhere sensible for it. */
    void chooseBackground(Background next) {
        if (next == Background.GLASS && background != Background.GLASS && opacity == 100) {
            opacity = GLASS_DEFAULT_OPACITY;
        } else if (background == Background.GLASS && next != Background.GLASS && opacity == GLASS_DEFAULT_OPACITY) {
            opacity = 100;
        }
        background = next;
    }

    static int clampOpacity(int value) {
        return Math.max(0, Math.min(100, value));
    }

    /** Reads an enum saved by name, falling back (never throwing) on anything unknown — a
     *  value written by a newer or older build must not crash the widget. */
    static <E extends Enum<E>> E parseEnum(Class<E> type, String name, E fallback) {
        if (name == null) return fallback;
        try {
            return Enum.valueOf(type, name);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }
}
