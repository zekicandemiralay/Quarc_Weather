package com.quarc.weather;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Space;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Where a widget's look is chosen: how much it shows, what's behind it (including
 * nothing at all), the text colour, and which city it follows.
 *
 * Launched two ways:
 *   - by the launcher, when a widget is added (and, on Android 12+, from the widget's
 *     "reconfigure" action) — it must answer with RESULT_OK + the widget id or the
 *     launcher discards the widget; Cancel/back answers RESULT_CANCELED.
 *   - from the app's Settings (EXTRA_FROM_APP) to restyle a widget that's already placed.
 *
 * The preview at the top is drawn by WidgetRenderer — the very code the home-screen
 * widget uses — so what you see is what you get, at the widget's real size.
 *
 * Built in code rather than XML: it is a dozen controls whose look depends on state,
 * and it keeps this screen free of any AppCompat theming.
 */
public class WidgetConfigActivity extends Activity {

    static final String EXTRA_FROM_APP = "from_app";

    private AppWidgetManager manager;
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private int[] allIds = new int[0];
    private boolean fromLauncher;

    private WidgetSettings settings;
    private String cacheState;
    private List<WidgetData.City> cities = new ArrayList<>();

    private FrameLayout previewBox;
    private int previewW;
    private int previewH;

    private Chips widgetChips;
    private Chips layoutChips;
    private Chips backgroundChips;
    private Chips textChips;
    private LinearLayout colorRow;
    private final List<View> swatches = new ArrayList<>();
    private LinearLayout opacityBlock;
    private TextView opacityLabel;
    private SeekBar opacityBar;
    private TextView transparentHint;
    private LinearLayout citySection;
    private Spinner citySpinner;
    private boolean syncing; // true while controls are being set from `settings`, so their listeners stay quiet

    private interface OnPick {
        void pick(int index);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The launcher treats anything but RESULT_OK as "the user cancelled" and drops the widget.
        setResult(RESULT_CANCELED);

        manager = AppWidgetManager.getInstance(this);
        allIds = manager.getAppWidgetIds(new ComponentName(this, WeatherWidgetProvider.class));
        Arrays.sort(allIds);

