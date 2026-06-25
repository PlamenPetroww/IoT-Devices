package com.aurahomesystems.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class NativePushBridgeActivity extends Activity {
    private static final String TAG = "AuraNativePush";
    private static final String API_BASE = "https://cleverhaus.onrender.com";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Uri uri = getIntent() != null ? getIntent().getData() : null;
        final String nonce = uri != null ? uri.getQueryParameter("nonce") : null;
        final String userKey = uri != null ? uri.getQueryParameter("userKey") : null;
        if (userKey != null && !userKey.trim().isEmpty()) {
            NativePushRegistrar.rememberUserKey(this, userKey.trim());
            AlarmMonitorService.startIfConfigured(this);
        }
        if (nonce == null || nonce.trim().isEmpty()) {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    NativePushRegistrar.uploadToken(this, task.getResult());
                } else {
                    Log.w(TAG, "FCM token failed");
                }
                finish();
            });
            return;
        }

        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            new Thread(() -> {
                try {
                    if (task.isSuccessful() && task.getResult() != null) {
                        registerTokenSync(nonce, task.getResult());
                    } else {
                        Log.w(TAG, "FCM token failed");
                    }
                } finally {
                    runOnUiThread(this::finish);
                }
            }).start();
        });
    }

    private void registerTokenSync(String nonce, String token) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(API_BASE + "/api/register-native-push").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("nonce", nonce);
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
            Log.i(TAG, "register-native-push HTTP " + code);
        } catch (Exception e) {
            Log.e(TAG, "register-native-push failed", e);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
