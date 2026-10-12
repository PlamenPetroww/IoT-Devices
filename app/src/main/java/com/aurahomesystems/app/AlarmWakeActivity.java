package com.aurahomesystems.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Turns the screen on for an alarm. The system tray notification alone does not
 * wake a phone that is in standby.
 */
public class AlarmWakeActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        String title = getIntent().getStringExtra(AuraFirebaseMessagingService.EXTRA_ALERT_TITLE);
        String body = getIntent().getStringExtra(AuraFirebaseMessagingService.EXTRA_ALERT_BODY);
        if (title == null || title.trim().isEmpty()) {
            title = "Aura HomeSystems";
        }
        if (body == null) {
            body = "";
        }

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.BLACK);
        layout.setPadding(48, 48, 48, 48);

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(22);
        titleView.setGravity(Gravity.CENTER);

        TextView bodyView = new TextView(this);
        bodyView.setText(body);
        bodyView.setTextColor(Color.WHITE);
        bodyView.setTextSize(28);
        bodyView.setGravity(Gravity.CENTER);
        bodyView.setPadding(0, 32, 0, 0);

        layout.addView(titleView);
        layout.addView(bodyView);
        setContentView(layout);

        layout.setOnClickListener(v -> openApp());
    }

    private void openApp() {
        Intent launch = new Intent(this, LauncherActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        String eventTag = getIntent().getStringExtra(AuraFirebaseMessagingService.EXTRA_EVENT_TAG);
        String userKey = getIntent().getStringExtra(AuraFirebaseMessagingService.EXTRA_USER_KEY);
        if (eventTag != null) {
            launch.putExtra(AuraFirebaseMessagingService.EXTRA_EVENT_TAG, eventTag);
        }
        if (userKey != null) {
            launch.putExtra(AuraFirebaseMessagingService.EXTRA_USER_KEY, userKey);
        }
        startActivity(launch);
        finish();
    }
}
