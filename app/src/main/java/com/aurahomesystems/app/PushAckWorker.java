package com.aurahomesystems.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class PushAckWorker extends Worker {
    static final String KEY_DEVICE_ID = "deviceId";
    static final String KEY_STAGE = "stage";
    static final String KEY_EVENT_TAG = "eventTag";
    static final String KEY_CHANNEL_ID = "channelId";
    static final String KEY_USER_KEY = "userKey";

    public PushAckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        boolean ok = NativePushRegistrar.postAck(
                value(KEY_DEVICE_ID),
                value(KEY_STAGE),
                value(KEY_EVENT_TAG),
                value(KEY_CHANNEL_ID),
                value(KEY_USER_KEY),
                getRunAttemptCount() + 1);
        return ok ? Result.success() : Result.retry();
    }

    private String value(String key) {
        String value = getInputData().getString(key);
        return value == null ? "" : value;
    }
}
