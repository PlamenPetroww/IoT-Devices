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
            boolean rtdbOk = uploadTokenToRtdb(deviceId, tokenStr);
            boolean apiOk = uploadTokenToApi(deviceId, tokenStr);
            Log.i(TAG, "upload " + deviceId + " rtdb=" + rtdbOk + " api=" + apiOk);
            if (!rtdbOk && !apiOk) {
                sleepQuiet(5000);
                rtdbOk = uploadTokenToRtdb(deviceId, tokenStr);
                apiOk = uploadTokenToApi(deviceId, tokenStr);
                Log.i(TAG, "upload retry " + deviceId + " rtdb=" + rtdbOk + " api=" + apiOk);
            }
        }).start();
    }

    private static boolean uploadTokenToRtdb(String deviceId, String token) {
        if (!isValidDeviceId(deviceId)) {
            return false;
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection)
                    new URL(RTDB_BASE + "/nativeDeviceTokens/" + deviceId + ".json").openConnection();
            conn.setRequestMethod("PUT");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("updatedAt", System.currentTimeMillis());

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

    private static boolean uploadTokenToApi(String deviceId, String token) {
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

    private static void sleepQuiet(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
