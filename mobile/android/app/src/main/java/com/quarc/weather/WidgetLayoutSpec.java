package com.quarc.weather;

/**
 * Decides, from the widget's actual size on the home screen, what it should
 * show and how big the text should be — so a small widget is a tidy small
 * widget instead of the one big layout stretched over a small space.
 *
 * Three layouts:
 *   SINGLE_ROW  one line: icon, temperature, then city/condition and a few
 *               hours if the width allows. For 1-cell-high widgets.
 *   COMPACT     city, big temperature, condition and high/low. No hourly strip.
 *   FULL        COMPACT plus the hourly strip.
 *
 * Pure arithmetic on dp numbers (no android.* types) so it can be unit-tested.
 * Sizes are in dp; a launcher "cell" is roughly 70dp minus 30dp of margin, so a
 * 4x2 widget is about 250x110 and a 4x1 about 250x40-70.
 */
final class WidgetLayoutSpec {

    enum Mode { SINGLE_ROW, COMPACT, FULL }

    /** Used when the launcher hasn't reported a size yet (e.g. while the widget is being placed). */
    static final int DEFAULT_WIDTH_DP = 250;
    static final int DEFAULT_HEIGHT_DP = 110;

    /** AUTO: shorter than this is one row. */
    static final int SINGLE_ROW_BELOW_DP = 100;
    /** AUTO: at least this tall has room for the hourly strip. */
    static final int FULL_FROM_DP = 128;

    final Mode mode;
    /** How many hourly columns to show (0 = none). */
    final int hourColumns;
    /** Temperature text size, scaled to the height so it never looks lost or cramped. */
    final float tempSp;
    /** SINGLE_ROW only: room for the city/condition text next to the temperature. */
    final boolean showTextColumn;
    /** Whether there's height for the high/low line. */
    final boolean showHiLo;

    private WidgetLayoutSpec(Mode mode, int hourColumns, float tempSp, boolean showTextColumn, boolean showHiLo) {
        this.mode = mode;
        this.hourColumns = hourColumns;
        this.tempSp = tempSp;
        this.showTextColumn = showTextColumn;
        this.showHiLo = showHiLo;
    }

    static WidgetLayoutSpec compute(WidgetSettings.Layout preference, int widthDp, int heightDp) {
        int w = widthDp > 0 ? widthDp : DEFAULT_WIDTH_DP;
        int h = heightDp > 0 ? heightDp : DEFAULT_HEIGHT_DP;

        Mode mode;
        switch (preference) {
            case SINGLE_ROW: mode = Mode.SINGLE_ROW; break;
            case COMPACT: mode = Mode.COMPACT; break;
            case FULL: mode = Mode.FULL; break;
            default:
                mode = h < SINGLE_ROW_BELOW_DP ? Mode.SINGLE_ROW : h < FULL_FROM_DP ? Mode.COMPACT : Mode.FULL;
        }

        switch (mode) {
            case SINGLE_ROW:
                return new WidgetLayoutSpec(
                    mode,
                    clamp((w - 210) / 46, 0, 4),
                    clamp((h - 12) * 0.45f, 22f, 36f),
                    w >= 190,
                    h >= 64
                );
            case COMPACT:
                return new WidgetLayoutSpec(mode, 0, clamp((h - 38) / 1.2f, 28f, 48f), true, true);
            default:
                return new WidgetLayoutSpec(mode, clamp((w - 32) / 50, 2, 6), clamp((h - 94) / 1.2f, 26f, 56f), true, true);
        }
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static float clamp(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
