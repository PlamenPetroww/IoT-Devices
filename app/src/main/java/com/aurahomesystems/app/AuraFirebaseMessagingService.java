package com.aurahomesystems.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class AuraFirebaseMessagingService extends FirebaseMessagingService {
    public static final String CHANNEL_ID = "aura_alarm_alerts_v2";
    private static final String PREFS = "aura_app";
    private static final String KEY_SHOWN_EVENT_TAGS = "shown_event_tags";

    static boolean claimEventForNotification(Context context, String eventTag) {
        if (eventTag == null || eventTag.trim().isEmpty()) {
            return true;
        }
        String tag = eventTag.trim();
        synchronized (AuraFirebaseMessagingService.class) {
            android.content.SharedPreferences prefs =
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String stored = prefs.getString(KEY_SHOWN_EVENT_TAGS, "");
            if (("\n" + stored + "\n").contains("\n" + tag + "\n")) {
                return false;
            }
            String updated = stored.isEmpty() ? tag : stored + "\n" + tag;
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
            prefs.edit().putString(KEY_SHOWN_EVENT_TAGS, updated).apply();
            return true;
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String eventTag =
                data != null && data.containsKey("eventTag") ? data.get("eventTag") : "";
        String userKey =
                data != null && data.containsKey("userKey") ? data.get("userKey") : "";
        long eventCreatedAt = parseLong(
                data != null && data.containsKey("eventCreatedAt")
                        ? data.get("eventCreatedAt")
                        : "");
        NativePushRegistrar.sendAck(this, "received", eventTag, "", userKey);
        if (remoteMessage.getNotification() != null) {
            RemoteMessage.Notification n = remoteMessage.getNotification();
            showAlarmNotification(
                    this,
                    n.getTitle() != null ? n.getTitle() : "Aura HomeSystems",
                    n.getBody() != null ? n.getBody() : "",
                    true,
                    eventTag,
                    userKey);
            if (eventCreatedAt > 0L || (eventTag != null && !eventTag.isEmpty())) {
                AlarmMonitorService.rememberSeenEvent(this, eventTag, eventCreatedAt);
            }
            return;
        }

        if (data == null || data.isEmpty()) {
            return;
        }

        String title = data.containsKey("title") ? data.get("title") : "Aura HomeSystems";
        String body = data.containsKey("body") ? data.get("body") : "";
        boolean playSound = !"0".equals(data.get("playSound"));
        showAlarmNotification(this, title, body, playSound, eventTag, userKey);
        if (eventCreatedAt > 0L || (eventTag != null && !eventTag.isEmpty())) {
            AlarmMonitorService.rememberSeenEvent(this, eventTag, eventCreatedAt);
        }
    }

    public static void showAlarmNotification(
            Context context,
            String title,
            String body,
            boolean playSound,
            String eventTag,
            String userKey) {
        if (!claimEventForNotification(context, eventTag)) {
            android.util.Log.i("AuraFCM", "skip duplicate notification " + eventTag);
            NativePushRegistrar.sendAck(context, "skipped_duplicate", eventTag, "", userKey);
            return;
        }
        if (!NotificationPermissionHelper.areNotificationsEnabled(context)) {
            android.util.Log.w("AuraFCM", "Notifications disabled — enable in phone Settings");
            NativePushRegistrar.sendAck(
                    context, "blocked_notifications_disabled", eventTag, "", userKey);
            return;
        }
        ensureChannel(context, playSound);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Intent intent = new Intent(context, LauncherActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                (int) (System.currentTimeMillis() & 0xffff),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setVibrate(new long[]{0, 300, 200, 300})
                .setFullScreenIntent(pendingIntent, playSound);

        if (playSound) {
            builder.setDefaults(NotificationCompat.DEFAULT_ALL);
        } else {
            builder.setSilent(true);
        }

        int notificationId = (eventTag != null && !eventTag.isEmpty())
                ? (eventTag.hashCode() & 0x7fffffff)
                : (int) (System.currentTimeMillis() & 0xfffffff);
        nm.notify(notificationId, builder.build());
        NativePushRegistrar.sendAck(context, "shown", eventTag, CHANNEL_ID, userKey);
    }

    private static long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (Exception ignored) {
            return 0L;
        }
    }

    public static void ensureChannel(Context context, boolean playSound) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Aura alarm alerts",
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Urgent door and window sensor alerts");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 300, 200, 300});
        if (playSound) {
            channel.enableVibration(true);
            channel.setSound(
                    android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
        } else {
            channel.setSound(null, null);
        }
        nm.createNotificationChannel(channel);
    }

    @Override
    public void onNewToken(String token) {
        NativePushRegistrar.uploadToken(this, token);
    }
}
