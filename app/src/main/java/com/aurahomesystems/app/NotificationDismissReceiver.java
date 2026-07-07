package com.aurahomesystems.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class NotificationDismissReceiver extends BroadcastReceiver {
    static final String EXTRA_EVENT_TAG = "alarm_event_tag";
    static final String EXTRA_USER_KEY = "alarm_user_key";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        String eventTag = intent.getStringExtra(EXTRA_EVENT_TAG);
        if (eventTag == null || eventTag.trim().isEmpty()) {
            return;
        }
        String userKey = intent.getStringExtra(EXTRA_USER_KEY);
        NativePushRegistrar.sendAck(
                context,
                "dismissed",
                eventTag,
                AuraFirebaseMessagingService.CHANNEL_ID,
                userKey);
    }
}
