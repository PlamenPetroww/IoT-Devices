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
    private static final long POLL_WHILE_ARMED_MS = 15000L;
    private static final long POLL_WHILE_DISARMED_MS = 300000L;

    private volatile boolean running;
    private Thread worker;
    private int pollFailures;

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
                for (AlarmEvent event : result.events) {
                    // Backup when FCM could not deliver (pendingAlarmEvents); dedupe avoids duplicates.
                    boolean shown = AuraFirebaseMessagingService.showAlarmNotification(
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
                            shown ? "poll_shown" : "poll_seen",
                            event.eventTag,
                            shown ? AuraFirebaseMessagingService.CHANNEL_ID : "",
                            event.userKey);
                    if (shown) {
                        rememberSeenEvent(this, event.eventTag, event.createdAt);
                    }
                }
                if (!result.armed) {
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

    private PollResult pollAlarmEvents() throws Exception {
        String deviceId = AuraDeviceId.get(this);
        String userKey = getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                .getString("user_key", "");
        if (userKey == null || userKey.trim().isEmpty()) {
            userKey = resolveUserKeyFromServer();
        }
        long since = getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                .getLong("last_alarm_event_time", 0L);
        long now = System.currentTimeMillis();
        if (since > now + 300000L) {
            since = 0L;
        }
        String url = API_BASE + "/api/alarm-events?deviceId="
                + encode(deviceId)
                + "&since=" + since;
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
                return new PollResult(armed, new AlarmEvent[0]);
            }
            AlarmEvent[] events = new AlarmEvent[arr.length()];
            int count = 0;
            long maxSeen = since;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) {
                    continue;
                }
                AlarmEvent event = AlarmEvent.fromJson(item, userKey);
                if (event.eventTag.isEmpty()) {
                    continue;
                }
                events[count++] = event;
                maxSeen = Math.max(maxSeen, event.createdAt);
            }
            if (count == events.length) {
                return new PollResult(armed, events);
            }
            AlarmEvent[] trimmed = new AlarmEvent[count];
            System.arraycopy(events, 0, trimmed, 0, count);
            return new PollResult(armed, trimmed);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String resolveUserKeyFromServer() {
        String deviceId = AuraDeviceId.get(this);
        String url = API_BASE + "/api/native-monitor-user?deviceId="
                + encode(deviceId);
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private android.app.Notification buildMonitorNotification() {
        Intent intent = new Intent(this, LauncherActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                2601,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle("Aura monitoring active")
                .setContentText("Alarm monitoring is active while your system is armed.")
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
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Aura monitoring",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps Aura alarm monitoring active");
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
        final AlarmEvent[] events;

        PollResult(boolean armed, AlarmEvent[] events) {
            this.armed = armed;
            this.events = events;
        }
    }

    private static final class AlarmEvent {
        final String userKey;
        final String eventTag;
        final long createdAt;
        final String title;
        final String body;

        private AlarmEvent(String userKey, String eventTag, long createdAt, String title, String body) {
            this.userKey = userKey;
            this.eventTag = eventTag;
            this.createdAt = createdAt;
            this.title = title;
            this.body = body;
        }

        static AlarmEvent fromJson(JSONObject json, String fallbackUserKey) {
            return new AlarmEvent(
                    json.optString("userKey", fallbackUserKey),
                    json.optString("eventTag", ""),
                    json.optLong("createdAt", 0L),
                    json.optString("title", "Aura HomeSystems"),
                    json.optString("body", "Alarm event detected."));
        }
    }
}
