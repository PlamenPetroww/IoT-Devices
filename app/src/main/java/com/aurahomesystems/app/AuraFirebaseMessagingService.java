package com.aurahomesystems.app;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Map;

public class AuraFirebaseMessagingService extends FirebaseMessagingService {
    public static final String CHANNEL_ID = "aura_alarm_alerts_v2";
    public static final String EXTRA_EVENT_TAG = "alarm_event_tag";
    public static final String EXTRA_USER_KEY = "alarm_user_key";
    private static final String PREFS = "aura_app";
    private static final String KEY_LAST_BODY = "last_notif_body";
    private static final String KEY_LAST_BODY_AT = "last_notif_body_at";
    private static final String KEY_FCM_MESSAGE_IDS = "fcm_message_ids";
    private static final String KEY_RECENT_CLAIMS = "recent_notif_claims";
    private static final java.util.Set<String> IN_MEMORY_CLAIMS =
            java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    private static final long IN_MEMORY_CLAIM_MS = 30000L;
    private static final long BODY_DEDUPE_MS = 12000L;
    private static volatile long inMemoryPrunedAt = 0L;

    static boolean claimEventForNotification(
            Context context, String eventTag, String title, String body, long eventCreatedAt) {
        String dedupeKey = buildNotificationDedupeKey(eventTag, title, body, eventCreatedAt);
        if (dedupeKey.isEmpty()) {
            return false;
        }
        synchronized (AuraFirebaseMessagingService.class) {
            android.content.SharedPreferences prefs =
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();

            String stored = prefs.getString(KEY_RECENT_CLAIMS, "");
            if (("\n" + stored + "\n").contains("\n" + dedupeKey + "\n")) {
                return false;
            }

            String bodyKey = buildBodyDedupeKey(title, body);
            long lastBodyAt = prefs.getLong(KEY_LAST_BODY_AT, 0L);
            String lastBody = prefs.getString(KEY_LAST_BODY, "");
            if (bodyKey.equals(lastBody) && now - lastBodyAt < BODY_DEDUPE_MS) {
                return false;
            }

            String updated = stored.isEmpty() ? dedupeKey : stored + "\n" + dedupeKey;
            String[] parts = updated.split("\n");
            if (parts.length > 30) {
                StringBuilder trimmed = new StringBuilder();
                for (int i = parts.length - 30; i < parts.length; i++) {
                    if (trimmed.length() > 0) {
                        trimmed.append("\n");
                    }
                    trimmed.append(parts[i]);
                }
                updated = trimmed.toString();
            }
            prefs.edit()
                    .putString(KEY_RECENT_CLAIMS, updated)
                    .putString(KEY_LAST_BODY, bodyKey)
                    .putLong(KEY_LAST_BODY_AT, now)
                    .commit();
            return true;
        }
    }

    private static String buildBodyDedupeKey(String title, String body) {
        return String.valueOf(title != null ? title : "")
                + "|"
                + String.valueOf(body != null ? body : "");
    }

    private static boolean claimFcmMessageId(Context context, String messageId) {
        if (messageId == null || messageId.trim().isEmpty()) {
            return true;
        }
        synchronized (AuraFirebaseMessagingService.class) {
            android.content.SharedPreferences prefs =
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String stored = prefs.getString(KEY_FCM_MESSAGE_IDS, "");
            if (("\n" + stored + "\n").contains("\n" + messageId + "\n")) {
                return false;
            }
            String updated = stored.isEmpty() ? messageId : stored + "\n" + messageId;
            String[] parts = updated.split("\n");
            if (parts.length > 30) {
                StringBuilder trimmed = new StringBuilder();
                for (int i = parts.length - 30; i < parts.length; i++) {
                    if (trimmed.length() > 0) {
                        trimmed.append("\n");
                    }
                    trimmed.append(parts[i]);
                }
                updated = trimmed.toString();
            }
            prefs.edit().putString(KEY_FCM_MESSAGE_IDS, updated).commit();
            return true;
        }
    }

    private static boolean claimInMemory(String dedupeKey) {
        if (dedupeKey == null || dedupeKey.isEmpty()) {
            return true;
        }
        long now = System.currentTimeMillis();
        if (now - inMemoryPrunedAt > IN_MEMORY_CLAIM_MS) {
            IN_MEMORY_CLAIMS.clear();
            inMemoryPrunedAt = now;
        }
        return IN_MEMORY_CLAIMS.add(dedupeKey);
    }

    private static String resolveDedupeTag(Map<String, String> data, String eventTag, long eventCreatedAt) {
        if (data != null && data.containsKey("dedupeTag")) {
            String tag = data.get("dedupeTag");
            if (tag != null && !tag.trim().isEmpty()) {
                return tag.trim();
            }
        }
        return buildNotificationDedupeKey(eventTag, "Aura HomeSystems", "", eventCreatedAt);
    }

