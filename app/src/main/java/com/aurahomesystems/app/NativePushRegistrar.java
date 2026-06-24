package com.aurahomesystems.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class NativePushRegistrar {
    private static final String TAG = "AuraNativePush";
    private static final String API_BASE = "https://cleverhaus.onrender.com";
    private static final String RTDB_BASE =
            "https://cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app";

    private NativePushRegistrar() {}

    static void uploadToken(Context context, String token) {
        if (token == null || token.trim().isEmpty()) {
            return;
        }
        final String deviceId = AuraDeviceId.get(context);
        final String tokenStr = token.trim();
        new Thread(() -> {
            boolean rtdbOk = uploadTokenToRtdb(context, deviceId, tokenStr);
            boolean apiOk = uploadTokenToApi(context, deviceId, tokenStr);
            Log.i(TAG, "upload " + deviceId + " rtdb=" + rtdbOk + " api=" + apiOk);
            if (!rtdbOk && !apiOk) {
                sleepQuiet(5000);
                rtdbOk = uploadTokenToRtdb(context, deviceId, tokenStr);
                apiOk = uploadTokenToApi(context, deviceId, tokenStr);
                Log.i(TAG, "upload retry " + deviceId + " rtdb=" + rtdbOk + " api=" + apiOk);
            }
        }).start();
    }

    static void rememberUserKey(Context context, String userKey) {
        String normalized = normalizeUserKey(userKey);
        if (normalized == null) {
            return;
        }
        context.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                .edit()
                .putString("user_key", normalized)
                .apply();
    }

    static void sendAck(Context context, String stage, String eventTag, String channelId) {
        sendAck(context, stage, eventTag, channelId, null);
    }

    static void sendAck(Context context, String stage, String eventTag, String channelId, String explicitUserKey) {
        final String deviceId = AuraDeviceId.get(context);
        final String stageStr = stage != null ? stage.trim() : "";
        final String eventTagStr = eventTag != null ? eventTag.trim() : "";
        final String channelIdStr = channelId != null ? channelId.trim() : "";
        String normalizedExplicitUserKey = normalizeUserKey(explicitUserKey);
        if (normalizedExplicitUserKey != null) {
            rememberUserKey(context, normalizedExplicitUserKey);
        }
        final String userKey = normalizedExplicitUserKey != null
                ? normalizedExplicitUserKey
                : context.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                        .getString("user_key", "");
        new Thread(
                () -> {
                    for (int attempt = 1; attempt <= 3; attempt++) {
                        if (postAck(deviceId, stageStr, eventTagStr, channelIdStr, userKey, attempt)) {
                            return;
                        }
                        sleepQuiet(attempt * 1500L);
                    }
                })
                .start();
    }

    private static boolean postAck(
            String deviceId,
            String stage,
            String eventTag,
            String channelId,
            String userKey,
            int attempt) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(API_BASE + "/api/native-push-ack").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("stage", stage);
            body.put("eventTag", eventTag);
            body.put("channelId", channelId);
            if (userKey != null && !userKey.trim().isEmpty()) {
                body.put("userKey", userKey.trim());
            }

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream out = conn.getOutputStream();
            out.write(bytes);
            out.flush();
            out.close();

            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream != null) {
                stream.close();
            }
            boolean ok = code >= 200 && code < 300;
            if (!ok) {
                Log.w(TAG, "native-push-ack HTTP " + code + " attempt=" + attempt);
            }
            return ok;
        } catch (Exception e) {
            Log.w(TAG, "native-push-ack failed attempt=" + attempt, e);
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static boolean uploadTokenToRtdb(Context context, String deviceId, String token) {
        if (!isValidDeviceId(deviceId)) {
            return false;
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection)
                    new URL(RTDB_BASE + "/nativeDeviceTokens/" + deviceId + ".json").openConnection();
            conn.setRequestMethod("PATCH");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("updatedAt", System.currentTimeMillis());
            String userKey =
                    context.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                            .getString("user_key", null);
            if (userKey != null && !userKey.trim().isEmpty()) {
                body.put("userKey", userKey.trim());
            }

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream out = conn.getOutputStream();
            out.write(bytes);
            out.flush();
            out.close();

            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream != null) {
                stream.close();
            }
            return code >= 200 && code < 300;
        } catch (Exception e) {
            Log.e(TAG, "RTDB nativeDeviceTokens failed", e);
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static boolean uploadTokenToApi(Context context, String deviceId, String token) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(API_BASE + "/api/native-device-token").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("token", token);
            String userKey =
                    context.getSharedPreferences("aura_app", Context.MODE_PRIVATE)
                            .getString("user_key", null);
            if (userKey != null && !userKey.trim().isEmpty()) {
                body.put("userKey", userKey.trim());
            }

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream out = conn.getOutputStream();
            out.write(bytes);
            out.flush();
            out.close();

            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream != null) {
                stream.close();
            }
            return code >= 200 && code < 300;
        } catch (Exception e) {
            Log.e(TAG, "native-device-token API failed", e);
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static boolean isValidDeviceId(String deviceId) {
        return deviceId != null && deviceId.matches("^aura_[a-fA-F0-9]{32}$");
    }

    private static String normalizeUserKey(String raw) {
        if (raw == null) return null;
        String s = raw.trim().toLowerCase();
        if (s.isEmpty()) return null;
        if (s.contains("@")) {
            s = s.replace(".", "-").replace("@", "_at_");
        }
        return s.matches("^[a-z0-9_-]+_at_[a-z0-9_-]+$") ? s : null;
    }

    private static void sleepQuiet(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
