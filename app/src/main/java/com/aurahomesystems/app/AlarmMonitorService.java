package com.aurahomesystems.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class AlarmMonitorService extends Service {
    private static final String TAG = "AuraAlarmMonitor";
    private static final String CHANNEL_ID = "aura_monitoring";
    private static final int NOTIFICATION_ID = 2601;
    private static final String API_BASE = "https://cleverhaus.onrender.com";
    private static final long POLL_WHILE_ARMED_MS = 5000L;
    private static final long POLL_WHILE_DISARMED_MS = 300000L;

    private volatile boolean running;
    private Thread worker;
    private int pollFailures;
    private AlarmRtdbListener rtdbListener;
    private volatile boolean rtdbStarted;

    static void startIfConfigured(Context context) {
        Intent intent = new Intent(context, AlarmMonitorService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "start foreground monitor failed", e);
        }
    }

    static void rememberSeenEvent(Context context, String eventTag, long eventCreatedAt) {
        if (eventCreatedAt <= 0L && (eventTag == null || eventTag.trim().isEmpty())) {
            return;
        }
        long now = System.currentTimeMillis();
        long seenAt = eventCreatedAt > 0L ? eventCreatedAt : now;
        context.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                .edit()
                .putLong("last_alarm_event_time", Math.max(
                        seenAt,
                        context.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                                .getLong("last_alarm_event_time", 0L)))
                .putString("last_alarm_event_tag", eventTag != null ? eventTag : "")
                .apply();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildMonitorNotification());
        rtdbListener = new AlarmRtdbListener(this, this::deliverPendingAlarmFromRtdb);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            worker = new Thread(this::runMonitorLoop, "AuraAlarmMonitor");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        stopRtdbListener();
        if (worker != null) {
            worker.interrupt();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void runMonitorLoop() {
        while (running) {
            long delay = POLL_WHILE_DISARMED_MS;
            try {
                PollResult result = pollAlarmEvents();
                pollFailures = 0;
                delay = result.armed ? POLL_WHILE_ARMED_MS : POLL_WHILE_DISARMED_MS;
                if (result.armed) {
                    ensureRtdbListener(result.userKey);
                    for (AlarmPendingEvent event : result.events) {
                        deliverPendingAlarm(event, "poll");
                    }
                } else {
                    stopRtdbListener();
                    Log.i(TAG, "system disarmed; stopping monitor to save battery");
                    stopMonitorService();
                    return;
                }
            } catch (Exception e) {
                pollFailures++;
                Log.w(TAG, "monitor poll failed", e);
                if (pollFailures <= 12) {
                    delay = 2000L;
                }
            }
            sleepQuiet(delay);
        }
    }

    private void ensureRtdbListener(String resolvedUserKey) {
        if (resolvedUserKey == null || resolvedUserKey.trim().isEmpty()) {
            return;
        }
        if (!rtdbStarted || !resolvedUserKey.equals(getSharedPreferences("aura_app", MODE_PRIVATE)
                .getString("rtdb_user_key", ""))) {
            rtdbStarted = true;
            getSharedPreferences("aura_app", MODE_PRIVATE)
                    .edit()
                    .putString("rtdb_user_key", resolvedUserKey)
                    .apply();
            rtdbListener.start(resolvedUserKey);
            Log.i(TAG, "RTDB fast path enabled for " + resolvedUserKey);
        }
    }

    private void stopRtdbListener() {
        rtdbStarted = false;
        if (rtdbListener != null) {
            rtdbListener.stop();
        }
    }

    private void deliverPendingAlarmFromRtdb(AlarmPendingEvent event) {
        deliverPendingAlarm(event, "rtdb");
    }

    private void deliverPendingAlarm(AlarmPendingEvent event, String source) {
        if (event == null || event.eventTag.isEmpty()) {
            return;
        }
        if (wasRecentlyDelivered(event.eventTag)) {
            Log.i(TAG, "skip already delivered " + event.eventTag);
            NativePushRegistrar.sendAck(
                    this,
                    source + "_duplicate",
                    event.eventTag,
                    "",
                    event.userKey);
            return;
        }
        boolean shown =
                AuraFirebaseMessagingService.showAlarmNotification(
                        this,
                        event.title,
                        event.body,
                        true,
                        event.eventTag,
                        event.userKey,
                        event.createdAt,
                        event.eventTag,
                        false);
        NativePushRegistrar.sendAck(
                this,
                shown ? source + "_shown" : source + "_seen",
                event.eventTag,
                shown ? AuraFirebaseMessagingService.CHANNEL_ID : "",
                event.userKey);
        if (shown) {
            markDelivered(event.eventTag);
            rememberSeenEvent(this, event.eventTag, event.createdAt);
        }
    }

    private boolean wasRecentlyDelivered(String eventTag) {
        String stored =
                getSharedPreferences("aura_app", MODE_PRIVATE).getString("delivered_event_tags", "");
        return ("\n" + stored + "\n").contains("\n" + eventTag + "\n");
    }

    private void markDelivered(String eventTag) {
        android.content.SharedPreferences prefs =
                getSharedPreferences("aura_app", MODE_PRIVATE);
        String stored = prefs.getString("delivered_event_tags", "");
        String updated = stored.isEmpty() ? eventTag : stored + "\n" + eventTag;
        String[] parts = updated.split("\n");
        if (parts.length > 40) {
            StringBuilder trimmed = new StringBuilder();
            for (int i = parts.length - 40; i < parts.length; i++) {
                if (trimmed.length() > 0) {
                    trimmed.append("\n");
                }
                trimmed.append(parts[i]);
            }
            updated = trimmed.toString();
        }
        prefs.edit().putString("delivered_event_tags", updated).apply();
    }

    private PollResult pollAlarmEvents() throws Exception {
        String deviceId = AuraDeviceId.get(this);
        String userKey =
                getSharedPreferences("aura_app", Context.MODE_PRIVATE).getString("user_key", "");
        if (userKey == null || userKey.trim().isEmpty()) {
            userKey = resolveUserKeyFromServer();
        }
        String url = API_BASE + "/api/alarm-events?deviceId=" + encode(deviceId);
        if (userKey != null && !userKey.trim().isEmpty()) {
            url += "&userKey=" + encode(userKey.trim());
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(12000);
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String response = readAll(stream);
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("alarm-events HTTP " + code);
            }
            JSONObject json = new JSONObject(response);
            boolean armed = json.optBoolean("armed", false);
            String resolvedUserKey = json.optString("userKey", "").trim();
            if (!resolvedUserKey.isEmpty()) {
                NativePushRegistrar.rememberUserKey(this, resolvedUserKey);
                userKey = resolvedUserKey;
            }
            JSONArray arr = json.optJSONArray("events");
            if (arr == null || arr.length() == 0) {
                return new PollResult(armed, userKey, new AlarmPendingEvent[0]);
            }
            AlarmPendingEvent[] events = new AlarmPendingEvent[arr.length()];
            int count = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) {
                    continue;
                }
                AlarmPendingEvent event = AlarmPendingEvent.fromJson(item, userKey);
                if (event.eventTag.isEmpty()) {
                    continue;
                }
                events[count++] = event;
            }
            if (count == events.length) {
                return new PollResult(armed, userKey, events);
            }
            AlarmPendingEvent[] trimmed = new AlarmPendingEvent[count];
            System.arraycopy(events, 0, trimmed, 0, count);
            return new PollResult(armed, userKey, trimmed);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String resolveUserKeyFromServer() {
        String deviceId = AuraDeviceId.get(this);
        String url = API_BASE + "/api/native-monitor-user?deviceId=" + encode(deviceId);
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(12000);
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String response = readAll(stream);
            if (code < 200 || code >= 300) {
                return "";
            }
            JSONObject json = new JSONObject(response);
            String userKey = json.optString("userKey", "").trim();
            if (!userKey.isEmpty()) {
                NativePushRegistrar.rememberUserKey(this, userKey);
            }
            return userKey;
        } catch (Exception e) {
            Log.w(TAG, "native monitor user lookup failed", e);
            return "";
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return "";
        }
    }

    private void stopMonitorService() {
        running = false;
        stopRtdbListener();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private android.app.Notification buildMonitorNotification() {
        Intent intent = new Intent(this, LauncherActivity.class);
        PendingIntent pendingIntent =
                PendingIntent.getActivity(
                        this,
                        2601,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle("Aura monitoring active")
                .setContentText("Fast alarm monitoring is active while your system is armed.")
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel =
                new NotificationChannel(CHANNEL_ID, "Aura monitoring", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps Aura fast alarm monitoring active");
        nm.createNotificationChannel(channel);
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }
        byte[] buf = new byte[4096];
        StringBuilder out = new StringBuilder();
        int n;
        while ((n = stream.read(buf)) >= 0) {
            out.append(new String(buf, 0, n, StandardCharsets.UTF_8));
        }
        stream.close();
        return out.toString();
    }

    private static void sleepQuiet(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private static final class PollResult {
        final boolean armed;
        final String userKey;
        final AlarmPendingEvent[] events;

        PollResult(boolean armed, String userKey, AlarmPendingEvent[] events) {
            this.armed = armed;
            this.userKey = userKey != null ? userKey : "";
            this.events = events;
        }
    }
}