    private static String notificationTagForAlarm(
            String dedupeTag, String eventTag, long eventCreatedAt, String title, String body) {
        if (dedupeTag != null && !dedupeTag.isEmpty()) {
            return "aura-" + (Math.abs(dedupeTag.hashCode()) & 0x7fffffff);
        }
        if (eventTag != null && !eventTag.trim().isEmpty()) {
            if (eventCreatedAt > 0L) {
                return "aura-" + (Math.abs((eventTag.trim() + "|" + eventCreatedAt).hashCode()) & 0x7fffffff);
            }
            return eventTag.trim();
        }
        return "aura-alarm-" + (Math.abs(buildBodyDedupeKey(title, body).hashCode()) & 0x7fffffff);
    }

    private static String buildNotificationDedupeKey(
            String eventTag, String title, String body, long eventCreatedAt) {
        long stamp = eventCreatedAt > 0L ? eventCreatedAt : System.currentTimeMillis();
        if (eventTag != null && !eventTag.trim().isEmpty()) {
            return eventTag.trim() + "|" + stamp;
        }
        String bodyKey = buildBodyDedupeKey(title, body);
        if (bodyKey.equals("|")) {
            return "";
        }
        return "body:" + bodyKey + "|" + stamp;
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        if (!claimFcmMessageId(this, remoteMessage.getMessageId())) {
            android.util.Log.i("AuraFCM", "skip duplicate FCM messageId " + remoteMessage.getMessageId());
            return;
        }

        Map<String, String> data = remoteMessage.getData();
        String eventTag =
                data != null && data.containsKey("eventTag") ? data.get("eventTag") : "";
        String userKey =
                data != null && data.containsKey("userKey") ? data.get("userKey") : "";
        long eventCreatedAt = parseLong(
                data != null && data.containsKey("eventCreatedAt")
                        ? data.get("eventCreatedAt")
                        : "");
        String dedupeTag = resolveDedupeTag(data, eventTag, eventCreatedAt);
        String inboundKey = dedupeTag + "|" + eventCreatedAt;
        if (!claimInMemory(inboundKey)) {
            android.util.Log.i("AuraFCM", "skip in-memory duplicate " + dedupeTag);
            NativePushRegistrar.sendAck(this, "skipped_duplicate", eventTag, "", userKey);
            return;
        }

        String previewTitle =
                remoteMessage.getNotification() != null && remoteMessage.getNotification().getTitle() != null
                        ? remoteMessage.getNotification().getTitle()
                        : (data != null && data.containsKey("title") ? data.get("title") : "Aura HomeSystems");
        String previewBody =
                remoteMessage.getNotification() != null && remoteMessage.getNotification().getBody() != null
                        ? remoteMessage.getNotification().getBody()
                        : (data != null && data.containsKey("body") ? data.get("body") : "");
        if (!claimEventForNotification(this, eventTag, previewTitle, previewBody, eventCreatedAt)) {
            android.util.Log.i("AuraFCM", "skip duplicate inbound message " + eventTag);
            NativePushRegistrar.sendAck(this, "skipped_duplicate", eventTag, "", userKey);
            return;
        }

        NativePushRegistrar.sendAck(this, "received", eventTag, "", userKey);
        if (remoteMessage.getNotification() != null) {
            if (!isAppInForeground()) {
                android.util.Log.i("AuraFCM", "background notification handled by system " + eventTag);
                NativePushRegistrar.sendAck(this, "shown_system", eventTag, CHANNEL_ID, userKey);
                if (eventCreatedAt > 0L || (eventTag != null && !eventTag.isEmpty())) {
                    AlarmMonitorService.rememberSeenEvent(this, eventTag, eventCreatedAt);
                }
                return;
            }
            RemoteMessage.Notification n = remoteMessage.getNotification();
            boolean shown = showAlarmNotification(
                    this,
                    n.getTitle() != null ? n.getTitle() : "Aura HomeSystems",
                    n.getBody() != null ? n.getBody() : "",
                    true,
                    eventTag,
                    userKey,
                    eventCreatedAt,
                    dedupeTag,
                    true);
            if (shown && (eventCreatedAt > 0L || (eventTag != null && !eventTag.isEmpty()))) {
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
        boolean shown = showAlarmNotification(
                this, title, body, playSound, eventTag, userKey, eventCreatedAt, dedupeTag, true);
        if (shown && (eventCreatedAt > 0L || (eventTag != null && !eventTag.isEmpty()))) {
            AlarmMonitorService.rememberSeenEvent(this, eventTag, eventCreatedAt);
        }
    }

    public static boolean showAlarmNotification(
            Context context,
            String title,
            String body,
            boolean playSound,
            String eventTag,
            String userKey) {
        return showAlarmNotification(context, title, body, playSound, eventTag, userKey, 0L, "", false);
    }

    public static boolean showAlarmNotification(
            Context context,
            String title,
            String body,
            boolean playSound,
            String eventTag,
            String userKey,
            long eventCreatedAt,
            String dedupeTag,
            boolean skipDedupeClaim) {
        if (!skipDedupeClaim
                && !claimEventForNotification(context, eventTag, title, body, eventCreatedAt)) {
            android.util.Log.i("AuraFCM", "skip duplicate notification " + eventTag);
            NativePushRegistrar.sendAck(context, "skipped_duplicate", eventTag, "", userKey);
            return false;
        }
        if (!NotificationPermissionHelper.areNotificationsEnabled(context)) {
            android.util.Log.w("AuraFCM", "Notifications disabled — enable in phone Settings");
            NativePushRegistrar.sendAck(
                    context, "blocked_notifications_disabled", eventTag, "", userKey);
            return false;
        }
        ensureChannel(context, playSound);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Intent intent = new Intent(context, LauncherActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (eventTag != null && !eventTag.isEmpty()) {
            intent.putExtra(EXTRA_EVENT_TAG, eventTag);
        }
        if (userKey != null && !userKey.isEmpty()) {
            intent.putExtra(EXTRA_USER_KEY, userKey);
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                notificationRequestCode(eventTag),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent dismissIntent = new Intent(context, NotificationDismissReceiver.class);
        if (eventTag != null && !eventTag.isEmpty()) {
            dismissIntent.putExtra(NotificationDismissReceiver.EXTRA_EVENT_TAG, eventTag);
        }
        if (userKey != null && !userKey.isEmpty()) {
            dismissIntent.putExtra(NotificationDismissReceiver.EXTRA_USER_KEY, userKey);
        }
        PendingIntent deleteIntent = PendingIntent.getBroadcast(
                context,
                notificationRequestCode(eventTag) + 1,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setDeleteIntent(deleteIntent)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setVibrate(new long[]{0, 300, 200, 300});

        if (playSound) {
            builder.setDefaults(NotificationCompat.DEFAULT_ALL);
        } else {
            builder.setSilent(true);
        }

        int notificationId = notificationIdForAlarm(dedupeTag, eventTag, eventCreatedAt, title, body);
        String notifyTag = notificationTagForAlarm(dedupeTag, eventTag, eventCreatedAt, title, body);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            nm.notify(notifyTag, notificationId, builder.build());
        } else {
            nm.notify(notificationId, builder.build());
        }
        if (!isNotificationActive(nm, notificationId)) {
            android.util.Log.w("AuraFCM", "notification not active after notify " + eventTag);
            NativePushRegistrar.sendAck(context, "notify_post_failed", eventTag, "", userKey);
            return false;
        }
        NativePushRegistrar.sendAck(context, "shown", eventTag, CHANNEL_ID, userKey);
        return true;
    }

    private static int notificationIdForAlarm(
            String dedupeTag, String eventTag, long eventCreatedAt, String title, String body) {
        if (dedupeTag != null && !dedupeTag.isEmpty()) {
            return dedupeTag.hashCode() & 0x7fffffff;
        }
        if (eventTag != null && !eventTag.trim().isEmpty()) {
            if (eventCreatedAt > 0L) {
                return (eventTag.trim() + "|" + eventCreatedAt).hashCode() & 0x7fffffff;
            }
            return eventTag.trim().hashCode() & 0x7fffffff;
        }
        String key = String.valueOf(title != null ? title : "") + "|" + String.valueOf(body != null ? body : "");
        return key.hashCode() & 0x7fffffff;
    }

    private static int notificationRequestCode(String eventTag) {
        return (eventTag != null && !eventTag.isEmpty())
                ? (eventTag.hashCode() & 0x7fffffff)
                : (int) (System.currentTimeMillis() & 0xfffffff);
    }

    private static boolean isNotificationActive(NotificationManager nm, int notificationId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || nm == null) {
            return true;
        }
        try {
            StatusBarNotification[] active = nm.getActiveNotifications();
            if (active == null) {
                return false;
            }
            for (StatusBarNotification sbn : active) {
                if (sbn.getId() == notificationId) {
                    return true;
                }
            }
        } catch (Exception e) {
            android.util.Log.w("AuraFCM", "getActiveNotifications failed", e);
            return true;
        }
        return false;
    }

    private static long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private boolean isAppInForeground() {
        ActivityManager activityManager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (activityManager == null) {
            return false;
        }
        List<ActivityManager.RunningAppProcessInfo> processes = activityManager.getRunningAppProcesses();
        if (processes == null) {
            return false;
        }
        final String packageName = getPackageName();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    && packageName.equals(process.processName)) {
                return true;
            }
        }
        return false;
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
