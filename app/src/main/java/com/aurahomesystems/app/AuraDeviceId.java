package com.aurahomesystems.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

final class AuraDeviceId {
    private static final String PREFS = "aura_app";
    private static final String KEY = "device_id";

    private AuraDeviceId() {}

    static String get(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(KEY, null);
        if (id == null || id.trim().isEmpty()) {
            id = "aura_" + UUID.randomUUID().toString().replace("-", "");
            prefs.edit().putString(KEY, id).apply();
        }
        return id;
    }
}
