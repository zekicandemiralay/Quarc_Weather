package com.quarc.weather;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * On a periodic ~15-minute WorkManager tick, checks whether it's time to
 * post the daily "good morning" weather briefing configured in Settings —
 * and if so, fetches the top city's conditions and posts a notification.
 * Runs entirely independently of the app being open, same architecture as
 * WeatherWidgetWorker (and shares its harvested session token — a
 * notification and a widget both just need "the logged-in session", there's
 * no reason for two separate copies of that bridge).
 */
public class DailyBriefingWorker extends Worker {

    static final String PREFS = "quarc_weather_briefing";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_HOUR = "hour";
    static final String KEY_MINUTE = "minute";
    private static final String KEY_LAST_SENT_DATE = "last_sent_date"; // "YYYY-MM-DD", device-local

    private static final String CHANNEL_ID = "daily_briefing";
    private static final int NOTIFICATION_ID = 1001;
    private static final String WORK_NAME = "quarc_weather_daily_briefing";

    // WorkManager's own floor. The check runs every ~15 min and fires once
    // the device's local clock enters the same 15-minute bucket as the
    // user's configured time — real delivery lands within ~15-29 minutes of
    // the requested time, not to the exact minute. That's an intentional
    // trade-off, the same one the widget's own refresh cadence already makes.
    private static final long CHECK_MINUTES = 15;

    public DailyBriefingWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) return Result.success();

        // The device's own local clock — deliberately NOT the city's
        // timezone. This notification is about "what time it is on the
        // phone in your pocket right now", unlike the weather DATA itself
        // (hourly strip, widget, etc.), which is always the CITY's own
        // timezone. Both are "local time" but to two different places, and
        // conflating them here would be exactly the class of bug already
        // fixed elsewhere in this app — just in the other direction.
        Calendar now = Calendar.getInstance();
        int nowHour = now.get(Calendar.HOUR_OF_DAY);
        int nowMinute = now.get(Calendar.MINUTE);
        String today = String.format(Locale.US, "%04d-%02d-%02d",
            now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH));

        if (today.equals(prefs.getString(KEY_LAST_SENT_DATE, ""))) return Result.success(); // already sent today

        int targetHour = prefs.getInt(KEY_HOUR, 8);
        int targetMinute = prefs.getInt(KEY_MINUTE, 0);
        int nowBucket = (nowHour * 60 + nowMinute) / (int) CHECK_MINUTES;
        int targetBucket = (targetHour * 60 + targetMinute) / (int) CHECK_MINUTES;
        if (nowBucket != targetBucket) return Result.success(); // not this tick's turn

        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            // Permission not (yet) granted — don't mark today as "sent", so
            // this can still fire later today once the user grants it.
            return Result.success();
        }

        SharedPreferences session = context.getSharedPreferences(WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE);
        String token = session.getString(WidgetBridgePlugin.KEY_TOKEN, null);
        String server = session.getString(WidgetBridgePlugin.KEY_SERVER, null);
        if (token == null || server == null) return Result.success(); // signed out — nothing to say

        try {
            String json = httpGet(server + "/api/weather/overview", token);
            JSONArray cities = new JSONArray(json);
            if (cities.length() == 0) return Result.success();
            postNotification(context, cities.getJSONObject(0));
            prefs.edit().putString(KEY_LAST_SENT_DATE, today).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    private String httpGet(String urlStr, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Cookie", "token=" + token);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
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

    private void postNotification(Context context, JSONObject city) {
        JSONObject current = city.optJSONObject("current");
        JSONObject todayBlock = city.optJSONObject("today");
        JSONArray nextHours = city.optJSONArray("next_hours");
        String name = city.optString("name", "—");

        int code = current != null ? current.optInt("weather_code", 3) : 3;
        boolean isDay = current == null || current.optInt("is_day", 1) == 1;
        double temp = current != null ? current.optDouble("temperature_2m", Double.NaN) : Double.NaN;
        double hi = todayBlock != null ? todayBlock.optDouble("temperature_2m_max", Double.NaN) : Double.NaN;
        double lo = todayBlock != null ? todayBlock.optDouble("temperature_2m_min", Double.NaN) : Double.NaN;

        StringBuilder text = new StringBuilder();
        text.append(formatTemp(temp)).append(" · ").append(WeatherLabels.labelFor(code));
        if (!Double.isNaN(hi) && !Double.isNaN(lo)) {
            text.append("  H:").append(formatTemp(hi)).append(" L:").append(formatTemp(lo));
        }

        // Scan the next few hours for the first sign of precipitation — the
        // one piece of information a briefing can give that "the current
        // temperature" alone doesn't: whether to grab an umbrella before
        // leaving.
        if (nextHours != null) {
            for (int i = 0; i < nextHours.length(); i++) {
                JSONObject h = nextHours.optJSONObject(i);
                if (h == null) continue;
                int hCode = h.optInt("weather_code", 0);
                if (WeatherLabels.isPrecipitation(hCode)) {
                    String time = wallClockTime(h.optString("time", null));
                    text.append("\n").append(WeatherLabels.labelFor(hCode)).append(" around ").append(time);
                    break;
                }
            }
        }

        ensureChannel(context);

        Intent openApp = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent contentIntent = null;
        if (openApp != null) {
            openApp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            contentIntent = PendingIntent.getActivity(context, 0, openApp, flags);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(WeatherLabels.emojiFor(code, isDay) + " " + name)
            .setContentText(text.toString().replace("\n", "  ·  "))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text.toString()))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (contentIntent != null) builder.setContentIntent(contentIntent);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
    }

    /**
     * Same wall-clock substring extraction used everywhere else this app
     * reads an Open-Meteo hourly timestamp — "2026-08-30T14:00" means 14:00
     * in the CITY's timezone, and parsing it through java.util.Date/Calendar
     * would silently re-interpret those digits in the DEVICE's timezone
     * instead, shifting the displayed hour. No Date object, ever, for these.
     */
    private static String wallClockTime(String iso) {
        if (iso == null || iso.length() < 16) return "";
        return iso.substring(11, 16);
    }

    private static String formatTemp(double value) {
        return Double.isNaN(value) ? "--°" : Math.round(value) + "°";
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = context.getSystemService(NotificationManager.class);
        if (mgr == null || mgr.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Daily briefing", NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Your daily weather briefing for your top city");
        mgr.createNotificationChannel(channel);
    }

    // --- WorkManager scheduling ---------------------------------------------

    static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                DailyBriefingWorker.class, CHECK_MINUTES, TimeUnit.MINUTES
            )
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }
}
