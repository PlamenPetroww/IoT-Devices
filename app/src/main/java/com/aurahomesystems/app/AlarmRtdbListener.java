package com.aurahomesystems.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.ChildEventListener;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

final class AlarmRtdbListener {
    private static final String TAG = "AuraRtdbListener";
    private static final String API_BASE = "https://cleverhaus.onrender.com";
    private static final long AUTH_REFRESH_MS = 45L * 60L * 1000L;

    interface Callback {
        void onPendingAlarm(AlarmPendingEvent event);
    }

    private final Context appContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Callback callback;

    private volatile boolean active;
    private volatile String userKey = "";
    private DatabaseReference pendingRef;
    private ChildEventListener childListener;
    private long authFetchedAt;

    AlarmRtdbListener(Context context, Callback callback) {
        this.appContext = context.getApplicationContext();
        this.callback = callback;
    }

    void start(String resolvedUserKey) {
        if (resolvedUserKey == null || resolvedUserKey.trim().isEmpty()) {
            return;
        }
        userKey = resolvedUserKey.trim();
        active = true;
        new Thread(this::ensureAuthAndAttach, "AuraRtdbAuth").start();
    }

    void stop() {
        active = false;
        mainHandler.post(this::detachListener);
    }

    private void ensureAuthAndAttach() {
        if (!active) {
            return;
        }
        try {
            long now = System.currentTimeMillis();
            FirebaseUser current = FirebaseAuth.getInstance().getCurrentUser();
            if (current == null || now - authFetchedAt > AUTH_REFRESH_MS) {
                if (!signInFromServer()) {
                    Log.w(TAG, "RTDB auth unavailable");
                    return;
                }
                authFetchedAt = now;
            }
            mainHandler.post(this::attachListener);
        } catch (Exception e) {
            Log.w(TAG, "RTDB auth/listener setup failed", e);
        }
    }

    private boolean signInFromServer() throws Exception {
        String deviceId = AuraDeviceId.get(appContext);
        String url = API_BASE + "/api/native-rtdb-token?deviceId=" + encode(deviceId);
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String response = readAll(stream);
            if (code < 200 || code >= 300) {
                Log.w(TAG, "native-rtdb-token HTTP " + code);
                return false;
            }
            JSONObject json = new JSONObject(response);
            String customToken = json.optString("customToken", "").trim();
            String resolvedUserKey = json.optString("userKey", "").trim();
            if (customToken.isEmpty()) {
                return false;
            }
            if (!resolvedUserKey.isEmpty()) {
                userKey = resolvedUserKey;
                NativePushRegistrar.rememberUserKey(appContext, resolvedUserKey);
            }
            final boolean[] ok = new boolean[] {false};
            final Exception[] err = new Exception[] {null};
            FirebaseAuth.getInstance()
                    .signInWithCustomToken(customToken)
                    .addOnCompleteListener(
                            task -> {
                                ok[0] = task.isSuccessful();
                                if (!task.isSuccessful() && task.getException() != null) {
                                    err[0] = task.getException();
                                }
                            });
            for (int i = 0; i < 40; i++) {
                if (FirebaseAuth.getInstance().getCurrentUser() != null) {
                    return true;
                }
                if (err[0] != null) {
                    break;
                }
                Thread.sleep(100);
            }
            if (err[0] != null) {
                throw err[0];
            }
            return ok[0] && FirebaseAuth.getInstance().getCurrentUser() != null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void attachListener() {
        if (!active || userKey.isEmpty()) {
            return;
        }
        detachListener();
        pendingRef =
                FirebaseDatabase.getInstance()
                        .getReference("users")
                        .child(userKey)
                        .child("pendingAlarmEvents");
        childListener =
                new ChildEventListener() {
                    @Override
                    public void onChildAdded(DataSnapshot snapshot, String previousChildName) {
                        handleSnapshot(snapshot);
                    }

                    @Override
                    public void onChildChanged(DataSnapshot snapshot, String previousChildName) {
                        handleSnapshot(snapshot);
                    }

                    @Override
                    public void onChildRemoved(DataSnapshot snapshot) {}

                    @Override
                    public void onChildMoved(DataSnapshot snapshot, String previousChildName) {}

                    @Override
                    public void onCancelled(DatabaseError error) {
                        Log.w(TAG, "pendingAlarmEvents listener cancelled: " + error.getMessage());
                    }
                };
        pendingRef.addChildEventListener(childListener);
        Log.i(TAG, "RTDB listener attached for " + userKey);
    }

    private void handleSnapshot(DataSnapshot snapshot) {
        if (!active || snapshot == null) {
            return;
        }
        AlarmPendingEvent event =
                AlarmPendingEvent.fromRtdb(snapshot.getKey(), snapshot.getValue(), userKey);
        if (event == null || event.eventTag.isEmpty()) {
            return;
        }
        callback.onPendingAlarm(event);
    }

    private void detachListener() {
        if (pendingRef != null && childListener != null) {
            pendingRef.removeEventListener(childListener);
        }
        pendingRef = null;
        childListener = null;
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }
        byte[] buf = new byte[4096];
        StringBuilder out = new StringBuilder();
        int n;
        while ((n = stream.read(buf)) >= 0) {
            out.append(new String(buf, 0, n, StandardCharsets.UTF_8));
        }
        stream.close();
        return out.toString();
    }
}
