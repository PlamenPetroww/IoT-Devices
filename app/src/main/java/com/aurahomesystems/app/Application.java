package com.aurahomesystems.app;

import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;

public class Application extends android.app.Application {
    private static final String TAG = "AuraNativePush";

    @Override
    public void onCreate() {
        super.onCreate();
        AuraDeviceId.get(this);
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                NativePushRegistrar.uploadToken(this, task.getResult());
            } else {
                Log.w(TAG, "FCM token read failed");
            }
        });
        android.os.Handler handler = new android.os.Handler(getMainLooper());
        handler.postDelayed(() -> FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                NativePushRegistrar.uploadToken(this, task.getResult());
            }
        }), 8000);
    }
}
