/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.aurahomesystems.app;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.ImageView;

import androidx.annotation.NonNull;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    private boolean notificationRequestScheduled = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleAlarmNotificationIntent(getIntent());
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAlarmNotificationIntent(intent);
    }

    private void handleAlarmNotificationIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String eventTag = intent.getStringExtra(AuraFirebaseMessagingService.EXTRA_EVENT_TAG);
        if (eventTag == null || eventTag.trim().isEmpty()) {
            return;
        }
        String userKey = intent.getStringExtra(AuraFirebaseMessagingService.EXTRA_USER_KEY);
        NativePushRegistrar.sendAck(
                this,
                "opened",
                eventTag.trim(),
                AuraFirebaseMessagingService.CHANNEL_ID,
                userKey);
        intent.removeExtra(AuraFirebaseMessagingService.EXTRA_EVENT_TAG);
        intent.removeExtra(AuraFirebaseMessagingService.EXTRA_USER_KEY);
    }

    @Override
    protected void onResume() {
        super.onResume();
        AlarmMonitorService.startIfConfigured(this);
        String storedUserKey =
                getSharedPreferences("aura_app", MODE_PRIVATE).getString("user_key", "");
        if (storedUserKey != null && !storedUserKey.trim().isEmpty()) {
            com.google.firebase.messaging.FirebaseMessaging.getInstance()
                    .getToken()
                    .addOnCompleteListener(
                            task -> {
                                if (task.isSuccessful() && task.getResult() != null) {
                                    NativePushRegistrar.uploadToken(this, task.getResult());
                                }
                            });
        }
        if (NotificationPermissionHelper.areNotificationsEnabled(this)) {
            notificationRequestScheduled = false;
            return;
        }
        if (notificationRequestScheduled) {
            return;
        }
        notificationRequestScheduled = true;
        getWindow()
                .getDecorView()
                .postDelayed(
                        () -> {
                            if (isFinishing()) {
                                return;
                            }
                            if (NotificationPermissionHelper.areNotificationsEnabled(this)) {
                                return;
                            }
                            NotificationPermissionHelper.requestIfNeeded(LauncherActivity.this, true);
                        },
                        1200);
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NotificationPermissionHelper.REQUEST_CODE) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        notificationRequestScheduled = false;
        getSharedPreferences("aura_app", MODE_PRIVATE)
                .edit()
                .putBoolean("notify_perm_asked", false)
                .apply();
    }

    @NonNull
    @Override
    protected ImageView.ScaleType getSplashImageScaleType() {
        return ImageView.ScaleType.FIT_CENTER;
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri uri = super.getLaunchingUrl();
        if (uri == null) {
            return null;
        }
        String userKey = uri.getQueryParameter("aura_user_key");
        if (userKey != null) {
            NativePushRegistrar.rememberUserKey(this, userKey);
            AlarmMonitorService.startIfConfigured(this);
            com.google.firebase.messaging.FirebaseMessaging.getInstance()
                    .getToken()
                    .addOnCompleteListener(
                            task -> {
                                if (task.isSuccessful() && task.getResult() != null) {
                                    NativePushRegistrar.uploadToken(this, task.getResult());
                                }
                            });
        }
        String versionName = "";
        try {
            versionName =
                    getPackageManager()
                            .getPackageInfo(getPackageName(), 0)
                            .versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        return uri.buildUpon()
                .appendQueryParameter("aura_did", AuraDeviceId.get(this))
                .appendQueryParameter("aura_app_ver", versionName != null ? versionName : "")
                .appendQueryParameter(
                        "aura_notify",
                        NotificationPermissionHelper.areNotificationsEnabled(this) ? "1" : "0")
                .build();
    }
}
