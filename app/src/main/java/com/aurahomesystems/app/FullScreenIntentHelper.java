package com.aurahomesystems.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

final class FullScreenIntentHelper {
    private static final String PREFS = "aura_app";
    private static final String KEY_ASKED = "full_screen_intent_asked";

    private FullScreenIntentHelper() {}

    static void requestIfNeeded(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.canUseFullScreenIntent()) {
            return;
        }
        if (activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_ASKED, false)) {
            return;
        }
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ASKED, true)
                .apply();
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
        } catch (Exception ignored) {
            // Some OEMs expose this only under the app's notification settings.
        }
    }
}
