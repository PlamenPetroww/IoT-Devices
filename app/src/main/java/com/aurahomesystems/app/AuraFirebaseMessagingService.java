package com.aurahomesystems.app;

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
    public static final String CHANNEL_ID = "aura_alerts";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        if (remoteMessage.getNotification() != null) {
            RemoteMessage.Notification n = remoteMessage.getNotification();
            showNotification(
                    n.getTitle() != null ? n.getTitle() : "Aura HomeSystems",
                    n.getBody() != null ? n.getBody() : "",
                    true);
            return;
        }

        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) {
            return;
        }

        String title = data.containsKey("title") ? data.get("title") : "Aura HomeSystems";
        String body = data.containsKey("body") ? data.get("body") : "";
        boolean playSound = !"0".equals(data.get("playSound"));
        showNotification(title, body, playSound);
    }

    private void showNotification(String title, String body, boolean playSound) {
        ensureChannel(playSound);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        Intent intent = new Intent(this, LauncherActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                (int) (System.currentTimeMillis() & 0xffff),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM);

        if (playSound) {
            builder.setDefaults(NotificationCompat.DEFAULT_ALL);
        } else {
            builder.setSilent(true);
        }

        nm.notify((int) (System.currentTimeMillis() & 0xfffffff), builder.build());
    }

    private void ensureChannel(boolean playSound) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Aura alerts",
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Door and window sensor alerts");
        if (playSound) {
            channel.enableVibration(true);
            channel.setSound(
                    android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .build());
        } else {
            channel.setSound(null, null);
        }
        nm.createNotificationChannel(channel);
    }
}
