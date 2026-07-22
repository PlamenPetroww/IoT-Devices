package com.aurahomesystems.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class AlarmAlertActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String eventTag = "";
    private String userKey = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        wakeAndShowOverLockScreen();
        renderAlarm(getIntent());
        handler.postDelayed(this::finish, 30000L);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        renderAlarm(intent);
    }

    private void wakeAndShowOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow()
                    .addFlags(
                            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.screenBrightness = 1.0f;
        getWindow().setAttributes(params);
    }

    private void renderAlarm(Intent intent) {
        String title = value(intent, AuraFirebaseMessagingService.EXTRA_ALERT_TITLE, "Aura HomeSystems");
        String body = value(intent, AuraFirebaseMessagingService.EXTRA_ALERT_BODY, "Alarm detected.");
        eventTag = value(intent, AuraFirebaseMessagingService.EXTRA_EVENT_TAG, "");
        userKey = value(intent, AuraFirebaseMessagingService.EXTRA_USER_KEY, "");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(40), dp(28), dp(40));
        root.setBackgroundColor(Color.rgb(15, 23, 42));

        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(28);
        heading.setGravity(Gravity.CENTER);
        root.addView(
                heading,
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView message = new TextView(this);
        message.setText(body);
        message.setTextColor(Color.rgb(248, 113, 113));
        message.setTextSize(22);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams =
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        messageParams.setMargins(0, dp(24), 0, dp(36));
        root.addView(message, messageParams);

        Button open = new Button(this);
        open.setText("Open Aura");
        open.setOnClickListener(v -> openAura());
        root.addView(
                open,
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button dismiss = new Button(this);
        dismiss.setText("Dismiss");
        dismiss.setOnClickListener(v -> dismissAlarm());
        LinearLayout.LayoutParams dismissParams =
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dismissParams.setMargins(0, dp(12), 0, 0);
        root.addView(dismiss, dismissParams);

        setContentView(root);
        NativePushRegistrar.sendAck(
                this,
                "fullscreen_shown",
                eventTag,
                AuraFirebaseMessagingService.CHANNEL_ID,
                userKey);
    }

    private void openAura() {
        Intent launch = new Intent(this, LauncherActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra(AuraFirebaseMessagingService.EXTRA_EVENT_TAG, eventTag);
        launch.putExtra(AuraFirebaseMessagingService.EXTRA_USER_KEY, userKey);
        startActivity(launch);
        finish();
    }

    private void dismissAlarm() {
        NativePushRegistrar.sendAck(
                this,
                "dismissed",
                eventTag,
                AuraFirebaseMessagingService.CHANNEL_ID,
                userKey);
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(
                    getIntent().getStringExtra(AuraFirebaseMessagingService.EXTRA_NOTIFICATION_TAG),
                    getIntent().getIntExtra(AuraFirebaseMessagingService.EXTRA_NOTIFICATION_ID, 0));
        }
        finish();
    }

    private static String value(Intent intent, String key, String fallback) {
        String value = intent != null ? intent.getStringExtra(key) : null;
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
