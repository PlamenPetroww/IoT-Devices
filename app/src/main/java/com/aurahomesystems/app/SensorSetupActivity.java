package com.aurahomesystems.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.companion.AssociationRequest;
import android.companion.BluetoothLeDeviceFilter;
import android.companion.CompanionDeviceManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.IntentSender;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.animation.LinearInterpolator;
import android.widget.ImageView;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.os.SystemClock;
import android.text.InputType;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * First-time sensor setup. The phone finds "Aura Sensor" over Bluetooth and
 * sends the home Wi-Fi, the account email and the sensor name.
 */
@SuppressLint("MissingPermission")
public class SensorSetupActivity extends android.app.Activity {
    private static final String TAG = "AuraSetup";
    private static final String SETUP_AP_SSID = "AuraHomeSystems_Setup";
    private static final String SETUP_PROV_URL = "http://192.168.4.1/prov";
    private static final String SETUP_PING_URL = "http://192.168.4.1/ping";
    private static final String SETUP_WIFI_URL = "http://192.168.4.1/wifi";
    private static final int REQ_PERM = 41;
    private static final int REQ_CDM = 42;
    private static final UUID SERVICE = UUID.fromString("8a1f0001-7c3a-4b2e-9d11-0e5a6b7c8d01");
    private static final UUID LIST = UUID.fromString("8a1f0002-7c3a-4b2e-9d11-0e5a6b7c8d01");
    private static final UUID CRED = UUID.fromString("8a1f0003-7c3a-4b2e-9d11-0e5a6b7c8d01");
    private static final UUID STAT = UUID.fromString("8a1f0004-7c3a-4b2e-9d11-0e5a6b7c8d01");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Handler main = new Handler(Looper.getMainLooper());
    private String email = "";
    private boolean german;
    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;
    private boolean scanning;
    private boolean connecting;
    private boolean looking;
    private boolean credsSent;
    private boolean finishedOk;
    private boolean softApMode;
    private boolean softApReady;
    private int softApAttempts;
    private int scanSeen;
    private final java.util.concurrent.CopyOnWriteArrayList<String> scanNames = new java.util.concurrent.CopyOnWriteArrayList<>();
    private int negotiatedMtu = 23;
    private int scanPass;
    private long lookingSinceElapsed;
    private final java.util.ArrayDeque<byte[]> pendingWrites = new java.util.ArrayDeque<>();
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback softApCallback;
    private Network softApNetwork;

    private TextView headline;
    private TextView detail;
    private TextView percent;
    private ImageView searchLogo;
    private ObjectAnimator searchSpin;
    private MagnetView magnets;
    private int shownPct;
    private int targetPct;
    private final Runnable magnetTick = new Runnable() {
        @Override
        public void run() {
            if (shownPct >= targetPct) return;
            shownPct += 1;
            magnets.setPct(shownPct);
            percent.setText(shownPct + "%");
            percent.setTextColor(blend(Color.parseColor("#fca5a5"), Color.parseColor("#4ade80"), shownPct / 100f));
            main.postDelayed(this, 28);
        }
    };
    private LinearLayout form;
    private LinearLayout networks;
    private EditText ssidInput;
    private EditText passInput;
    private EditText nameInput;
    private Button action;
    private final java.util.Set<String> existingSensorKeys = new java.util.HashSet<>();

    /** Same rule as the sensor and dashboard: the id is the name with a few characters replaced. */
    private static String sensorKey(String name) {
        String s = name == null ? "" : name.trim();
        s = s.replaceAll("[.$#\\[\\]/@]", "_");
        s = s.replaceAll("\\s+", "_");
        s = s.replaceAll("-+", "_");
        return s.toLowerCase(java.util.Locale.ROOT);
    }

    /** Default name "Front Door" becomes "Front Door 2", "3" … when it is already used. */
    private void suggestFreeSensorName() {
        if (nameInput == null || existingSensorKeys.isEmpty()) return;
        String base = nameInput.getText().toString().trim();
        if (base.isEmpty()) base = "Front Door";
        if (!existingSensorKeys.contains(sensorKey(base))) return;
        int n = 2;
        while (existingSensorKeys.contains(sensorKey(base + " " + n))) n++;
        nameInput.setText(base + " " + n);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getIntent() != null && getIntent().getData() != null) {
            String raw = getIntent().getData().getQueryParameter("email");
            email = raw == null ? "" : raw.trim();
            german = "de".equalsIgnoreCase(getIntent().getData().getQueryParameter("lang"));
            // Sensors already on the account. Same name = same id, so a new sensor would replace one.
            java.util.List<String> existing = getIntent().getData().getQueryParameters("existing");
            if (existing != null) {
                for (String id : existing) {
                    if (id != null) existingSensorKeys.add(sensorKey(id));
                }
            }
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildUi();
        suggestFreeSensorName();
        if (email.isEmpty() || !email.contains("@")) {
            showMessage(german ? "Melde dich zuerst im Konto an." : "Sign in to your account first.");
            return;
        }
        requestNeededPermissions();
    }

