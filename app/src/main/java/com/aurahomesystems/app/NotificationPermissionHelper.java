package com.aurahomesystems.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

final class NotificationPermissionHelper {
    static final int REQUEST_CODE = 1001;

    private NotificationPermissionHelper() {}

    static boolean areNotificationsEnabled(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                            context, android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled();
    }

    static void requestIfNeeded(Activity activity, boolean forceRetry) {
        if (areNotificationsEnabled(activity)) {
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (!forceRetry
                && activity.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                        .getBoolean("notify_perm_asked", false)) {
            return;
        }
        activity.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("notify_perm_asked", true)
                .apply();
        ActivityCompat.requestPermissions(
                activity,
                new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                REQUEST_CODE);
    }
}
