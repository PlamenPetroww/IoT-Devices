package com.aurahomesystems.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class NativePushBridgeActivity extends Activity {
    private static final String API_BASE = "https://cleverhaus.onrender.com";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Uri uri = getIntent() != null ? getIntent().getData() : null;
        final String nonce = uri != null ? uri.getQueryParameter("nonce") : null;
        if (nonce == null || nonce.trim().isEmpty()) {
            finish();
            return;
        }

        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                registerTokenAsync(nonce, task.getResult());
            }
            finish();
        });
    }

    private void registerTokenAsync(final String nonce, final String token) {
        new Thread(() -> {
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
                conn.getResponseCode();
            } catch (Exception ignored) {
                // Dashboard refresh will retry native registration.
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }
}