    private void buildUi() {
        int pad = dp(20);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#0f172a"));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(28), pad, pad);
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView brand = label(german ? "Aura HomeSystems" : "Aura HomeSystems", 13, "#94a3b8");
        brand.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(brand);

        searchLogo = new ImageView(this);
        searchLogo.setImageResource(R.drawable.aura_mark);
        searchLogo.setScaleType(ImageView.ScaleType.CENTER_CROP);
        searchLogo.setClipToOutline(true);
        GradientDrawable round = new GradientDrawable();
        round.setShape(GradientDrawable.OVAL);
        round.setColor(Color.parseColor("#0f172a"));
        searchLogo.setBackground(round);
        searchLogo.setOutlineProvider(new android.view.ViewOutlineProvider() {
            @Override
            public void getOutline(View view, android.graphics.Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(dp(96), dp(96));
        logoLp.gravity = Gravity.CENTER_HORIZONTAL;
        logoLp.topMargin = dp(28);
        logoLp.bottomMargin = dp(8);
        root.addView(searchLogo, logoLp);
        searchSpin = ObjectAnimator.ofFloat(searchLogo, View.ROTATION, 0f, 360f);
        searchSpin.setDuration(1800);
        searchSpin.setRepeatCount(ValueAnimator.INFINITE);
        searchSpin.setInterpolator(new LinearInterpolator());

        percent = label("0%", 52, "#4ade80");
        percent.setGravity(Gravity.CENTER_HORIZONTAL);
        percent.setTypeface(Typeface.DEFAULT);
        percent.setVisibility(View.GONE);
        root.addView(percent);

        headline = label(german ? "Sensor suchen" : "Looking for the sensor", 24, "#f8fafc");
        headline.setGravity(Gravity.CENTER_HORIZONTAL);
        headline.setPadding(0, dp(12), 0, dp(8));
        root.addView(headline);

        detail = label(german
                ? "Schalte den Sensor ein und bleib etwa eine Minute daneben."
                : "Turn the sensor on and stay next to it for about a minute.", 15, "#cbd5e1");
        detail.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(detail);

        magnets = new MagnetView(this);
        magnets.setVisibility(View.GONE);
        LinearLayout.LayoutParams magnetLp = new LinearLayout.LayoutParams(dp(168), dp(168));
        magnetLp.gravity = Gravity.CENTER_HORIZONTAL;
        magnetLp.topMargin = dp(12);
        root.addView(magnets, magnetLp);

        form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setVisibility(View.GONE);
        form.setPadding(0, dp(18), 0, 0);
        root.addView(form);

        form.addView(label(german ? "Netzwerk" : "Network", 12, "#94a3b8"));
        ssidInput = field(german ? "WLAN-Name" : "Wi-Fi name");
        form.addView(ssidInput);
        networks = new LinearLayout(this);
        networks.setOrientation(LinearLayout.VERTICAL);
        form.addView(networks);

        form.addView(label(german ? "Passwort" : "Password", 12, "#94a3b8"));
        passInput = field("");
        passInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        form.addView(passInput);

        form.addView(label(german ? "Sensorname" : "Sensor name", 12, "#94a3b8"));
        nameInput = field("Front Door");
        nameInput.setText("Front Door");
        form.addView(nameInput);

        TextView hint = label(german ? "Wähle das 2,4-GHz-Netz." : "Choose the 2.4 GHz network.", 13, "#94a3b8");
        hint.setPadding(0, dp(8), 0, 0);
        form.addView(hint);

        action = new Button(this);
        action.setText(german ? "Verbinden" : "Connect");
        action.setTextColor(Color.parseColor("#f0fdf4"));
        action.setAllCaps(false);
        action.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#16a34a"));
        bg.setCornerRadius(dp(12));
        action.setBackground(bg);
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        btnLp.topMargin = dp(16);
        action.setOnClickListener(v -> sendCredentials());
        root.addView(action, btnLp);
        action.setVisibility(View.GONE);

        setContentView(scroll);
    }

    private void requestNeededPermissions() {
        List<String> need = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (!granted(Manifest.permission.BLUETOOTH_SCAN)) need.add(Manifest.permission.BLUETOOTH_SCAN);
            if (!granted(Manifest.permission.BLUETOOTH_CONNECT)) need.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (Build.VERSION.SDK_INT >= 33
                && !granted(Manifest.permission.NEARBY_WIFI_DEVICES)) {
            need.add(Manifest.permission.NEARBY_WIFI_DEVICES);
        }
        if (need.isEmpty()) beginDiscovery();
        else requestPermissions(need.toArray(new String[0]), REQ_PERM);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERM) return;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                showMessage(german
                        ? "Bluetooth-Zugriff ist nötig, um den Sensor zu finden."
                        : "Bluetooth access is needed to find the sensor.");
                return;
            }
        }
        beginDiscovery();
    }

