package com.quarc.weather;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The widget's decision logic, on a plain JVM: what it shows at a given size,
 * what colours it uses, and how settings behave. There's no emulator in the
 * dev environment, so keeping these rules free of android.* types (and tested
 * here) is how they get verified at all.
 */
public class WidgetLogicTest {

    private static final WidgetSettings.Layout AUTO = WidgetSettings.Layout.AUTO;

    // --- layout choice: the "too much empty space" fix ----------------------------

    @Test
    public void autoPicksTheLayoutFromTheHeight() {
        // A launcher cell is ~70dp minus 30: 1 row ~ 40-70dp, 2 rows ~ 110dp, 3 rows ~ 180dp.
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, WidgetLayoutSpec.compute(AUTO, 250, 40).mode);
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, WidgetLayoutSpec.compute(AUTO, 250, 99).mode);
        assertEquals(WidgetLayoutSpec.Mode.COMPACT, WidgetLayoutSpec.compute(AUTO, 250, 100).mode);
        assertEquals(WidgetLayoutSpec.Mode.COMPACT, WidgetLayoutSpec.compute(AUTO, 250, 110).mode);
        assertEquals(WidgetLayoutSpec.Mode.COMPACT, WidgetLayoutSpec.compute(AUTO, 250, 127).mode);
        assertEquals(WidgetLayoutSpec.Mode.FULL, WidgetLayoutSpec.compute(AUTO, 250, 128).mode);
        assertEquals(WidgetLayoutSpec.Mode.FULL, WidgetLayoutSpec.compute(AUTO, 250, 250).mode);
    }

    @Test
    public void anExplicitChoiceOverridesTheSizeSoTheUserStaysInControl() {
        // A big widget the user wants kept tidy, and a small one they want full anyway.
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW,
            WidgetLayoutSpec.compute(WidgetSettings.Layout.SINGLE_ROW, 300, 300).mode);
        assertEquals(WidgetLayoutSpec.Mode.COMPACT,
            WidgetLayoutSpec.compute(WidgetSettings.Layout.COMPACT, 300, 300).mode);
        assertEquals(WidgetLayoutSpec.Mode.FULL,
            WidgetLayoutSpec.compute(WidgetSettings.Layout.FULL, 110, 70).mode);
    }

    @Test
    public void anUnreportedSizeFallsBackToTheDefaultTwoByOne() {
        // A new widget starts as a 2x1; until the launcher says otherwise, that is what to draw.
        WidgetLayoutSpec s = WidgetLayoutSpec.compute(AUTO, 0, 0);
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, s.mode);
        assertEquals(WidgetLayoutSpec.DEFAULT_WIDTH_DP, 110);
        assertEquals(WidgetLayoutSpec.DEFAULT_HEIGHT_DP, 60);
    }

    // --- the smallest size: Minimal --------------------------------------------------

    @Test
    public void aNarrowWidgetGetsMinimalWhateverItsHeight() {
        // ~1 phone cell is 40-70dp square; nothing but an icon and a number fits.
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, WidgetLayoutSpec.compute(AUTO, 57, 57).mode);
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, WidgetLayoutSpec.compute(AUTO, 40, 40).mode);
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, WidgetLayoutSpec.compute(AUTO, 99, 40).mode);
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, WidgetLayoutSpec.compute(AUTO, 60, 400).mode); // a tall sliver
        // At exactly 100dp wide and short, it's a (2-cell) single row instead.
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, WidgetLayoutSpec.compute(AUTO, 100, 60).mode);
    }

    @Test
    public void aSingleCellOnATabletAlsoGetsMinimalInsteadOfACrampedCard() {
        // Tablet cells are big: roughly 140x108dp. A compact card would be squeezed into that;
        // a big icon and temperature fill it properly.
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, WidgetLayoutSpec.compute(AUTO, 140, 108).mode);
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, WidgetLayoutSpec.compute(AUTO, 159, 200).mode);
        // But once it is wide enough for a card, it gets one.
        assertEquals(WidgetLayoutSpec.Mode.COMPACT, WidgetLayoutSpec.compute(AUTO, 160, 108).mode);
        assertEquals(WidgetLayoutSpec.Mode.FULL, WidgetLayoutSpec.compute(AUTO, 160, 200).mode);
        // A wide, short widget is a row, never Minimal.
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, WidgetLayoutSpec.compute(AUTO, 140, 70).mode);
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, WidgetLayoutSpec.compute(AUTO, 250, 40).mode);
    }

    @Test
    public void minimalCanBePinnedAtAnySizeAndFillsWhatItIsGiven() {
        WidgetLayoutSpec big = WidgetLayoutSpec.compute(WidgetSettings.Layout.MINIMAL, 400, 300);
        assertEquals(WidgetLayoutSpec.Mode.MINIMAL, big.mode);
        assertEquals("a big minimal widget scales up, within the cap", 56f, big.tempSp, 0.001f);
        WidgetLayoutSpec tiny = WidgetLayoutSpec.compute(WidgetSettings.Layout.MINIMAL, 40, 40);
        assertEquals("the smallest cell still gets readable text", 22f, tiny.tempSp, 0.001f);
        // It scales with the SMALLER side, so a long thin widget doesn't get giant text.
        assertEquals(
            WidgetLayoutSpec.compute(WidgetSettings.Layout.MINIMAL, 300, 60).tempSp,
            WidgetLayoutSpec.compute(WidgetSettings.Layout.MINIMAL, 60, 300).tempSp, 0.001f);
    }

    @Test
    public void minimalShowsOnlyTheIconAndTemperature() {
        WidgetLayoutSpec s = WidgetLayoutSpec.compute(WidgetSettings.Layout.MINIMAL, 120, 120);
        assertEquals(0, s.hourColumns);
        assertFalse(s.showTextColumn);
        assertFalse(s.showHiLo);
    }

    @Test
    public void everyLayoutChoiceYieldsAWellFormedSpecAtEverySize() {
        for (WidgetSettings.Layout l : WidgetSettings.Layout.values()) {
            for (int w = 0; w <= 500; w += 7) {
                for (int h = 0; h <= 400; h += 9) {
                    WidgetLayoutSpec s = WidgetLayoutSpec.compute(l, w, h);
                    assertTrue(l + " " + w + "x" + h, s.mode != null && s.tempSp >= 22f && s.tempSp <= 56f);
                    assertTrue(l + " " + w + "x" + h + " columns", s.hourColumns >= 0 && s.hourColumns <= 6);
                }
            }
        }
    }

    @Test
    public void hourlyColumnsFollowTheWidthAndAreAlwaysInRange() {
        for (int w = 0; w <= 600; w += 10) {
            WidgetLayoutSpec single = WidgetLayoutSpec.compute(WidgetSettings.Layout.SINGLE_ROW, w, 60);
            assertTrue("single row cols " + w, single.hourColumns >= 0 && single.hourColumns <= 4);
            WidgetLayoutSpec full = WidgetLayoutSpec.compute(WidgetSettings.Layout.FULL, w, 200);
            assertTrue("full cols " + w, full.hourColumns >= 2 && full.hourColumns <= 6);
            assertEquals(0, WidgetLayoutSpec.compute(WidgetSettings.Layout.COMPACT, w, 110).hourColumns);
        }
        // Wider means at least as many columns, never fewer.
        int last = 0;
        for (int w = 110; w <= 500; w += 10) {
            int cols = WidgetLayoutSpec.compute(WidgetSettings.Layout.FULL, w, 200).hourColumns;
            assertTrue("columns shrank as the widget got wider at " + w, cols >= last);
            last = cols;
        }
        assertEquals(6, WidgetLayoutSpec.compute(WidgetSettings.Layout.FULL, 400, 200).hourColumns);
        assertEquals(2, WidgetLayoutSpec.compute(WidgetSettings.Layout.FULL, 110, 200).hourColumns);
    }

    @Test
    public void aTwoCellWideSingleRowKeepsJustTheIconAndTemperature() {
        WidgetLayoutSpec tiny = WidgetLayoutSpec.compute(AUTO, 110, 60);
        assertEquals(WidgetLayoutSpec.Mode.SINGLE_ROW, tiny.mode);
        assertFalse("no room for a text column in 110dp", tiny.showTextColumn);
        assertEquals(0, tiny.hourColumns);

        WidgetLayoutSpec wide = WidgetLayoutSpec.compute(AUTO, 320, 60);
        assertTrue(wide.showTextColumn);
        assertTrue("a wide single row fills the width with hours", wide.hourColumns >= 2);
    }

    @Test
    public void temperatureTextScalesWithHeightWithinSaneBounds() {
        for (WidgetSettings.Layout l : WidgetSettings.Layout.values()) {
            float prev = 0;
            for (int h = 30; h <= 400; h += 10) {
                float sp = WidgetLayoutSpec.compute(l, 250, h).tempSp;
                assertTrue("text too small: " + sp, sp >= 22f);
                assertTrue("text too big: " + sp, sp <= 56f);
                if (l != WidgetSettings.Layout.AUTO) {
                    assertTrue("text shrank as the widget grew (" + l + " h=" + h + ")", sp >= prev);
                    prev = sp;
                }
            }
        }
    }

    @Test
    public void theHighLowLineIsDroppedWhenASingleRowIsTooShortForIt() {
        assertFalse(WidgetLayoutSpec.compute(WidgetSettings.Layout.SINGLE_ROW, 250, 50).showHiLo);
        assertTrue(WidgetLayoutSpec.compute(WidgetSettings.Layout.SINGLE_ROW, 250, 70).showHiLo);
    }

    // --- sky moods match the web app --------------------------------------------

    @Test
    public void skyBucketsMatchTheWebApp() {
        assertEquals("clear", WidgetPalette.skyBucket(0, 20));
        assertEquals("clear", WidgetPalette.skyBucket(1, 20));
        assertEquals("partly", WidgetPalette.skyBucket(2, 20));
        assertEquals("cloudy", WidgetPalette.skyBucket(3, 20));
        assertEquals("fog", WidgetPalette.skyBucket(45, 10));
        assertEquals("fog", WidgetPalette.skyBucket(48, 10));
        assertEquals("rain", WidgetPalette.skyBucket(53, 10));
        assertEquals("rain", WidgetPalette.skyBucket(63, 10));
        assertEquals("rain", WidgetPalette.skyBucket(81, 10));
        assertEquals("snow", WidgetPalette.skyBucket(73, -2));
        assertEquals("snow", WidgetPalette.skyBucket(66, 0)); // freezing rain reads as snow in the app
        assertEquals("snow", WidgetPalette.skyBucket(86, -2));
        assertEquals("storm", WidgetPalette.skyBucket(82, 12)); // violent showers are a storm sky
        assertEquals("storm", WidgetPalette.skyBucket(95, 18));
        assertEquals("storm", WidgetPalette.skyBucket(99, 18));
        assertEquals("cloudy", WidgetPalette.skyBucket(1234, 10)); // unknown code
    }

    @Test
    public void onlyAClearScorcherTurnsHot() {
        assertEquals("hot", WidgetPalette.skyBucket(0, 32));
        assertEquals("hot", WidgetPalette.skyBucket(1, 41));
        assertEquals("clear", WidgetPalette.skyBucket(0, 31.9));
        assertEquals("rain", WidgetPalette.skyBucket(63, 38)); // hot rain is still rain
        assertEquals("clear", WidgetPalette.skyBucket(0, Double.NaN)); // unknown temperature
    }

    @Test
    public void everyBucketTheMapperCanReturnHasADrawable() {
        java.util.Set<String> known = new java.util.HashSet<>(java.util.Arrays.asList(WidgetPalette.SKY_BUCKETS));
        for (int code = 0; code <= 99; code++) {
            for (double t : new double[] { -10, 20, 40, Double.NaN }) {
                String b = WidgetPalette.skyBucket(code, t);
                assertTrue("no sky drawable for bucket '" + b + "' (code " + code + ")", known.contains(b));
            }
        }
    }

    // --- colours ---------------------------------------------------------------------

    @Test
    public void autoTextIsLightExceptOnLightBackgrounds() {
        for (WidgetSettings.Background bg : new WidgetSettings.Background[] {
            WidgetSettings.Background.SKY, WidgetSettings.Background.DARK,
            WidgetSettings.Background.GLASS, WidgetSettings.Background.TRANSPARENT }) {
            assertEquals(bg.name(), WidgetPalette.WHITE,
                WidgetPalette.textColor(bg, WidgetSettings.TextTone.AUTO, 0));
        }
        assertEquals(WidgetPalette.INK,
            WidgetPalette.textColor(WidgetSettings.Background.LIGHT, WidgetSettings.TextTone.AUTO, 0));
    }

    @Test
    public void autoTextOnACustomColourFollowsItsBrightness() {
        // Every offered swatch is dark enough for white text...
        for (int swatch : WidgetSettings.SWATCHES) {
            assertEquals("swatch " + Integer.toHexString(swatch), WidgetPalette.WHITE,
                WidgetPalette.textColor(WidgetSettings.Background.COLOR, WidgetSettings.TextTone.AUTO, swatch));
        }
        // ...and a genuinely pale colour flips to dark text.
        assertEquals(WidgetPalette.INK,
            WidgetPalette.textColor(WidgetSettings.Background.COLOR, WidgetSettings.TextTone.AUTO, 0xFFFDE68A));
    }

    @Test
    public void anExplicitTextToneAlwaysWins() {
        // e.g. dark text on a transparent widget sitting over a bright wallpaper.
        assertEquals(WidgetPalette.INK,
            WidgetPalette.textColor(WidgetSettings.Background.TRANSPARENT, WidgetSettings.TextTone.DARK, 0));
        assertEquals(WidgetPalette.WHITE,
            WidgetPalette.textColor(WidgetSettings.Background.LIGHT, WidgetSettings.TextTone.LIGHT, 0));
    }

    @Test
    public void secondaryTextKeepsItsColourAndDims() {
        assertEquals(0xCCFFFFFF, WidgetPalette.secondary(0xFFFFFFFF));
        assertEquals(0xCC0F172A, WidgetPalette.secondary(0xFF0F172A));
    }

    @Test
    public void solidBackgroundsAreOpaqueColoursOfTheRightKind() {
        assertEquals(0xFF111827, WidgetPalette.solidColor(WidgetSettings.Background.DARK, 0));
        assertEquals(0xFFF8FAFC, WidgetPalette.solidColor(WidgetSettings.Background.LIGHT, 0));
        assertEquals(0xFF0F172A, WidgetPalette.solidColor(WidgetSettings.Background.GLASS, 0));
        // A custom colour is forced opaque; transparency is the opacity setting's job alone.
        assertEquals(0xFF2563EB, WidgetPalette.solidColor(WidgetSettings.Background.COLOR, 0x002563EB));
    }

    @Test
    public void opacityMapsEvenlyOntoAlphaAndIsClamped() {
        assertEquals(0, WidgetPalette.alphaFromPercent(0)); // fully see-through
        assertEquals(255, WidgetPalette.alphaFromPercent(100));
        assertEquals(128, WidgetPalette.alphaFromPercent(50));
        assertEquals(0, WidgetPalette.alphaFromPercent(-20));
        assertEquals(255, WidgetPalette.alphaFromPercent(900));
        int prev = -1;
        for (int p = 0; p <= 100; p++) {
            int a = WidgetPalette.alphaFromPercent(p);
            assertTrue("alpha went backwards at " + p, a >= prev);
            prev = a;
        }
    }

    // --- settings ---------------------------------------------------------------------

    @Test
    public void aNewWidgetLooksLikeTheOriginalOne() {
        WidgetSettings s = WidgetSettings.defaults();
        assertEquals(WidgetSettings.Background.SKY, s.background);
        assertEquals(100, s.opacity);
        assertEquals(WidgetSettings.Layout.AUTO, s.layout);
        assertEquals(WidgetSettings.TextTone.AUTO, s.text);
        assertEquals("", s.cityId);
    }

    @Test
    public void copyIsIndependentOfTheOriginal() {
        WidgetSettings a = WidgetSettings.defaults();
        WidgetSettings b = a.copy();
        assertNotSame(a, b);
        b.opacity = 10;
        b.background = WidgetSettings.Background.TRANSPARENT;
        b.cityId = "abc";
        assertEquals(100, a.opacity);
        assertEquals(WidgetSettings.Background.SKY, a.background);
        assertEquals("", a.cityId);
    }

    @Test
    public void glassStartsTranslucentAndGivesItBackWhenYouLeaveIt() {
        WidgetSettings s = WidgetSettings.defaults();
        s.chooseBackground(WidgetSettings.Background.GLASS);
        assertEquals(WidgetSettings.GLASS_DEFAULT_OPACITY, s.opacity);
        s.chooseBackground(WidgetSettings.Background.DARK);
        assertEquals(100, s.opacity);
    }

    @Test
    public void glassDoesNotOverwriteAnOpacityTheUserChose() {
        WidgetSettings s = WidgetSettings.defaults();
        s.opacity = 70;
        s.chooseBackground(WidgetSettings.Background.GLASS);
        assertEquals(70, s.opacity);
        s.chooseBackground(WidgetSettings.Background.SKY);
        assertEquals(70, s.opacity);
    }

    @Test
    public void choosingTransparentKeepsTheOpacityForWhenYouComeBack() {
        WidgetSettings s = WidgetSettings.defaults();
        s.opacity = 60;
        s.chooseBackground(WidgetSettings.Background.TRANSPARENT);
        s.chooseBackground(WidgetSettings.Background.DARK);
        assertEquals(60, s.opacity);
    }

    @Test
    public void unknownSavedValuesFallBackInsteadOfCrashing() {
        assertEquals(WidgetSettings.Background.SKY,
            WidgetSettings.parseEnum(WidgetSettings.Background.class, "HOLOGRAM", WidgetSettings.Background.SKY));
        assertEquals(WidgetSettings.Background.SKY,
            WidgetSettings.parseEnum(WidgetSettings.Background.class, null, WidgetSettings.Background.SKY));
        assertEquals(WidgetSettings.Background.GLASS,
            WidgetSettings.parseEnum(WidgetSettings.Background.class, "GLASS", WidgetSettings.Background.SKY));
    }

    @Test
    public void opacityIsClampedToAPercentage() {
        assertEquals(0, WidgetSettings.clampOpacity(-5));
        assertEquals(100, WidgetSettings.clampOpacity(250));
        assertEquals(37, WidgetSettings.clampOpacity(37));
    }
}
