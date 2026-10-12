#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// --- FIREBASE (same as sensors) ---
#define FIREBASE_HOST "https://cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app"
#define FIREBASE_AUTH "5h8JwKgmM9yFZuzBlCYSQ9mPEjdWPq552l7U9irF"
#define EMAIL_CHECK_URL "https://cleverhaus.onrender.com/api/device-link"

// XIAO ESP32-C3: D1 = GPIO 3. Most 5V relay modules are active-LOW.
#if CONFIG_IDF_TARGET_ESP32C3
#define RELAY_PIN 3
#else
#define RELAY_PIN 16
#endif
// DFR0457 MOSFET: HIGH on SIG turns load ON, LOW turns load OFF.
#define SIREN_SWITCH_ACTIVE_LOW false

#define POLL_MS 2000
#define DEVICE_NAME_DEFAULT "Siren"
#define SIREN_FIRMWARE_VERSION "2026-09-10-3"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

char user_email[64];
Preferences prefs;
bool shouldSaveConfig = false;

String userPath;
bool relayOn = false;
String pendingSirenEventId;

void saveConfigCallback() {
    shouldSaveConfig = true;
}

static void loadConfigFromNvs() {
    prefs.begin("aura_siren", true);
    String e = prefs.getString("email", "");
    e.trim();
    if (e.length() > 0) {
        strncpy(user_email, e.c_str(), sizeof(user_email) - 1);
        user_email[sizeof(user_email) - 1] = '\0';
    } else {
        user_email[0] = '\0';
    }
    prefs.end();
}

static void saveConfigToNvs() {
    prefs.begin("aura_siren", false);
    prefs.putString("email", user_email);
    prefs.end();
}

static bool emailLooksValid(const char* email) {
    if (!email || email[0] == '\0') return false;
    const char* at = strchr(email, '@');
    if (!at || at == email || *(at + 1) == '\0') return false;
    return strchr(at + 1, '.') != NULL;
}

static String getSafeEmailKey(const char* email) {
    String safe = String(email);
    safe.trim();
    safe.toLowerCase();
    safe.replace(".", "-");
    safe.replace("@", "_at_");
    return safe;
}

static int checkEmailRegistered(const char* email) {
    if (WiFi.status() != WL_CONNECTED) return -1;
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    if (!http.begin(client, EMAIL_CHECK_URL)) return -1;
    http.setTimeout(60000);
    http.addHeader("Content-Type", "application/json");
    StaticJsonDocument<128> doc;
    doc["email"] = email;
    String body;
    serializeJson(doc, body);
    int code = http.POST(body);
    String resp = (code > 0) ? http.getString() : String();
    http.end();
    if (code != 200) return -1;
    StaticJsonDocument<256> rd;
    if (deserializeJson(rd, resp)) return -1;
    if (!rd["registered"].is<bool>()) return -1;
    return rd["registered"].as<bool>() ? 1 : 0;
}

static bool readBoolPath(const String& path, bool& value) {
    if (Firebase.RTDB.getBool(&fbdo, path)) {
        if (fbdo.dataType() == "boolean") {
            value = fbdo.boolData();
            return true;
        }
    }
    return false;
}

static int64_t readIntPath(const String& path, int64_t defaultValue) {
    if (Firebase.RTDB.getInt(&fbdo, path)) {
        if (fbdo.dataType() == "int" || fbdo.dataType() == "double") {
            return fbdo.intData();
        }
    }
    return defaultValue;
}

// Sensor devices store status=true (closed) / false (open).
static int64_t timestampMsNow() {
    time_t nowSec = 0;
    time(&nowSec);
    if (nowSec > 1700000000L) return (int64_t)nowSec * 1000;
    return (int64_t)millis();
}

static void syncTimeQuick() {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    for (int i = 0; i < 25; i++) {
        time_t nowSec = 0;
        time(&nowSec);
        if (nowSec > 1700000000L) return;
        delay(200);
    }
}

static bool anySensorOpen(const String& path) {
    if (!Firebase.RTDB.getJSON(&fbdo, path + "/devices")) {
        Serial.println("devices read failed");
        return false;
    }

    const String devicesJson = fbdo.jsonString();
    DynamicJsonDocument doc(16384);
    DeserializationError error = deserializeJson(doc, devicesJson);
    if (error) {
        Serial.print("devices JSON error: ");
        Serial.println(error.c_str());
        return false;
    }

    for (JsonPair device : doc.as<JsonObject>()) {
        JsonVariant status = device.value()["status"];
        if (status.is<bool>() && status.as<bool>() == false) {
            return true;
        }
        if (status.is<int>() && status.as<int>() == 0) {
            return true;
        }
        if (status.is<const char*>()) {
            String value = status.as<const char*>();
            value.toLowerCase();
            if (value == "false" || value == "open" || value == "0") {
                return true;
            }
        }
    }

    Serial.print("No open sensor in: ");
    Serial.println(devicesJson);
    return false;
}

static void setRelay(bool on) {
    if (relayOn == on) return;
    relayOn = on;
    const int level = SIREN_SWITCH_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW);
    digitalWrite(RELAY_PIN, level);
    Serial.printf(
        "Siren %s; GPIO%d=%d\n",
        on ? "ON" : "OFF",
        RELAY_PIN,
        digitalRead(RELAY_PIN));
}