        Intent intent = getIntent();
        widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        fromLauncher = widgetId != AppWidgetManager.INVALID_APPWIDGET_ID && !intent.getBooleanExtra(EXTRA_FROM_APP, false);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID && allIds.length > 0) widgetId = allIds[0];

        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            setContentView(buildNoWidgetScreen());
            return;
        }

        cacheState = WidgetCache.state(this);
        cities = WidgetData.parse(WidgetCache.overviewJson(this));
        settings = WidgetPrefs.load(this, widgetId);

        setContentView(buildScreen());
        loadWidget(widgetId);
    }

    // --- screens ------------------------------------------------------------------

    private View buildNoWidgetScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(28), dp(28), dp(28));

        TextView msg = label(getString(R.string.widget_config_no_widget), 15, R.color.widget_config_text, false);
        msg.setGravity(Gravity.CENTER);
        root.addView(msg);

        TextView close = button(getString(R.string.widget_config_cancel), false);
        close.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(20);
        root.addView(close, lp);
        return root;
    }

    private View buildScreen() {
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(false);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(20), dp(20), dp(20), dp(12));
        scroll.addView(body);
        outer.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        body.addView(label(getString(R.string.widget_config_title), 22, R.color.widget_config_text, true));

        // Several widgets placed, opened from the app: say which one is being edited.
        if (!fromLauncher && allIds.length > 1) {
            String[] names = new String[allIds.length];
            for (int i = 0; i < allIds.length; i++) names[i] = getString(R.string.widget_config_which, i + 1);
            body.addView(section(getString(R.string.widget_config_editing)));
            widgetChips = new Chips(names, 3, index -> switchTo(allIds[index]));
            body.addView(widgetChips.view);
        }

        // Preview
        body.addView(section(getString(R.string.widget_config_preview)));
        previewBox = new FrameLayout(this);
        previewBox.setBackground(rounded(0xFF000000, 16, new int[] { 0xFF2E1A47, 0xFFC0504D, 0xFFF6B352 }));
        body.addView(previewBox, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Layout
        body.addView(section(getString(R.string.widget_config_layout)));
        layoutChips = new Chips(new String[] {
            getString(R.string.widget_config_layout_auto),
            getString(R.string.widget_config_layout_single_row),
            getString(R.string.widget_config_layout_compact),
            getString(R.string.widget_config_layout_full),
        }, 2, index -> {
            settings.layout = WidgetSettings.Layout.values()[index];
            refreshPreview();
        });
        body.addView(layoutChips.view);
        body.addView(hint(getString(R.string.widget_config_layout_hint)));

        // Background
        body.addView(section(getString(R.string.widget_config_background)));
        backgroundChips = new Chips(new String[] {
            getString(R.string.widget_config_bg_sky),
            getString(R.string.widget_config_bg_dark),
            getString(R.string.widget_config_bg_light),
            getString(R.string.widget_config_bg_glass),
            getString(R.string.widget_config_bg_color),
            getString(R.string.widget_config_bg_transparent),
        }, 3, index -> {
            settings.chooseBackground(WidgetSettings.Background.values()[index]);
            syncControls();
            refreshPreview();
        });
        body.addView(backgroundChips.view);

        colorRow = new LinearLayout(this);
        colorRow.setOrientation(LinearLayout.HORIZONTAL);
        colorRow.setPadding(0, dp(8), 0, 0);
        for (int i = 0; i < WidgetSettings.SWATCHES.length; i++) {
            final int color = WidgetSettings.SWATCHES[i];
            View sw = new View(this);
            sw.setOnClickListener(v -> {
                settings.color = color;
                syncControls();
                refreshPreview();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(34), 1f);
            lp.setMargins(dp(3), 0, dp(3), 0);
            colorRow.addView(sw, lp);
            swatches.add(sw);
        }
        body.addView(colorRow);

        opacityBlock = new LinearLayout(this);
        opacityBlock.setOrientation(LinearLayout.VERTICAL);
        opacityBlock.setPadding(0, dp(10), 0, 0);
        opacityLabel = label("", 13, R.color.widget_config_text, false);
        opacityBlock.addView(opacityLabel);
        opacityBar = new SeekBar(this);
        opacityBar.setMax(20); // 0..100% in steps of 5
        opacityBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (syncing) return;
                settings.opacity = progress * 5;
                opacityLabel.setText(getString(R.string.widget_config_opacity, settings.opacity));
                refreshPreview();
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {}

            @Override
            public void onStopTrackingTouch(SeekBar bar) {}
        });
        opacityBlock.addView(opacityBar);
        body.addView(opacityBlock);

        transparentHint = hint(getString(R.string.widget_config_transparent_hint));
        body.addView(transparentHint);

        // Text
        body.addView(section(getString(R.string.widget_config_text)));
        textChips = new Chips(new String[] {
            getString(R.string.widget_config_text_auto),
            getString(R.string.widget_config_text_light),
            getString(R.string.widget_config_text_dark),
        }, 3, index -> {
            settings.text = WidgetSettings.TextTone.values()[index];
            refreshPreview();
        });
        body.addView(textChips.view);

        // City (only once the app has fetched at least one)
        citySection = new LinearLayout(this);
        citySection.setOrientation(LinearLayout.VERTICAL);
        citySection.addView(section(getString(R.string.widget_config_city)));
        citySpinner = new Spinner(this);
        List<String> cityNames = new ArrayList<>();
        cityNames.add(getString(R.string.widget_config_city_first));
        for (WidgetData.City c : cities) cityNames.add((c.isPin ? "📍 " : "") + c.name);
        citySpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, cityNames));
        citySpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (syncing) return;
                String next = position == 0 ? "" : cities.get(position - 1).id;
                if (next.equals(settings.cityId)) return;
                settings.cityId = next;
                refreshPreview();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {}
        });
        citySection.addView(citySpinner);
        citySection.setVisibility(cities.isEmpty() ? View.GONE : View.VISIBLE);
        body.addView(citySection);

        // Save / Cancel, pinned below the scrolling area
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(16), dp(10), dp(16), dp(14));
        TextView cancel = button(getString(R.string.widget_config_cancel), false);
        cancel.setOnClickListener(v -> finish());
        TextView save = button(getString(R.string.widget_config_save), true);
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        half.setMargins(dp(4), 0, dp(4), 0);
        bar.addView(cancel, half);
        bar.addView(save, new LinearLayout.LayoutParams(half));
        outer.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        return outer;
    }

    // --- state ---------------------------------------------------------------------

    /** Makes `id` the widget being edited: its settings, its real size, its preview. */
    private void loadWidget(int id) {
        widgetId = id;
        settings = WidgetPrefs.load(this, id);

        int[] size = WidgetRenderer.sizeDp(this, manager.getAppWidgetOptions(id));
        int screenDp = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
        int maxW = Math.max(110, screenDp - 40 - 24); // body padding + preview padding
        previewW = Math.min(size[0] > 0 ? size[0] : WidgetLayoutSpec.DEFAULT_WIDTH_DP, maxW);
        previewH = Math.max(40, Math.min(size[1] > 0 ? size[1] : WidgetLayoutSpec.DEFAULT_HEIGHT_DP, 240));
        previewBox.setPadding(dp(12), dp(16), dp(12), dp(16));

        if (widgetChips != null) {
            int at = Arrays.binarySearch(allIds, id);
            if (at >= 0) widgetChips.select(at);
        }
        syncControls();
        refreshPreview();
    }

    /** The user picked a different placed widget: keep what they changed on this one first. */
    private void switchTo(int id) {
        if (id == widgetId) return;
        WidgetPrefs.save(this, widgetId, settings);
        WidgetRenderer.update(this, manager, widgetId);
        loadWidget(id);
    }

    /** Pushes `settings` into every control and shows only the controls that apply. */
    private void syncControls() {
        syncing = true;
        try {
            layoutChips.select(settings.layout.ordinal());
            backgroundChips.select(settings.background.ordinal());
            textChips.select(settings.text.ordinal());

            boolean transparent = settings.background == WidgetSettings.Background.TRANSPARENT;
            colorRow.setVisibility(settings.background == WidgetSettings.Background.COLOR ? View.VISIBLE : View.GONE);
            opacityBlock.setVisibility(transparent ? View.GONE : View.VISIBLE);
            transparentHint.setVisibility(transparent ? View.VISIBLE : View.GONE);

            opacityBar.setProgress(settings.opacity / 5);
            opacityLabel.setText(getString(R.string.widget_config_opacity, settings.opacity));

            for (int i = 0; i < swatches.size(); i++) {
                boolean on = WidgetSettings.SWATCHES[i] == settings.color;
                swatches.get(i).setBackground(swatch(WidgetSettings.SWATCHES[i], on));
            }

            int cityIndex = 0;
            for (int i = 0; i < cities.size(); i++) {
                if (cities.get(i).id.equals(settings.cityId)) cityIndex = i + 1;
            }
            citySpinner.setSelection(cityIndex);
        } finally {
            syncing = false;
        }
    }

    private void refreshPreview() {
        previewBox.removeAllViews();

        WidgetData.City city = null;
        if (WidgetCache.STATE_OK.equals(cacheState)) city = WidgetData.pick(cities, settings.cityId);
        String state = cacheState;
        if (city == null) {
            // Nothing fetched yet (or signed out): preview with stand-in data so the look can still be chosen.
            city = WidgetData.sample(getString(R.string.widget_config_sample_city));
            state = WidgetCache.STATE_OK;
        }

        RemoteViews views = WidgetRenderer.build(this, settings, state, city, previewW, previewH, false);
        try {
            View preview = views.apply(getApplicationContext(), previewBox);
            previewBox.addView(preview, new FrameLayout.LayoutParams(dp(previewW), dp(previewH), Gravity.CENTER));
        } catch (RuntimeException e) {
            // A preview that can't draw must never stop the user saving their choice.
        }
    }

    private void save() {
        WidgetPrefs.save(this, widgetId, settings);
        WidgetRenderer.update(this, manager, widgetId);
        // A freshly added widget has no data yet, and a changed city may not be in the cache.
        WeatherWidgetWorker.refreshNow(this);

        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    // --- view helpers ------------------------------------------------------------------

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private int color(int res) {
        return ContextCompat.getColor(this, res);
    }

    private TextView label(String text, int sp, int colorRes, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color(colorRes));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView section(String title) {
        // The user's own locale on purpose: Turkish capitalises i as İ, which is what a Turkish reader expects.
        TextView t = label(title.toUpperCase(Locale.getDefault()), 11, R.color.widget_config_muted, true);
        t.setLetterSpacing(0.08f);
        t.setPadding(0, dp(20), 0, dp(8));
        return t;
    }

    private TextView hint(String text) {
        TextView t = label(text, 12, R.color.widget_config_muted, false);
        t.setPadding(0, dp(8), 0, 0);
        return t;
    }

    private TextView button(String text, boolean primary) {
        TextView t = label(text, 15, primary ? android.R.color.white : R.color.widget_config_text, true);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(16), dp(13), dp(16), dp(13));
        t.setClickable(true);
        t.setBackground(rounded(primary ? color(R.color.widget_config_accent) : color(R.color.widget_config_card), 12, null));
        return t;
    }

    private GradientDrawable rounded(int fill, int radiusDp, int[] gradient) {
        GradientDrawable d = gradient != null
            ? new GradientDrawable(GradientDrawable.Orientation.TL_BR, gradient)
            : new GradientDrawable();
        if (gradient == null) d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private GradientDrawable swatch(int fill, boolean selected) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(fill);
        d.setStroke(dp(selected ? 3 : 1), selected ? Color.WHITE : 0x55FFFFFF);
        return d;
    }

    /** A row-wrapped group of mutually exclusive "chips" (what a RadioGroup would be, styled). */
    private final class Chips {
        final LinearLayout view = new LinearLayout(WidgetConfigActivity.this);
        private final List<TextView> items = new ArrayList<>();

        Chips(String[] labels, int perRow, OnPick onPick) {
            view.setOrientation(LinearLayout.VERTICAL);
            LinearLayout row = null;
            for (int i = 0; i < labels.length; i++) {
                if (i % perRow == 0) {
                    row = new LinearLayout(WidgetConfigActivity.this);
                    row.setOrientation(LinearLayout.HORIZONTAL);
                    view.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                }
                TextView chip = label(labels[i], 13, R.color.widget_config_text, false);
                chip.setGravity(Gravity.CENTER);
                chip.setPadding(dp(8), dp(11), dp(8), dp(11));
                chip.setClickable(true);
                final int index = i;
                chip.setOnClickListener(v -> {
                    select(index);
                    if (!syncing) onPick.pick(index);
                });
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                lp.setMargins(dp(3), dp(3), dp(3), dp(3));
                row.addView(chip, lp);
                items.add(chip);
            }
            // Keep the last row's chips the same width as the others instead of stretching them.
            int rest = labels.length % perRow;
            if (rest != 0 && row != null) {
                for (int k = rest; k < perRow; k++) {
                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, 1, 1f);
                    lp.setMargins(dp(3), dp(3), dp(3), dp(3));
                    row.addView(new Space(WidgetConfigActivity.this), lp);
                }
            }
            select(-1);
        }

        void select(int index) {
            for (int i = 0; i < items.size(); i++) {
                boolean on = i == index;
                TextView chip = items.get(i);
                chip.setTextColor(on ? 0xFF0F172A : color(R.color.widget_config_text));
                chip.setBackground(rounded(on ? 0xFFF1F5F9 : color(R.color.widget_config_card), 10, null));
                chip.setSelected(on);
            }
        }
    }
}