    private void beginDiscovery() {
        looking = true;
        softApMode = false;
        softApReady = false;
        lookingSinceElapsed = SystemClock.elapsedRealtime();
        scanPass = 0;
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        headline.setText(german ? "Sensor suchen" : "Looking for the sensor");
        detail.setText(german
                ? "Sensor neu starten und daneben bleiben. Alles bleibt in der App."
                : "Restart the sensor and stay next to it. Everything stays in the app.");
        startSearchSpinner();
        main.removeCallbacks(stillLooking);
        main.postDelayed(stillLooking, 180000);
        main.removeCallbacks(lookingTick);
        main.postDelayed(lookingTick, 1000);
        // Same as the build that worked: the system device picker finds the sensor (and on
        // Android 11 and older it is the only way without location permission). On Android 12+
        // a plain BLE scan runs in parallel as a second chance.
        boolean cdm = getPackageManager().hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP);
        if (cdm) startCompanionAssociate();
        if (!cdm || Build.VERSION.SDK_INT >= 31) startScan(false);
        // SoftAP in-app path quickly (BLE alone is unreliable on many phones).
        main.removeCallbacks(softApFallback);
        // Board opens SoftAP after ~8s BLE; wait a bit longer so the AP exists.
        main.postDelayed(softApFallback, 75000);
    }

    private final Runnable softApFallback = new Runnable() {
        @Override
        public void run() {
            if (isFinishing() || finishedOk || gatt != null || softApMode) return;
            Log.i(TAG, "starting in-app SoftAP setup");
            startSoftApSetup();
        }
    };

    private void startSoftApSetup() {
        softApAttempts = 0;
        softApMode = true;
        looking = false;
        stopScanOnly();
        stopSearchSpinner();
        main.removeCallbacks(scanRefresh);
        main.removeCallbacks(lookingTick);
        main.removeCallbacks(stillLooking);
        headline.setText(german ? "Sensor-WLAN" : "Sensor Wi-Fi");
        detail.setText(german
                ? "Bestätige die WLAN-Verbindung zum Sensor (AuraHomeSystems_Setup)."
                : "Confirm the Wi-Fi connection to the sensor (AuraHomeSystems_Setup).");
        form.setVisibility(View.VISIBLE);
        action.setVisibility(View.VISIBLE);
        action.setEnabled(false);
        action.setOnClickListener(v -> sendCredentials());
        action.setText(german ? "Warten…" : "Waiting…");
        if (Build.VERSION.SDK_INT >= 29) {
            requestSoftApNetwork();
        } else {
            detail.setText(german
                    ? "Android 10+ nötig für In-App-Setup. Bitte aktualisieren."
                    : "Android 10+ needed for in-app setup. Please update the phone.");
        }
    }

    private void requestSoftApNetwork() {
        if (connectivityManager == null) return;
        releaseSoftApNetwork();
        WifiNetworkSpecifier specifier = new WifiNetworkSpecifier.Builder()
                .setSsid(SETUP_AP_SSID)
                .build();
        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifier)
                .build();
        softApCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                Log.i(TAG, "SoftAP network available");
                softApNetwork = network;
                softApMode = true;
                softApReady = true;
                try {
                    connectivityManager.bindProcessToNetwork(network);
                } catch (Exception e) {
                    Log.w(TAG, "bind SoftAP failed", e);
                }
                main.post(() -> {
                    headline.setText(german ? "Heim-WLAN" : "Home Wi-Fi");
                    detail.setText(german
                            ? "Mit Sensor verbunden. Heim-WLAN und Passwort eintragen, dann Verbinden."
                            : "Linked to the sensor. Enter home Wi-Fi and password, then Connect.");
                    form.setVisibility(View.VISIBLE);
                    action.setVisibility(View.VISIBLE);
                    action.setEnabled(true);
                    action.setOnClickListener(v -> sendCredentials());
                    action.setText(german ? "Verbinden" : "Connect");
                    detail.setText(german
                            ? "Mit Sensor verbunden. WLAN-Liste wird geladen…"
                            : "Linked to the sensor. Loading Wi-Fi list…");
                    new Thread(() -> {
                        waitForSoftApPing();
                        fetchSensorWifiList();
                    }, "AuraSoftApPing").start();
                });
            }

            @Override
            public void onUnavailable() {
                Log.w(TAG, "SoftAP network unavailable");
                // The sensor alternates Bluetooth and Wi-Fi windows, so its setup
                // network is not always on air. Keep asking quietly before giving up.
                if (softApMode && !finishedOk && !isFinishing() && softApAttempts < 8) {
                    softApAttempts++;
                    main.post(() -> {
                        detail.setText(german
                                ? "Sensor-WLAN wird gesucht… Sensor eingeschaltet lassen und in der Nähe bleiben."
                                : "Searching for the sensor Wi-Fi… keep the sensor powered and nearby.");
                        main.postDelayed(() -> {
                            if (softApMode && !softApReady && !finishedOk && !isFinishing()) {
                                requestSoftApNetwork();
                            }
                        }, 1000);
                    });
                    return;
                }
                softApAttempts = 0;
                main.post(() -> {
                    detail.setText(german
                            ? "Sensor-WLAN nicht bestätigt. Sensor neu starten und nochmal versuchen."
                            : "Sensor Wi-Fi not confirmed. Restart the sensor and try again.");
                    action.setEnabled(true);
                    action.setText(german ? "Nochmal" : "Try again");
                    action.setOnClickListener(v -> {
                        action.setOnClickListener(x -> sendCredentials());
                        startSoftApSetup();
                    });
                });
            }

            @Override
            public void onLost(@NonNull Network network) {
                if (network.equals(softApNetwork)) {
                    softApReady = false;
                    Log.w(TAG, "SoftAP network lost");
                }
            }
        };
        connectivityManager.requestNetwork(request, softApCallback);
    }

    private void waitForSoftApPing() {
        for (int i = 0; i < 40 && softApMode && !isFinishing(); i++) {
            try {
                HttpURLConnection c = openOnSoftAp(SETUP_PING_URL);
                c.setConnectTimeout(2000);
                c.setReadTimeout(2000);
                c.setRequestMethod("GET");
                int code = c.getResponseCode();
                String body = readBody(c);
                c.disconnect();
                if (code == 200 && body != null && body.contains("aura")) {
                    Log.i(TAG, "SoftAP ping ok");
                    return;
                }
            } catch (Exception e) {
                Log.d(TAG, "SoftAP ping wait " + i + ": " + e.getMessage());
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException ignored) {
                return;
            }
        }
    }

    private Network findSoftApNetwork() {
        if (connectivityManager == null) return null;
        if (softApNetwork != null) return softApNetwork;
        Network[] all = connectivityManager.getAllNetworks();
        if (all == null) return null;
        for (Network n : all) {
            NetworkCapabilities caps = connectivityManager.getNetworkCapabilities(n);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            // Sensor SoftAP has no internet — prefer that Wi-Fi.
            if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                return n;
            }
        }
        return null;
    }

    private boolean ensureSoftApBound() {
        Network n = findSoftApNetwork();
        if (n == null) return false;
        softApNetwork = n;
        softApMode = true;
        softApReady = true;
        try {
            connectivityManager.bindProcessToNetwork(n);
        } catch (Exception e) {
            Log.w(TAG, "bind SoftAP", e);
        }
        return true;
    }

    private HttpURLConnection openOnSoftAp(String url) throws Exception {
        ensureSoftApBound();
        URL u = new URL(url);
        if (softApNetwork != null) {
            return (HttpURLConnection) softApNetwork.openConnection(u);
        }
        return (HttpURLConnection) u.openConnection();
    }

    private void fetchSensorWifiList() {
        try {
            if (!ensureSoftApBound()) return;
            HttpURLConnection c = openOnSoftAp(SETUP_WIFI_URL);
            c.setConnectTimeout(8000);
            c.setReadTimeout(25000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            String body = readBody(c);
            c.disconnect();
            if (code != 200 || body == null) {
                throw new IllegalStateException("wifi list HTTP " + code);
            }
            JSONArray arr = new JSONArray(body.trim());
            final java.util.ArrayList<String> ssids = new java.util.ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                String ssid = arr.optString(i, "").trim();
                if (ssid.isEmpty() || SETUP_AP_SSID.equals(ssid) || ssids.contains(ssid)) continue;
                ssids.add(ssid);
            }
            main.post(() -> {
                if (isFinishing() || finishedOk) return;
                showWifiSuggestions(ssids);
                detail.setText(german
                        ? (ssids.isEmpty()
                        ? "Keine Netze gefunden — WLAN-Namen manuell eintragen, dann Verbinden."
                        : "Netz antippen oder manuell eintragen, Passwort, dann Verbinden.")
                        : (ssids.isEmpty()
                        ? "No networks found — type the Wi-Fi name, then Connect."
                        : "Tap a network or type it, enter the password, then Connect."));
            });
        } catch (Exception e) {
            Log.w(TAG, "sensor wifi list failed", e);
            main.post(() -> {
                if (isFinishing() || finishedOk) return;
                detail.setText(german
                        ? "WLAN-Liste nicht geladen — Namen manuell eintragen, dann Verbinden."
                        : "Wi-Fi list unavailable — type the name, then Connect.");
            });
        }
    }

    private void showWifiSuggestions(List<String> ssids) {
        networks.removeAllViews();
        if (ssids == null || ssids.isEmpty()) return;
        if (ssidInput.getText().toString().trim().isEmpty()) {
            ssidInput.setText(ssids.get(0));
        }
        for (String ssid : ssids) {
            Button pick = new Button(this);
            pick.setText(ssid);
            pick.setAllCaps(false);
            pick.setTextColor(Color.parseColor("#e2e8f0"));
            pick.setBackgroundColor(Color.TRANSPARENT);
            pick.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            pick.setOnClickListener(v -> ssidInput.setText(ssid));
            networks.addView(pick);
        }
    }

    private static String readBody(HttpURLConnection c) {
        try {
            InputStream in = c.getErrorStream() != null && c.getResponseCode() >= 400
                    ? c.getErrorStream() : c.getInputStream();
            if (in == null) return "";
            BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private void releaseSoftApNetwork() {
        try {
            if (connectivityManager != null) {
                connectivityManager.bindProcessToNetwork(null);
                if (softApCallback != null) {
                    connectivityManager.unregisterNetworkCallback(softApCallback);
                }
            }
        } catch (Exception ignored) {
        }
        softApCallback = null;
        softApNetwork = null;
        softApReady = false;
    }

    private void sendSoftApCredentials(String ssid, String pass, String name) {
        credsSent = true;
        form.setVisibility(View.GONE);
        action.setVisibility(View.GONE);
        showProgress(40, german ? "Verbinden" : "Connecting");
        detail.setText(german
                ? "Sensor erhält WLAN… Das kann bis zu einer Minute dauern."
                : "Sending Wi-Fi to the sensor… This can take up to a minute.");
        final String sendSsid = ssid;
        final String sendPass = pass;
        final String sendName = name;
        new Thread(() -> {
            try {
                if (!ensureSoftApBound()) {
                    throw new IllegalStateException("no softap network");
                }
                // Prove the sensor HTTP is reachable on this network first.
                HttpURLConnection ping = openOnSoftAp(SETUP_PING_URL);
                ping.setConnectTimeout(5000);
                ping.setReadTimeout(5000);
                ping.setRequestMethod("GET");
                int pingCode = ping.getResponseCode();
                String pingBody = readBody(ping);
                ping.disconnect();
                if (pingCode != 200 || pingBody == null || !pingBody.contains("aura")) {
                    throw new IllegalStateException("ping failed " + pingCode + " " + pingBody);
                }
                main.post(() -> showProgress(55, german ? "Verbinden" : "Connecting"));

                JSONObject body = new JSONObject();
                body.put("ssid", sendSsid);
                body.put("pass", sendPass);
                body.put("email", email);
                body.put("name", sendName);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                HttpURLConnection c = openOnSoftAp(SETUP_PROV_URL);
                c.setConnectTimeout(15000);
                c.setReadTimeout(90000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                c.setFixedLengthStreamingMode(bytes.length);
                OutputStream os = c.getOutputStream();
                os.write(bytes);
                os.flush();
                os.close();
                int code = c.getResponseCode();
                String resp = readBody(c);
                c.disconnect();
                Log.i(TAG, "SoftAP prov code=" + code + " body=" + resp);
                main.post(() -> {
                    if (code >= 200 && code < 300) {
                        showProgress(100, german ? "Fertig" : "Done");
                        finishedOk = true;
                        releaseSoftApNetwork();
                        detail.setText(german
                                ? "Sensor ist verbunden. Tippe unten, um zum Dashboard zurückzukehren."
                                : "Sensor is connected. Tap below to return to the dashboard.");
                        showDashboardReturn();
                    } else {
                        credsSent = false;
                        softApReady = true;
                        form.setVisibility(View.VISIBLE);
                        restoreConnectAction();
                        magnets.setVisibility(View.GONE);
                        percent.setVisibility(View.GONE);
                        detail.setText(german
                                ? "Senden fehlgeschlagen. WLAN-Passwort prüfen und nochmal."
                                : "Send failed. Check the Wi-Fi password and try again.");
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "SoftAP prov failed", e);
                main.post(() -> {
                    credsSent = false;
                    softApReady = true;
                    form.setVisibility(View.VISIBLE);
                    restoreConnectAction();
                    magnets.setVisibility(View.GONE);
                    percent.setVisibility(View.GONE);
                    detail.setText(german
                            ? ("Keine Verbindung zum Sensor (" + e.getMessage() + "). Sensor neu starten und nochmal.")
                            : ("Could not reach the sensor (" + e.getMessage() + "). Restart the sensor and try again."));
                });
            }
        }, "AuraSoftApProv").start();
    }

    private void startCompanionAssociate() {
        CompanionDeviceManager cdm = (CompanionDeviceManager) getSystemService(Context.COMPANION_DEVICE_SERVICE);
        if (cdm == null) {
            Log.w(TAG, "no CompanionDeviceManager");
            return;
        }
        AssociationRequest.Builder req = new AssociationRequest.Builder().setSingleDevice(true);
        req.addDeviceFilter(new BluetoothLeDeviceFilter.Builder()
                .setScanFilter(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build())
                .build());
        req.addDeviceFilter(new BluetoothLeDeviceFilter.Builder()
                .setNamePattern(Pattern.compile("^Aura.*"))
                .build());
        Log.i(TAG, "CDM associate start");
        cdm.associate(req.build(), new CompanionDeviceManager.Callback() {
            @Override
            public void onDeviceFound(@NonNull IntentSender chooser) {
                Log.i(TAG, "CDM device found — opening chooser");
                main.post(() -> {
                    if (gatt != null || connecting || isFinishing()) return;
                    detail.setText(german
                            ? "Gerät gefunden — Aura in der Liste wählen."
                            : "Device found — pick Aura in the list.");
                    try {
                        startIntentSenderForResult(chooser, REQ_CDM, null, 0, 0, 0);
                    } catch (IntentSender.SendIntentException e) {
                        Log.e(TAG, "CDM chooser failed", e);
                    }
                });
            }

            @Override
            public void onFailure(CharSequence error) {
                Log.w(TAG, "CDM failure: " + error);
                main.post(() -> {
                    if (!looking || gatt != null) return;
                    startScan(false);
                    detail.setText(german
                            ? "Suche weiter per Bluetooth… Nach ~75s öffnet der Sensor WLAN AuraHomeSystems_Setup."
                            : "Still searching over Bluetooth… After ~75s the sensor opens Wi-Fi AuraHomeSystems_Setup.");
                });
            }
        }, main);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_CDM) return;
        if (gatt != null || connecting) return;
        BluetoothDevice device = null;
        try {
            if (resultCode == RESULT_OK && data != null) {
                if (Build.VERSION.SDK_INT >= 33) {
                    android.companion.AssociationInfo info = data.getParcelableExtra(
                            CompanionDeviceManager.EXTRA_ASSOCIATION,
                            android.companion.AssociationInfo.class);
                    if (info != null && info.getDeviceMacAddress() != null) {
                        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                        if (adapter != null) {
                            device = adapter.getRemoteDevice(info.getDeviceMacAddress().toString());
                        }
                    }
                }
                if (device == null) {
                    android.os.Parcelable extra = Build.VERSION.SDK_INT >= 33
                            ? data.getParcelableExtra(CompanionDeviceManager.EXTRA_DEVICE, ScanResult.class)
                            : data.getParcelableExtra(CompanionDeviceManager.EXTRA_DEVICE);
                    if (extra instanceof ScanResult) device = ((ScanResult) extra).getDevice();
                    else if (extra instanceof BluetoothDevice) device = (BluetoothDevice) extra;
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "CDM result parse failed", e);
        }
        if (device != null) {
            Log.i(TAG, "CDM picked " + device.getAddress());
            try {
                connect(device);
                return;
            } catch (Throwable e) {
                Log.w(TAG, "CDM connect failed", e);
            }
        }
        // Picker cancelled or unusable: keep looking with a normal scan.
        if (looking && gatt == null && !connecting && !isFinishing()) startScan(false);
    }

    private void startScan() {
        startScan(true);
    }

    private void startScan(boolean resetCopy) {
        if (gatt != null || connecting || isFinishing()) return;
        BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            showMessage(german ? "Schalte Bluetooth ein." : "Turn Bluetooth on.");
            return;
        }
        if (!canBle()) return;
        stopScanOnly();
        looking = true;
        if (resetCopy || lookingSinceElapsed == 0L) {
            lookingSinceElapsed = SystemClock.elapsedRealtime();
            scanPass = 0;
        }
        if (resetCopy) {
            headline.setText(german ? "Sensor suchen" : "Looking for the sensor");
            startSearchSpinner();
            main.removeCallbacks(stillLooking);
            main.postDelayed(stillLooking, 90000);
        }
        updateLookingDetail();
        main.removeCallbacks(lookingTick);
        main.postDelayed(lookingTick, 1000);
        main.postDelayed(() -> beginScanPass(adapter), 150);
        main.removeCallbacks(scanRefresh);
        main.postDelayed(scanRefresh, 8000);
    }

    private void beginScanPass(BluetoothAdapter adapter) {
        if (gatt != null || connecting || isFinishing() || !looking) return;
        if (adapter == null || !adapter.isEnabled() || !canBle()) return;
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) return;
        scanning = true;
        scanPass++;
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                .setReportDelay(0)
                .build();
        // Filtered scan only — neverForLocation forbids unfiltered BLE scans.
        List<ScanFilter> filters = new ArrayList<>();
        filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build());
        filters.add(new ScanFilter.Builder().setDeviceName("Aura").build());
        filters.add(new ScanFilter.Builder().setDeviceName("Aura Sensor").build());
        try {
            // Android 12+: hardware name filters are unreliable on some phones; match in software.
            scanner.startScan(Build.VERSION.SDK_INT >= 31 ? null : filters, settings, scanCallback);
            Log.i(TAG, "scan start pass=" + scanPass + " filtered");
            updateLookingDetail();
        } catch (RuntimeException e) {
            scanning = false;
            Log.e(TAG, "scan start failed", e);
        }
    }

    private void updateLookingDetail() {
        if (!looking || detail == null || connecting) return;
        long sec = Math.max(0L, (SystemClock.elapsedRealtime() - lookingSinceElapsed) / 1000L);
        String base = german
                ? ("Suche… " + sec + "s · Scan #" + scanPass + " · Treffer " + scanSeen + " · Android " + Build.VERSION.SDK_INT + (scanNames.isEmpty() ? "" : " · " + scanNames))
                : ("Searching… " + sec + "s · Scan #" + scanPass + " · hits " + scanSeen + " · Android " + Build.VERSION.SDK_INT + (scanNames.isEmpty() ? "" : " · " + scanNames));
        if (sec >= 90) {
            base += german
                    ? " — Falls nichts kommt: Telefon-WLAN → AuraHomeSystems_Setup → 192.168.4.1"
                    : " — If nothing: phone Wi-Fi → AuraHomeSystems_Setup → 192.168.4.1";
        } else {
            base += german
                    ? " — Sensor daneben lassen"
                    : " — keep the sensor next to you";
        }
        detail.setText(base);
    }

    // Many phones stop delivering BLE results until the scan is restarted.
    private final Runnable scanRefresh = new Runnable() {
        @Override
        public void run() {
            if (!looking || gatt != null || connecting || isFinishing()) return;
            Log.i(TAG, "scan refresh");
            startScan(false);
        }
    };

    private final Runnable lookingTick = new Runnable() {
        @Override
        public void run() {
            if (!looking || gatt != null || connecting || isFinishing()) return;
            updateLookingDetail();
            main.postDelayed(this, 1000);
        }
    };

    private void startSearchSpinner() {
        if (searchLogo == null) return;
        searchLogo.setVisibility(View.VISIBLE);
        searchLogo.setRotation(0f);
        if (searchSpin != null && !searchSpin.isStarted()) searchSpin.start();
    }

    private void stopSearchSpinner() {
        if (searchSpin != null) searchSpin.cancel();
        if (searchLogo != null) {
            searchLogo.setRotation(0f);
            searchLogo.setVisibility(View.GONE);
        }
    }

    private final Runnable stillLooking = new Runnable() {
        @Override
        public void run() {
            if (gatt != null || isFinishing()) return;
            detail.setText(german
                    ? "Kein Bluetooth. Nach ~75s: Telefon-WLAN → AuraHomeSystems_Setup → Browser 192.168.4.1. Oder Reset der Platine."
                    : "No Bluetooth link. After ~75s: phone Wi-Fi → AuraHomeSystems_Setup → browser 192.168.4.1. Or reset the board.");
        }
    };

    private final BroadcastReceiver bluetoothReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
            if (state == BluetoothAdapter.STATE_ON) startScan();
        }
    };

    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(bluetoothReceiver, filter);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (looking && gatt == null && !connecting && !isFinishing()) {
            startScan(false);
        }
    }

    @Override
    protected void onStop() {
        try {
            unregisterReceiver(bluetoothReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        super.onStop();
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            scanSeen++;
            String name = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
            if (name == null && result.getDevice() != null) name = result.getDevice().getName();
            if (name != null) {
                Log.d(TAG, "seen ble name=" + name);
                if (scanNames.size() < 5 && !scanNames.contains(name)) scanNames.add(name);
            }
            if (!isAura(result)) return;
            Log.i(TAG, "scan hit aura " + (result.getDevice() != null ? result.getDevice().getAddress() : "?"));
            main.post(() -> connect(result.getDevice()));
        }

        @Override
        public void onBatchScanResults(List<ScanResult> results) {
            if (results == null) return;
            for (ScanResult result : results) {
                if (isAura(result)) {
                    Log.i(TAG, "batch hit aura");
                    main.post(() -> connect(result.getDevice()));
                    return;
                }
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            Log.w(TAG, "scan failed code=" + errorCode);
            main.post(() -> {
                if (looking && gatt == null && !connecting) {
                    main.removeCallbacks(scanRefresh);
                    main.postDelayed(scanRefresh, 8000);
                }
            });
        }
    };

    private boolean isAura(ScanResult result) {
        String name = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
        if (name == null && result.getDevice() != null) name = result.getDevice().getName();
        if (name != null && (name.equals("Aura") || name.equals("Aura Sensor") || name.startsWith("Aura"))) return true;
        if (result.getScanRecord() == null || result.getScanRecord().getServiceUuids() == null) return false;
        return result.getScanRecord().getServiceUuids().contains(new ParcelUuid(SERVICE));
    }

    private void connect(BluetoothDevice device) {
        if (gatt != null || connecting || device == null || softApMode) return;
        connecting = true;
        looking = false;
        main.removeCallbacks(softApFallback);
        main.removeCallbacks(scanRefresh);
        main.removeCallbacks(lookingTick);
        main.removeCallbacks(stillLooking);
        stopScanOnly();
        stopSearchSpinner();
        Log.i(TAG, "connectGatt " + device.getAddress());
        headline.setText(german ? "Sensor gefunden" : "Sensor found");
        detail.setText(german ? "Verbindung wird aufgebaut." : "Connecting to the sensor.");
        if (!canBle()) {
            connecting = false;
            looking = true;
            startScan(true);
            return;
        }
        if (Build.VERSION.SDK_INT >= 23) {
            gatt = device.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } else {
            gatt = device.connectGatt(this, false, gattCallback);
        }
        main.postDelayed(connectWatchdog, 12000);
    }

    private final Runnable connectWatchdog = new Runnable() {
        @Override
        public void run() {
            if (isFinishing() || finishedOk) return;
            if (form != null && form.getVisibility() == View.VISIBLE) return;
            if (gatt != null) {
                try {
                    if (canBle()) gatt.close();
                } catch (RuntimeException ignored) {
                }
                gatt = null;
            }
            connecting = false;
            looking = true;
            detail.setText(german
                    ? "Verbindung abgebrochen — suche erneut…"
                    : "Connection stalled — searching again…");
            startScan(false);
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            Log.i(TAG, "gatt state=" + newState + " status=" + status);
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (canBle()) g.requestMtu(247);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                main.post(() -> onDisconnected());
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS && mtu > 23) negotiatedMtu = mtu;
            if (canBle()) g.discoverServices();
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic characteristic, int status) {
            if (!CRED.equals(characteristic.getUuid())) return;
            main.post(() -> {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    credsSent = false;
                    pendingWrites.clear();
                    form.setVisibility(View.VISIBLE);
                    action.setVisibility(View.VISIBLE);
                    detail.setText(german
                            ? "Senden fehlgeschlagen. Nochmal versuchen."
                            : "Could not send. Try again.");
                    return;
                }
                writeNextChunk();
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            BluetoothGattCharacteristic stat = characteristic(STAT);
            if (stat == null || !canBle()) {
                main.post(() -> showMessage(german ? "Der Sensor antwortet nicht." : "The sensor did not respond."));
                return;
            }
            g.setCharacteristicNotification(stat, true);
            BluetoothGattDescriptor desc = stat.getDescriptor(CCCD);
            if (desc != null) {
                if (Build.VERSION.SDK_INT >= 33) {
                    g.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                } else {
                    desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    g.writeDescriptor(desc);
                }
            } else if (canBle()) {
                g.readCharacteristic(characteristic(LIST));
            }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            BluetoothGattCharacteristic list = characteristic(LIST);
            if (list != null && canBle()) g.readCharacteristic(list);
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic characteristic, int status) {
            if (LIST.equals(characteristic.getUuid())) {
                showNetworks(valueOf(characteristic));
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            if (STAT.equals(characteristic.getUuid())) applyStatus(valueOf(characteristic));
            if (LIST.equals(characteristic.getUuid())) showNetworks(valueOf(characteristic));
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (STAT.equals(characteristic.getUuid())) applyStatus(new String(value, StandardCharsets.UTF_8));
            if (LIST.equals(characteristic.getUuid())) showNetworks(new String(value, StandardCharsets.UTF_8));
        }
    };

    private void showNetworks(String raw) {
        main.post(() -> {
            if (credsSent) return;
            main.removeCallbacks(connectWatchdog);
            connecting = false;
            looking = false;
            stopSearchSpinner();
            form.setVisibility(View.VISIBLE);
            action.setVisibility(View.VISIBLE);
            headline.setText(german ? "Heim-WLAN" : "Home Wi-Fi");
            detail.setText(german ? "Passwort und Name eingeben." : "Enter the password and a name.");
            networks.removeAllViews();
            String current = ssidInput.getText().toString().trim();
            for (String part : raw.split("\n")) {
                String ssid = part.trim();
                if (ssid.isEmpty()) continue;
                if (current.isEmpty()) {
                    ssidInput.setText(ssid);
                    current = ssid;
                }
                Button pick = new Button(this);
                pick.setText(ssid);
                pick.setAllCaps(false);
                pick.setTextColor(Color.parseColor("#e2e8f0"));
                pick.setBackgroundColor(Color.TRANSPARENT);
                pick.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                pick.setOnClickListener(v -> ssidInput.setText(ssid));
                networks.addView(pick);
            }
        });
    }

    private void sendCredentials() {
        String ssid = ssidInput.getText().toString().trim();
        String pass = passInput.getText().toString();
        String name = nameInput.getText().toString().trim();
        if (ssid.isEmpty()) {
            detail.setText(german ? "WLAN-Name fehlt." : "Enter the Wi-Fi name.");
            return;
        }
        if (name.isEmpty()) name = "Front Door";
        if (existingSensorKeys.contains(sensorKey(name))) {
            detail.setText(german
                    ? "Du hast bereits einen Sensor mit dem Namen „" + name + "“. Bitte wähle einen anderen Namen."
                    : "You already have a sensor named “" + name + "”. Please choose a different name.");
            return;
        }
        // SoftAP path (primary): always try if BLE GATT is not up.
        if (softApMode || gatt == null) {
            softApMode = true;
            if (!ensureSoftApBound()) {
                detail.setText(german
                        ? "Noch nicht mit dem Sensor-WLAN verbunden. Bitte die WLAN-Anfrage bestätigen, dann nochmal Verbinden."
                        : "Not linked to the sensor Wi-Fi yet. Confirm the Wi-Fi prompt, then tap Connect again.");
                action.setEnabled(true);
                startSoftApSetup();
                return;
            }
            detail.setText(german ? "Sende an den Sensor…" : "Sending to the sensor…");
            action.setEnabled(false);
            sendSoftApCredentials(ssid, pass, name);
            return;
        }
        BluetoothGattCharacteristic cred = characteristic(CRED);
        if (cred == null || !canBle()) {
            softApMode = true;
            startSoftApSetup();
            return;
        }
        try {
            JSONObject body = new JSONObject();
            body.put("ssid", ssid);
            body.put("pass", pass);
            body.put("email", email);
            body.put("name", name);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            int payload = Math.max(20, negotiatedMtu - 5);
            pendingWrites.clear();
            int offset = 0;
            boolean first = true;
            while (offset < bytes.length) {
                int take = Math.min(payload - (first ? 0 : 1), bytes.length - offset);
                if (take < 1) take = 1;
                if (first) {
                    byte[] chunk = new byte[take];
                    System.arraycopy(bytes, offset, chunk, 0, take);
                    pendingWrites.addLast(chunk);
                    first = false;
                } else {
                    byte[] chunk = new byte[take + 1];
                    chunk[0] = '+';
                    System.arraycopy(bytes, offset, chunk, 1, take);
                    pendingWrites.addLast(chunk);
                }
                offset += take;
            }
            credsSent = true;
            form.setVisibility(View.GONE);
            action.setVisibility(View.GONE);
            showProgress(45, german ? "Verbinden" : "Connecting");
            detail.setText(german
                    ? "WLAN wird geprüft. Das kann bis zu einer Minute dauern."
                    : "Checking Wi-Fi. This can take up to a minute.");
            writeNextChunk();
        } catch (Exception e) {
            credsSent = false;
            pendingWrites.clear();
            detail.setText(german ? "Senden fehlgeschlagen. Nochmal versuchen." : "Could not send. Try again.");
        }
    }

    private void writeNextChunk() {
        BluetoothGattCharacteristic cred = characteristic(CRED);
        if (gatt == null || cred == null || !canBle()) return;
        byte[] chunk = pendingWrites.pollFirst();
        if (chunk == null) return;
        if (Build.VERSION.SDK_INT >= 33) {
            gatt.writeCharacteristic(cred, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        } else {
            cred.setValue(chunk);
            cred.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            gatt.writeCharacteristic(cred);
        }
    }

    private void applyStatus(String raw) {
        String text = raw == null ? "" : raw.trim();
        main.post(() -> {
            int pct = 0;
            String stage = text;
            int space = text.indexOf(' ');
            if (space > 0) {
                try {
                    pct = Integer.parseInt(text.substring(0, space));
                } catch (NumberFormatException ignored) {
                    pct = 0;
                }
                stage = text.substring(space + 1).trim();
            }
            if ("badwifi".equals(stage)) {
                credsSent = false;
                shownPct = 0;
                targetPct = 0;
                main.removeCallbacks(magnetTick);
                form.setVisibility(View.VISIBLE);
                action.setVisibility(View.VISIBLE);
                percent.setVisibility(View.GONE);
                magnets.setVisibility(View.GONE);
                headline.setText(german ? "Heim-WLAN" : "Home Wi-Fi");
                detail.setText(german
                        ? "WLAN-Name oder Passwort wurde nicht akzeptiert. Nimm das 2,4-GHz-Netz, nicht 5 GHz."
                        : "The Wi-Fi name or password was not accepted. Use the 2.4 GHz network, not 5 GHz.");
                return;
            }
            if ("bademail".equals(stage)) {
                credsSent = false;
                shownPct = 0;
                targetPct = 0;
                main.removeCallbacks(magnetTick);
                form.setVisibility(View.VISIBLE);
                action.setVisibility(View.VISIBLE);
                percent.setVisibility(View.GONE);
                magnets.setVisibility(View.GONE);
                headline.setText(german ? "Heim-WLAN" : "Home Wi-Fi");
                detail.setText(german
                        ? "Diese E-Mail hat kein Aura-Konto."
                        : "That email does not have an Aura account.");
                return;
            }
            if ("ok".equals(stage) || pct >= 100) {
                finishedOk = true;
                showProgress(100, german ? "Verbunden" : "Connected");
                detail.setText(german
                        ? "Sensor ist verbunden. Tippe unten, um zum Dashboard zurückzukehren."
                        : "Sensor is connected. Tap below to return to the dashboard.");
                showDashboardReturn();
                return;
            }
            if (pct > 0) showProgress(pct, german ? "Verbinden" : "Connecting");
        });
    }

    private void showProgress(int pct, String title) {
        stopSearchSpinner();
        percent.setVisibility(View.VISIBLE);
        magnets.setVisibility(View.VISIBLE);
        headline.setText(title);
        targetPct = Math.max(0, Math.min(100, pct));
        main.removeCallbacks(magnetTick);
        main.post(magnetTick);
    }

    private static int blend(int from, int to, float t) {
        float clamped = Math.max(0f, Math.min(1f, t));
        int r = (int) (Color.red(from) + (Color.red(to) - Color.red(from)) * clamped);
        int g = (int) (Color.green(from) + (Color.green(to) - Color.green(from)) * clamped);
        int b = (int) (Color.blue(from) + (Color.blue(to) - Color.blue(from)) * clamped);
        return Color.rgb(r, g, b);
    }

    private static final class MagnetView extends View {
        private int pct;
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint beam = new Paint(Paint.ANTI_ALIAS_FLAG);

        MagnetView(android.content.Context context) {
            super(context);
            ring.setStyle(Paint.Style.STROKE);
            beam.setStyle(Paint.Style.FILL);
        }

        void setPct(int value) {
            pct = Math.max(0, Math.min(100, value));
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float t = pct / 100f;
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            float radius = Math.min(getWidth(), getHeight()) * 0.36f;
            int color = blend(Color.parseColor("#ef4444"), Color.parseColor("#4ade80"), t);
            ring.setStrokeWidth(radius * 0.18f);
            ring.setColor(color);
            float gapDeg = 90f * (1f - t);
            canvas.drawArc(cx - radius, cy - radius, cx + radius, cy + radius, 210f, 360f - gapDeg, false, ring);
            float magW = radius * 0.78f;
            float magH = radius * 0.24f;
            float gapPx = radius * (0.46f - 0.38f * t);
            float top = cy - gapPx / 2f - magH;
            float bottom = cy + gapPx / 2f;
            body.setShader(new LinearGradient(0, top, 0, top + magH, Color.WHITE, Color.parseColor("#64748b"), Shader.TileMode.CLAMP));
            float corner = magH / 2f;
            canvas.drawRoundRect(cx - magW / 2f, top, cx + magW / 2f, top + magH, corner, corner, body);
            body.setShader(new LinearGradient(0, bottom, 0, bottom + magH, Color.WHITE, Color.parseColor("#64748b"), Shader.TileMode.CLAMP));
            canvas.drawRoundRect(cx - magW / 2f, bottom, cx + magW / 2f, bottom + magH, corner, corner, body);
            if (t < 0.98f) {
                beam.setColor(color);
                canvas.drawRoundRect(cx - radius * 0.035f, cy - gapPx / 2f, cx + radius * 0.035f, cy + gapPx / 2f, 3f, 3f, beam);
            }
        }
    }

    private void onDisconnected() {
        main.removeCallbacks(connectWatchdog);
        gatt = null;
        connecting = false;
        if (finishedOk || isFinishing()) return;
        if (credsSent) {
            showMessage(german
                    ? "Der Sensor hat die Verbindung verloren. Bleib daneben und versuch es nochmal."
                    : "The sensor disconnected. Stay next to it and try again.");
            credsSent = false;
        }
        looking = true;
        startScan(true);
    }

    private void showMessage(String message) {
        stopSearchSpinner();
        headline.setText(german ? "Sensor" : "Sensor");
        detail.setText(message);
        form.setVisibility(View.GONE);
        action.setVisibility(View.GONE);
    }

    private BluetoothGattCharacteristic characteristic(UUID uuid) {
        if (gatt == null || gatt.getService(SERVICE) == null) return null;
        return gatt.getService(SERVICE).getCharacteristic(uuid);
    }

    private static String valueOf(BluetoothGattCharacteristic characteristic) {
        byte[] raw = characteristic.getValue();
        if (raw == null) return "";
        return new String(raw, StandardCharsets.UTF_8);
    }

    private boolean granted(String permission) {
        return ActivityCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canBle() {
        if (Build.VERSION.SDK_INT >= 31) {
            return granted(Manifest.permission.BLUETOOTH_CONNECT) && granted(Manifest.permission.BLUETOOTH_SCAN);
        }
        return true;
    }

    private void showDashboardReturn() {
        action.setVisibility(View.VISIBLE);
        action.setEnabled(true);
        action.setText(german ? "Zum Dashboard" : "Back to dashboard");
        action.setOnClickListener(v -> finish());
    }

    private void restoreConnectAction() {
        action.setVisibility(View.VISIBLE);
        action.setEnabled(true);
        action.setText(german ? "Verbinden" : "Connect");
        action.setOnClickListener(v -> sendCredentials());
    }

    private void stopScanOnly() {
        main.removeCallbacks(scanRefresh);
        if (!scanning || scanner == null) {
            scanning = false;
            return;
        }
        try {
            if (canBle()) scanner.stopScan(scanCallback);
        } catch (RuntimeException ignored) {
        }
        scanning = false;
    }

    private void stopScan() {
        looking = false;
        stopScanOnly();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView label(String text, int sp, String color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(Color.parseColor(color));
        return view;
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(Color.parseColor("#64748b"));
        input.setTextColor(Color.parseColor("#f8fafc"));
        input.setSingleLine(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#020617"));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.parseColor("#334155"));
        input.setBackground(bg);
        input.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        lp.bottomMargin = dp(8);
        input.setLayoutParams(lp);
        return input;
    }

    @Override
    protected void onDestroy() {
        looking = false;
        connecting = false;
        main.removeCallbacks(softApFallback);
        main.removeCallbacks(scanRefresh);
        main.removeCallbacks(lookingTick);
        main.removeCallbacks(stillLooking);
        main.removeCallbacks(connectWatchdog);
        stopSearchSpinner();
        stopScanOnly();
        releaseSoftApNetwork();
        if (gatt != null) {
            if (canBle()) gatt.close();
            gatt = null;
        }
        super.onDestroy();
    }
}