static void publishSirenState(bool active) {
    FirebaseJson json;
    json.set("online", true);
    json.set("active", active);
    json.set("lastSeen", timestampMsNow());
    Firebase.RTDB.updateNode(&fbdo, userPath + "/siren", &json);
}

static bool publishPendingSirenEvent() {
    if (pendingSirenEventId.length() == 0) return true;

    FirebaseJson json;
    json.set("createdAt", timestampMsNow());
    json.set("source", "sensor_open");
    json.set("firmwareVersion", SIREN_FIRMWARE_VERSION);
    const String eventPath = userPath + "/sirenEvents/" + pendingSirenEventId;
    if (!Firebase.RTDB.setJSON(&fbdo, eventPath, &json)) {
        Serial.print("Siren event publish failed: ");
        Serial.println(fbdo.errorReason());
        return false;
    }

    Serial.print("Siren event published: ");
    Serial.println(pendingSirenEventId);
    pendingSirenEventId = "";
    return true;
}

static bool shouldSoundAlarm() {
    static bool alarmLatched = false;
    static bool enabledKnown = false;
    static bool lastEnabled = false;
    bool freshEnabled = false;
    if (readBoolPath(userPath + "/siren/enabled", freshEnabled)) {
        lastEnabled = freshEnabled;
        enabledKnown = true;
    } else {
        Serial.println("enabled read failed; keeping last safe state");
    }
    const bool enabled = enabledKnown && lastEnabled;
    if (!enabled) {
        alarmLatched = false;
        Serial.println("enabled=false open=false latched=false test=false");
        return false;
    }

    int64_t testUntil = readIntPath(userPath + "/siren/testUntil", 0);
    const bool testing = testUntil > 0 && timestampMsNow() < testUntil;
    const bool sensorOpen = anySensorOpen(userPath);
    if (sensorOpen) {
        alarmLatched = true;
    }
    Serial.printf(
        "enabled=true open=%s latched=%s test=%s\n",
        sensorOpen ? "true" : "false",
        alarmLatched ? "true" : "false",
        testing ? "true" : "false");
    return alarmLatched || testing;
}

static void runWifiPortal() {
    WiFiManager wm;
    wm.setSaveConfigCallback(saveConfigCallback);
    WiFiManagerParameter custom_email(
        "fbemail",
        "Email (same as Aura account)",
        user_email,
        sizeof(user_email) - 1);
    wm.addParameter(&custom_email);
    Serial.println("Opening AuraHomeSystems_Siren setup...");
    if (!wm.startConfigPortal("AuraHomeSystems_Siren")) {
        Serial.println("Portal timeout - restart");
        delay(2000);
        ESP.restart();
    }
    strncpy(user_email, custom_email.getValue(), sizeof(user_email) - 1);
    user_email[sizeof(user_email) - 1] = '\0';
    String e = String(user_email);
    e.trim();
    e.toLowerCase();
    e.toCharArray(user_email, sizeof(user_email));
    if (!emailLooksValid(user_email)) {
        Serial.println("Invalid email - restart");
        delay(2000);
        ESP.restart();
    }
    if (shouldSaveConfig) {
        saveConfigToNvs();
    }
    int reg = checkEmailRegistered(user_email);
    if (reg == 0) {
        Serial.println("Email not registered - fix in portal");
        prefs.begin("aura_siren", false);
        prefs.remove("email");
        prefs.end();
        delay(1000);
        ESP.restart();
    }
}

void setup() {
    pinMode(RELAY_PIN, OUTPUT);
    digitalWrite(RELAY_PIN, SIREN_SWITCH_ACTIVE_LOW ? HIGH : LOW);
    relayOn = false;

    Serial.begin(115200);
    delay(300);
    Serial.print("Aura Siren firmware ");
    Serial.println(SIREN_FIRMWARE_VERSION);

    loadConfigFromNvs();
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);

    if (!emailLooksValid(user_email)) {
        runWifiPortal();
    } else {
        WiFiManager wm;
        wm.setConfigPortalTimeout(180);
        if (!wm.autoConnect("AuraHomeSystems_Siren")) {
            runWifiPortal();
        }
    }

    Serial.print("WiFi OK: ");
    Serial.println(WiFi.localIP());

    config.database_url = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    syncTimeQuick();

    userPath = "/users/" + getSafeEmailKey(user_email);
    Serial.print("User path: ");
    Serial.println(userPath);

    FirebaseJson boot;
    boot.set("online", true);
    boot.set("active", false);
    boot.set("lastSeen", timestampMsNow());
    Firebase.RTDB.updateNode(&fbdo, userPath + "/siren", &boot);

    Serial.println("Aura Siren ready.");
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        setRelay(false);
        Serial.println("WiFi lost - reconnecting...");
        WiFi.reconnect();
        delay(2000);
        return;
    }

    bool alarm = shouldSoundAlarm();
    const bool justActivated = alarm && !relayOn;
    if (justActivated) {
        char eventId[40];
        snprintf(
            eventId,
            sizeof(eventId),
            "%lld-%lu",
            (long long)timestampMsNow(),
            (unsigned long)millis());
        pendingSirenEventId = eventId;
    }
    setRelay(alarm);
    publishPendingSirenEvent();
    publishSirenState(alarm);
    delay(POLL_MS);
}
