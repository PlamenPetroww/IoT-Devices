#include <WiFi.h>
#include <WebServer.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "esp_sleep.h"
#include "esp_system.h"
#if CONFIG_IDF_TARGET_ESP32 || CONFIG_IDF_TARGET_ESP32S3
#include "driver/rtc_io.h"
#endif
#if CONFIG_IDF_TARGET_ESP32C3 || CONFIG_IDF_TARGET_ESP32S3
#include "driver/gpio.h"
#endif
// ========== DEEP SLEEP ==========
// 1: The chip sleeps after every send ÔÇö it does NOT transmit continuously. A new record comes on a
//    magnet change (GPIO wakeup) and/or on the heartbeat timer below (if > 0).
// 0: Always awake ÔÇö sends on change + periodic battery updates (old mode, for testing).
#define USE_DEEP_SLEEP 1
// After reset, wait this many ms BEFORE Wi-Fi/sleep ÔÇö for sketch upload and Serial Monitor. Battery product: 0.
#if USE_DEEP_SLEEP
#define UPLOAD_GRACE_MS 0
#else
#define UPLOAD_GRACE_MS 0
#endif
// 1 = lastSeen/history via Firebase .sv (if the library supports it). 0 = millis() ÔÇö more reliable for writes.
#define RTDB_USE_SV_TIMESTAMP 0
// With deep sleep: 0 = magnet only. E.g. 3600 = also send once per hour (alive check, battery).
#define DEEP_SLEEP_HEARTBEAT_SEC 3600
// Tools → USB CDC On Boot → Enabled (so Serial Monitor works over USB).
// Tools → Partition Scheme → Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS).
#define FW_VERSION "1.1.35"
#define SETUP_AP_SSID "AuraHomeSystems_Setup"
#define FW_CHANNEL_PATH "/firmware/aura-sensor"
// 0 = disabled. If >0: only when powerSource is "battery" and % is below the threshold.
#define LOW_BATT_SKIP_WIFI_PCT 0
#define LOW_BATT_RETRY_SEC (6UL * 3600UL)
// --- FIREBASE CONFIGURATION ---
#define FIREBASE_HOST "https://cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app"
// WARNING: legacy Database Secret is deprecated/not recommended; for production ÔåÆ Service Account or other auth.
#define FIREBASE_AUTH "5h8JwKgmM9yFZuzBlCYSQ9mPEjdWPq552l7U9irF"
// Render API ÔÇö FCM push on magnet change (only when systemEnabled=true).
#define PUSH_API_URL "https://cleverhaus.onrender.com/api/sensor-event"
// Checks whether the email has a registered account (returns registered: true/false, creates nothing).
#define EMAIL_CHECK_URL "https://cleverhaus.onrender.com/api/device-link"
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
// Reed to GND when "active": INPUT_PULLUP. For lower sleep current use an external 100kÔÇô1M pull-up to 3V3.
const int sensorPin = 4;
// Rev A PCB + reed mount: magnet near (door/window closed) → GPIO4 HIGH → CLOSED.
// Set to 1 only if your reed pulls LOW when closed instead.
#define SENSOR_CLOSED_WHEN_LOW 0
// One-time NVS polarity migrate to Rev A default; Firebase can still override per device.
#define POLARITY_REV 2
// Battery ADC: Rev A uses GPIO0 with 1M / 1M divider from VBAT (pin sees VBAT/2).
// Classic ESP32 breadboard often uses GPIO34. Without a divider the reading is invalid.
#if CONFIG_IDF_TARGET_ESP32C3
#define BATTERY_ADC_PIN 0
#else
#define BATTERY_ADC_PIN 34
#endif
#define BATTERY_ADC_DIVIDER 2
#define BATTERY_ADC_MIN_PIN_MV 180
#define USB_DETECT_PIN -1
#define BATTERY_LOW_PCT 20
static int lastBatteryMv = -1;
// --- Defaults (after first entry via the portal they are kept in flash) ---
#define DEVICE_NAME_DEFAULT "Senzor1"
// ---
char user_email[64];
char device_name[30];
bool closedWhenLow = (SENSOR_CLOSED_WHEN_LOW != 0);
Preferences prefs;
static void loadSensorConfigFromNvs();
static void saveSensorConfigToNvs();
static bool emailLooksValid(const char* email);
static String getSafeEmailKey(const char* email);
static bool connectWifiFast();
static void syncTimeQuick();
static int64_t timestampMsNow();
static bool firmwareVersionNewer(const String& remote, const String& local);
static void maybeApplyFirmwareUpdate(int batteryPct, const char* powerSource, bool allowOta);
static bool enqueueSensorEvent(bool closed, bool force);
static bool removeQueuedSensorEvent(uint32_t sequence, int8_t acknowledgedStatus, bool updateAck);
static bool readSensorClosedDebounced();
static bool readSensorClosedStable();
static int wakeLevelForClosed(bool closed);
static void invertQueuedEventPolarity();
static void adoptHistStatusOnce(const String& userPath, const String& deviceID);
static void syncClosedWhenLowFromFirebase(const String& userPath, const String& deviceID);
String transliterateToLatin(String s);
String getDeviceIdFromName(char* device_name_ptr);
String buildHistoryKey(const String& deviceID, bool isClosed, unsigned long tsMs);
String buildQueuedHistoryKey(const String& deviceID, uint32_t sequence, uint32_t nonce);
int readBatteryPercent(char* powerSourceOut, size_t powerSourceLen);
static const char * batteryStatusLabel(const char* powerSource, int batteryPct);
static bool readSystemEnabled(const String& userPath);
static int checkEmailRegistered(const char* email);
static void armDeepSleepGpioWakeup(int wakeLevel);
static void provNotify(const char* msg);
static String provScanWifi();
static void provSleepRetry();
static bool runBleSetup();
static bool runSoftApSetup();
static bool isPowerOnReset();
void setup();
void loop();
static void loadSensorConfigFromNvs() {
    prefs.begin("aura", true);
    String e = prefs.getString("email", "");
    e.trim();
    if (e.length() > 0) {
        strncpy(user_email, e.c_str(), sizeof(user_email) - 1);
        user_email[sizeof(user_email) - 1] = '\0';
    } else {
        user_email[0] = '\0';
    }
    String n = prefs.getString("dname", "");
    n.trim();
    if (n.length() > 0) {
        strncpy(device_name, n.c_str(), sizeof(device_name) - 1);
        device_name[sizeof(device_name) - 1] = '\0';
    } else {
        device_name[0] = '\0';
    }
    // Keep NVS polarity. Forcing true every wake broke Garage (Firebase false)
    // and caused duplicate Closed history → push gate skipped Closed alerts.
    // POLARITY_REV once flips wrong factory default (HIGH=closed on Rev A) to false;
    // Firebase closedWhenLow still wins after sync for Terasa / Garage / etc.
    int polRev = prefs.getInt("pol_rev", 0);
    if (polRev < POLARITY_REV) {
        prefs.end();
        prefs.begin("aura", false);
        closedWhenLow = (SENSOR_CLOSED_WHEN_LOW != 0);
        prefs.putBool("cwl", closedWhenLow);
        prefs.putInt("pol_rev", POLARITY_REV);
        prefs.end();
        prefs.begin("aura", true);
    } else {
        closedWhenLow = prefs.getBool("cwl", (SENSOR_CLOSED_WHEN_LOW != 0));
    }
    if (prefs.getString("uid", "").length() > 0) {
        prefs.end();
        prefs.begin("aura", false);
        prefs.remove("uid");
        prefs.end();
    } else {
        prefs.end();
    }
    if (device_name[0] == '\0') {
        strncpy(device_name, DEVICE_NAME_DEFAULT, sizeof(device_name) - 1);
        device_name[sizeof(device_name) - 1] = '\0';
    }
}
static void saveSensorConfigToNvs() {
    prefs.begin("aura", false);
    prefs.putString("email", user_email);
    prefs.putString("dname", device_name);
    prefs.putBool("cwl", closedWhenLow);
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
static bool connectWifiFast() {
    WiFi.disconnect(false);
    delay(150);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin();
    for (int i = 0; i < 80; i++) {
        if (WiFi.status() == WL_CONNECTED) return true;
        delay(250);
    }
    WiFi.disconnect(false);
    delay(100);
    return false;
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
static int64_t timestampMsNow() {
    time_t nowSec = 0;
    time(&nowSec);
    if (nowSec > 1700000000L) return (int64_t)nowSec * 1000;
    return (int64_t)millis();
}

static bool firmwareVersionNewer(const String& remote, const String& local) {
    int r[3] = {0, 0, 0};
    int l[3] = {0, 0, 0};
    sscanf(remote.c_str(), "%d.%d.%d", &r[0], &r[1], &r[2]);
    sscanf(local.c_str(), "%d.%d.%d", &l[0], &l[1], &l[2]);
    for (int i = 0; i < 3; i++) {
        if (r[i] != l[i]) return r[i] > l[i];
    }
    return false;
}

static void maybeApplyFirmwareUpdate(int batteryPct, const char* powerSource, bool allowOta) {
    if (!allowOta) return;
    if (batteryPct >= 1 && batteryPct < 15 && powerSource && strcmp(powerSource, "battery") == 0) {
        Serial.println("OTA skipped: battery too low");
        return;
    }
    FirebaseJsonData v;
    if (!Firebase.RTDB.getJSON(&fbdo, FW_CHANNEL_PATH)) {
        Serial.print("OTA channel read failed: ");
        Serial.println(fbdo.errorReason());
        return;
    }
    FirebaseJson meta = fbdo.jsonObject();
    bool enabled = true;
    if (meta.get(v, "enabled") && v.success) enabled = v.boolValue;
    if (!enabled) {
        Serial.println("OTA disabled in Firebase");
        return;
    }
    String remoteVer;
    String url;
    if (meta.get(v, "version") && v.success) remoteVer = v.stringValue;
    if (meta.get(v, "url") && v.success) url = v.stringValue;
    remoteVer.trim();
    url.trim();
    if (remoteVer.length() == 0 || url.length() == 0) return;
    if (!url.startsWith("https://")) {
        Serial.println("OTA skipped: url must be https");
        return;
    }
    if (!firmwareVersionNewer(remoteVer, FW_VERSION)) {
        Serial.print("OTA up to date ");
        Serial.println(FW_VERSION);
        return;
    }
    Serial.print("OTA ");
    Serial.print(FW_VERSION);
    Serial.print(" -> ");
    Serial.println(remoteVer);
    WiFiClientSecure client;
    client.setInsecure();
    httpUpdate.rebootOnUpdate(true);
    httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    t_httpUpdate_return ret = httpUpdate.update(client, url);
    if (ret == HTTP_UPDATE_OK) return;
    Serial.print("OTA failed: ");
    Serial.println(httpUpdate.getLastErrorString());
}

// Valid ext0 levels: 0 = LOW, 1 = HIGH (do not use -1 for wakeup).
RTC_DATA_ATTR int nextWakeLevel = 0;
RTC_DATA_ATTR int8_t rtcLastSentStatus = -1;  // -1 = nothing sent yet; 0/1 = last sent status
RTC_DATA_ATTR int8_t rtcCapturedClosed = -1;  // sensor state captured immediately after GPIO wake
// Periodic full restart: every PERIODIC_RESTART_WAKES wakeups do ESP.restart() to clear any
// accumulated WiFi/SSL/Firebase state that degrades over time.
#define PERIODIC_RESTART_WAKES 50
RTC_DATA_ATTR uint16_t rtcWakeCount = 0;

#define EVENT_QUEUE_MAGIC 0x41555242UL
#define EVENT_QUEUE_CAPACITY 32

struct PendingSensorEvent {
    uint32_t sequence;
    uint32_t nonce;
    int64_t capturedAt;
    uint8_t closed;
};

struct PersistedEventQueue {
    uint32_t magic;
    uint32_t nextSequence;
    int8_t lastAcknowledged;
    uint8_t count;
    PendingSensorEvent events[EVENT_QUEUE_CAPACITY];
};

// Explicit prototypes prevent Arduino's .ino preprocessor from generating
// peekSensorEvent(PendingSensorEvent&) before the struct declaration.
static void loadEventQueue();
static bool saveEventQueue();
static bool enqueueSensorEvent(bool closed, bool force = false);
static bool peekSensorEvent(PendingSensorEvent &event);
static bool removeQueuedSensorEvent(uint32_t sequence, int8_t acknowledgedStatus, bool updateAck = true);
static void rememberAcknowledged(int8_t status);

static PersistedEventQueue eventQueue;
static bool eventQueueLoaded = false;

static void loadEventQueue() {
    if (eventQueueLoaded) return;
    memset(&eventQueue, 0, sizeof(eventQueue));
    prefs.begin("aura", true);
    size_t len = prefs.getBytesLength("eventq");
    if (len == sizeof(eventQueue)) {
        prefs.getBytes("eventq", &eventQueue, sizeof(eventQueue));
    }
    prefs.end();
    if (eventQueue.magic != EVENT_QUEUE_MAGIC
        || eventQueue.count > EVENT_QUEUE_CAPACITY
        || eventQueue.nextSequence == 0) {
        memset(&eventQueue, 0, sizeof(eventQueue));
        eventQueue.magic = EVENT_QUEUE_MAGIC;
        eventQueue.nextSequence = 1;
        eventQueue.lastAcknowledged = -1;
    }
    eventQueueLoaded = true;
}

static bool saveEventQueue() {
    prefs.begin("aura", false);
    size_t written = prefs.putBytes("eventq", &eventQueue, sizeof(eventQueue));
    prefs.end();
    return written == sizeof(eventQueue);
}

static bool enqueueSensorEvent(bool closed, bool force) {
    loadEventQueue();
    int8_t lastKnown = eventQueue.lastAcknowledged;
    if (eventQueue.count > 0) {
        lastKnown = eventQueue.events[eventQueue.count - 1].closed ? 1 : 0;
    }
    if (!force && lastKnown == (closed ? 1 : 0)) return true;
    if (eventQueue.count >= EVENT_QUEUE_CAPACITY) {
        Serial.println("EVENT QUEUE FULL - retaining unsent events");
        return false;
    }
    PendingSensorEvent &event = eventQueue.events[eventQueue.count++];
    event.sequence = eventQueue.nextSequence++;
    if (eventQueue.nextSequence == 0) eventQueue.nextSequence = 1;
    event.nonce = esp_random();
    if (event.nonce == 0) event.nonce = 1;
    event.capturedAt = timestampMsNow();
    event.closed = closed ? 1 : 0;
    if (!saveEventQueue()) {
        eventQueue.count--;
        Serial.println("EVENT QUEUE SAVE FAILED");
        return false;
    }
    Serial.print("Event queued, seq=");
    Serial.println(event.sequence);
    return true;
}

static bool peekSensorEvent(PendingSensorEvent &event) {
    loadEventQueue();
    if (eventQueue.count == 0) return false;
    event = eventQueue.events[0];
    return true;
}

static bool removeQueuedSensorEvent(uint32_t sequence, int8_t acknowledgedStatus, bool updateAck) {
    loadEventQueue();
    if (eventQueue.count == 0 || eventQueue.events[0].sequence != sequence) return false;
    for (uint8_t i = 1; i < eventQueue.count; i++) {
        eventQueue.events[i - 1] = eventQueue.events[i];
    }
    eventQueue.count--;
    if (updateAck) eventQueue.lastAcknowledged = acknowledgedStatus;
    return saveEventQueue();
}

static void rememberAcknowledged(int8_t status) {
    rtcLastSentStatus = status;
    loadEventQueue();
    eventQueue.lastAcknowledged = status;
    saveEventQueue();
}

#define SENSOR_DEBOUNCE_MS 50
#define SENSOR_DEBOUNCE_SAMPLES 5
#define SENSOR_SETTLE_MS 300

// Reed polarity: see SENSOR_CLOSED_WHEN_LOW. Majority vote filters reed bounce.
static bool readSensorClosedDebounced() {
    delay(SENSOR_DEBOUNCE_MS);
    int highCount = 0;
    for (int i = 0; i < SENSOR_DEBOUNCE_SAMPLES; i++) {
        if (digitalRead(sensorPin) == HIGH) {
            highCount++;
        }
        if (i + 1 < SENSOR_DEBOUNCE_SAMPLES) {
            delay(40);
        }
    }
    const bool pinHigh = highCount * 2 >= SENSOR_DEBOUNCE_SAMPLES;
    return closedWhenLow ? !pinHigh : pinHigh;
}

// Two consistent reads — door vibration at wake used to enqueue the wrong state (app updates, no push).
static bool readSensorClosedStable() {
    bool first = readSensorClosedDebounced();
    delay(SENSOR_SETTLE_MS);
    bool second = readSensorClosedDebounced();
    if (first == second) return first;
    delay(SENSOR_SETTLE_MS);
    return readSensorClosedDebounced();
}

static int wakeLevelForClosed(bool closed) {
    if (closedWhenLow) return closed ? 1 : 0;
    return closed ? 0 : 1;
}

static void invertQueuedEventPolarity() {
    loadEventQueue();
    bool changed = false;
    for (uint8_t i = 0; i < eventQueue.count; i++) {
        eventQueue.events[i].closed = eventQueue.events[i].closed ? 0 : 1;
        changed = true;
    }
    if (eventQueue.lastAcknowledged >= 0) {
        eventQueue.lastAcknowledged = eventQueue.lastAcknowledged ? 0 : 1;
        changed = true;
    }
    if (changed) saveEventQueue();
}

static void adoptHistStatusOnce(const String& userPath, const String& deviceID) {
    prefs.begin("aura", true);
    bool done = prefs.getBool("ack120", false);
    prefs.end();
    if (done) return;
    QueryFilter query;
    query.orderBy("$key");
    query.limitToLast(40);
    String path = userPath + "/history";
    if (!Firebase.RTDB.getJSON(&fbdo, path.c_str(), &query)) {
        Serial.println("Ack resync skipped");
        return;
    }
    FirebaseJson &json = fbdo.jsonObject();
    size_t n = json.iteratorBegin();
    int64_t bestTs = -1;
    int8_t bestSt = -1;
    for (size_t i = 0; i < n; i++) {
        FirebaseJson::IteratorValue item = json.valueAt(i);
        FirebaseJson child;
        child.setJsonData(item.value);
        FirebaseJsonData data;
        String id;
        String status;
        int64_t ts = 0;
        if (child.get(data, "deviceId") && data.success) id = data.stringValue;
        if (id.length() == 0 && child.get(data, "deviceName") && data.success) id = data.stringValue;
        if (id != deviceID && id != String(device_name)) continue;
        if (child.get(data, "status") && data.success) status = data.stringValue;
        if (child.get(data, "timestamp") && data.success) ts = (int64_t)data.doubleValue;
        status.toLowerCase();
        int8_t st = -1;
        if (status == "open") st = 0;
        else if (status == "closed") st = 1;
        if (st >= 0 && ts >= bestTs) {
            bestTs = ts;
            bestSt = st;
        }
    }
    json.iteratorEnd();
    if (bestSt >= 0) {
        loadEventQueue();
        eventQueue.lastAcknowledged = bestSt;
        saveEventQueue();
        rtcLastSentStatus = bestSt;
        Serial.println(bestSt ? "Ack resync CLOSED" : "Ack resync OPEN");
    }
    prefs.begin("aura", false);
    prefs.putBool("ack120", true);
    prefs.end();
}

static void syncClosedWhenLowFromFirebase(const String& userPath, const String& deviceID) {
    String path = userPath + "/deviceSettings/" + deviceID + "/closedWhenLow";
    if (!Firebase.RTDB.getBool(&fbdo, path)) return;
    if (fbdo.dataType() != "boolean") return;
    bool v = fbdo.boolData();
    if (v == closedWhenLow) return;
    closedWhenLow = v;
    prefs.begin("aura", false);
    prefs.putBool("cwl", closedWhenLow);
    prefs.end();
    invertQueuedEventPolarity();
    if (rtcLastSentStatus >= 0) rtcLastSentStatus = rtcLastSentStatus ? 0 : 1;
    nextWakeLevel = wakeLevelForClosed(readSensorClosedStable());
    Serial.print("Reed invert closedWhenLow=");
    Serial.println(closedWhenLow ? "1 (GND)" : "0");
}
String transliterateToLatin(String s) {
    String out = "";
    const char* p = s.c_str();
    while (*p) {
        unsigned char c = (unsigned char)*p;
        if (c < 128) { out += (char)c; p++; continue; }
        if (c == 0xD0 && *(p + 1)) {
            unsigned char c2 = (unsigned char)*(p + 1);
            if (c2 == 0x90) { out += "A"; p += 2; continue; }
            if (c2 == 0x91) { out += "B"; p += 2; continue; }
            if (c2 == 0x92) { out += "V"; p += 2; continue; }
            if (c2 == 0x93) { out += "G"; p += 2; continue; }
            if (c2 == 0x94) { out += "D"; p += 2; continue; }
            if (c2 == 0x95) { out += "E"; p += 2; continue; }
            if (c2 == 0x96) { out += "Zh"; p += 2; continue; }
            if (c2 == 0x97) { out += "Z"; p += 2; continue; }
            if (c2 == 0x98) { out += "I"; p += 2; continue; }
            if (c2 == 0x99) { out += "Y"; p += 2; continue; }
            if (c2 == 0x9A) { out += "K"; p += 2; continue; }
            if (c2 == 0x9B) { out += "L"; p += 2; continue; }
            if (c2 == 0x9C) { out += "M"; p += 2; continue; }
            if (c2 == 0x9D) { out += "N"; p += 2; continue; }
            if (c2 == 0x9E) { out += "O"; p += 2; continue; }
            if (c2 == 0x9F) { out += "P"; p += 2; continue; }
            if (c2 == 0xA0) { out += "R"; p += 2; continue; }
            if (c2 == 0xA1) { out += "S"; p += 2; continue; }
            if (c2 == 0xA2) { out += "T"; p += 2; continue; }
            if (c2 == 0xA3) { out += "U"; p += 2; continue; }
            if (c2 == 0xA4) { out += "F"; p += 2; continue; }
            if (c2 == 0xA5) { out += "H"; p += 2; continue; }
            if (c2 == 0xA6) { out += "Ts"; p += 2; continue; }
            if (c2 == 0xA7) { out += "Ch"; p += 2; continue; }
            if (c2 == 0xA8) { out += "Sh"; p += 2; continue; }
            if (c2 == 0xA9) { out += "Sht"; p += 2; continue; }
            if (c2 == 0xAA) { out += "A"; p += 2; continue; }
            if (c2 == 0xAB) { out += "Y"; p += 2; continue; }
            if (c2 == 0xAC) { out += "Yu"; p += 2; continue; }
            if (c2 == 0xAD) { out += "Ya"; p += 2; continue; }
            if (c2 == 0xB0) { out += "a"; p += 2; continue; }
            if (c2 == 0xB1) { out += "b"; p += 2; continue; }
            if (c2 == 0xB2) { out += "v"; p += 2; continue; }
            if (c2 == 0xB3) { out += "g"; p += 2; continue; }
            if (c2 == 0xB4) { out += "d"; p += 2; continue; }
            if (c2 == 0xB5) { out += "e"; p += 2; continue; }
            if (c2 == 0xB6) { out += "zh"; p += 2; continue; }
            if (c2 == 0xB7) { out += "z"; p += 2; continue; }
            if (c2 == 0xB8) { out += "i"; p += 2; continue; }
            if (c2 == 0xB9) { out += "y"; p += 2; continue; }
            if (c2 == 0xBA) { out += "k"; p += 2; continue; }
            if (c2 == 0xBB) { out += "l"; p += 2; continue; }
            if (c2 == 0xBC) { out += "m"; p += 2; continue; }
            if (c2 == 0xBD) { out += "n"; p += 2; continue; }
            if (c2 == 0xBE) { out += "o"; p += 2; continue; }
            if (c2 == 0xBF) { out += "p"; p += 2; continue; }
        }
        if (c == 0xD1 && *(p + 1)) {
            unsigned char c2 = (unsigned char)*(p + 1);
            if (c2 == 0x80) { out += "r"; p += 2; continue; }
            if (c2 == 0x81) { out += "s"; p += 2; continue; }
            if (c2 == 0x82) { out += "t"; p += 2; continue; }
            if (c2 == 0x83) { out += "u"; p += 2; continue; }
            if (c2 == 0x84) { out += "f"; p += 2; continue; }
            if (c2 == 0x85) { out += "h"; p += 2; continue; }
            if (c2 == 0x86) { out += "ts"; p += 2; continue; }
            if (c2 == 0x87) { out += "ch"; p += 2; continue; }
            if (c2 == 0x88) { out += "sh"; p += 2; continue; }
            if (c2 == 0x89) { out += "sht"; p += 2; continue; }
            if (c2 == 0x8A) { out += "a"; p += 2; continue; }
            if (c2 == 0x8B) { out += "y"; p += 2; continue; }
            if (c2 == 0x8E) { out += "yu"; p += 2; continue; }
            if (c2 == 0x8F) { out += "ya"; p += 2; continue; }
            if (c2 == 0x90) { out += "a"; p += 2; continue; }
            if (c2 == 0x91) { out += "b"; p += 2; continue; }
            if (c2 == 0x92) { out += "v"; p += 2; continue; }
            if (c2 == 0x93) { out += "g"; p += 2; continue; }
            if (c2 == 0x94) { out += "d"; p += 2; continue; }
            if (c2 == 0x95) { out += "e"; p += 2; continue; }
            if (c2 == 0x96) { out += "zh"; p += 2; continue; }
            if (c2 == 0x97) { out += "z"; p += 2; continue; }
            if (c2 == 0x98) { out += "i"; p += 2; continue; }
            if (c2 == 0x99) { out += "y"; p += 2; continue; }
            if (c2 == 0x9A) { out += "k"; p += 2; continue; }
            if (c2 == 0x9B) { out += "l"; p += 2; continue; }
            if (c2 == 0x9C) { out += "m"; p += 2; continue; }
            if (c2 == 0x9D) { out += "n"; p += 2; continue; }
        }
        out += (char)c;
        p++;
    }
    return out;
}
String getDeviceIdFromName(char* device_name_ptr) {
    String id = String(device_name_ptr);
    id.trim();
    if (id.length() == 0) {
        id = WiFi.macAddress();
        id.replace(":", "");
        return id;
    }
    id = transliterateToLatin(id);
    id.replace(" ", "_");
    id.replace(".", "_");
    id.replace("@", "_at_");
    id.replace("$", "_");
    id.replace("#", "_");
    id.replace("[", "_");
    id.replace("]", "_");
    id.replace("/", "_");
    id.replace("-", "_");
    String safe = "";
    for (unsigned int i = 0; i < id.length(); i++) {
        char c = id.charAt(i);
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
            safe += c;
        } else if (safe.length() > 0 && safe.charAt(safe.length() - 1) != '_') {
            safe += '_';
        }
    }
    safe.trim();
    if (safe.length() == 0) {
        safe = WiFi.macAddress();
        safe.replace(":", "");
    }
    return safe;
}

String buildHistoryKey(const String& deviceID, bool isClosed, unsigned long tsMs) {
    String status = isClosed ? "closed" : "open";
    // Unique key per event so RTDB onValueCreated always fires (45s buckets overwrote repeats → no push).
    return deviceID + "_" + status + "_" + String(tsMs) + "_"
        + String((uint32_t)(esp_random() & 0xFFFF));
}

String buildQueuedHistoryKey(const String& deviceID, uint32_t sequence, uint32_t nonce) {
    // Sequence alone can repeat after NVS erase or reflashing. Persisted nonce keeps retries
    // idempotent while ensuring a fresh queue never overwrites an older RTDB history child.
    return deviceID + "_event_" + String(sequence) + "_" + String(nonce, HEX);
}

// Rough Li-Po curve from pack voltage in mV → 0..100.
static int lipoPercentFromMv(int vbatMv) {
    static const int pts[][2] = {
        {3000, 0},
        {3300, 8},
        {3500, 25},
        {3600, 40},
        {3700, 55},
        {3800, 70},
        {3900, 82},
        {4000, 90},
        {4100, 96},
        {4200, 100},
    };
    const int n = (int)(sizeof(pts) / sizeof(pts[0]));
    if (vbatMv <= pts[0][0]) return pts[0][1];
    if (vbatMv >= pts[n - 1][0]) return pts[n - 1][1];
    for (int i = 1; i < n; i++) {
        if (vbatMv <= pts[i][0]) {
            int x0 = pts[i - 1][0], y0 = pts[i - 1][1];
            int x1 = pts[i][0], y1 = pts[i][1];
            return y0 + (int)((long)(y1 - y0) * (vbatMv - x0) / (x1 - x0));
        }
    }
    return 0;
}

// Returns 0–100, or -1 when the ADC has no usable battery sense.
// powerSourceOut: "usb" | "battery".
int readBatteryPercent(char* powerSourceOut, size_t powerSourceLen) {
    powerSourceOut[0] = '\0';
    lastBatteryMv = -1;
    if (USB_DETECT_PIN >= 0 && digitalRead(USB_DETECT_PIN) == HIGH) {
        strncpy(powerSourceOut, "usb", powerSourceLen - 1);
        powerSourceOut[powerSourceLen - 1] = '\0';
        return 100;
    }
    strncpy(powerSourceOut, "battery", powerSourceLen - 1);
    powerSourceOut[powerSourceLen - 1] = '\0';
    if (BATTERY_ADC_PIN < 0) {
        return -1;
    }
    analogSetPinAttenuation((uint8_t)BATTERY_ADC_PIN, ADC_11db);
    long sumMv = 0;
    int ok = 0;
    for (int i = 0; i < 8; i++) {
        int mv = analogReadMilliVolts(BATTERY_ADC_PIN);
        if (mv > 0) {
            sumMv += mv;
            ok++;
        }
        delay(3);
    }
    if (ok == 0) return -1;
    int pinMv = (int)(sumMv / ok);
    // Floating / unwired sense pin → do not invent 0%.
    if (pinMv < BATTERY_ADC_MIN_PIN_MV) return -1;
    int vbatMv = pinMv * BATTERY_ADC_DIVIDER;
    lastBatteryMv = vbatMv;
    int pct = lipoPercentFromMv(vbatMv);
    return (pct < 0) ? 0 : (pct > 100 ? 100 : pct);
}

// "ok" | "low" | "unknown"
static const char* batteryStatusLabel(const char* powerSource, int batteryPct) {
    if (batteryPct < 0) return "unknown";
    if (strcmp(powerSource, "battery") == 0 && batteryPct <= BATTERY_LOW_PCT) {
        return "low";
    }
    return "ok";
}

static bool readSystemEnabled(const String& userPath) {
    if (Firebase.RTDB.getBool(&fbdo, userPath + "/systemEnabled")) {
        if (fbdo.dataType() == "boolean") {
            return fbdo.boolData();
        }
    }
    return false;
}

// 1 = registered, 0 = no such account, -1 = server/network unreachable (do not block setup).
static int checkEmailRegistered(const char* email) {
    if (WiFi.status() != WL_CONNECTED) return -1;
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    if (!http.begin(client, EMAIL_CHECK_URL)) return -1;
    // Render free tier: cold start can take ~30-60 s ÔÇö long timeout only here (setup, not on every wake).
    http.setTimeout(60000);
    http.addHeader("Content-Type", "application/json");
    StaticJsonDocument<128> doc;
    doc["email"] = email;
    String body;
    serializeJson(doc, body);
    int code = http.POST(body);
    String resp = (code > 0) ? http.getString() : String();
    http.end();
    Serial.print("Email check HTTP ");
    Serial.println(code);
    if (code != 200) return -1;
    StaticJsonDocument<256> rd;
    if (deserializeJson(rd, resp)) return -1;
    if (!rd["registered"].is<bool>()) return -1;
    return rd["registered"].as<bool>() ? 1 : 0;
}

static void sendPushIfAway(
    const String& userKey,
    const String& deviceId,
    const String& deviceName,
    bool isClosed) {
    if (WiFi.status() != WL_CONNECTED) return;
    StaticJsonDocument<384> doc;
    doc["userKey"] = userKey;
    doc["deviceId"] = deviceId;
    doc["deviceName"] = deviceName;
    doc["state"] = isClosed ? "closed" : "open";
    String body;
    serializeJson(doc, body);
    for (int attempt = 1; attempt <= 3; attempt++) {
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        if (!http.begin(client, PUSH_API_URL)) {
            Serial.println("Push API: begin failed");
            return;
        }
        // Render can cold-start slowly; keep the ESP awake long enough for the first request.
        http.setTimeout(60000);
        http.addHeader("Content-Type", "application/json");
        int code = http.POST(body);
        Serial.print("Push API HTTP ");
        Serial.print(code);
        Serial.print(" attempt ");
        Serial.println(attempt);
        if (code > 0) {
            String resp = http.getString();
            if (resp.length() > 0) {
                Serial.println(resp);
            }
        }
        http.end();
        if (code >= 200 && code < 300) {
            return;
        }
        if (attempt < 3) {
            delay(2000);
        }
    }
}
// Turns Wi-Fi off and arms GPIO wake + optional heartbeat timer before esp_deep_sleep_start().
static void armDeepSleepGpioWakeup(int wakeLevel) {
    WiFi.disconnect(true);
    delay(50);
    WiFi.mode(WIFI_OFF);
    delay(50);
#if CONFIG_IDF_TARGET_ESP32 || CONFIG_IDF_TARGET_ESP32S3
    gpio_reset_pin((gpio_num_t)sensorPin);
    rtc_gpio_init((gpio_num_t)sensorPin);
    rtc_gpio_set_direction((gpio_num_t)sensorPin, RTC_GPIO_MODE_INPUT_ONLY);
    rtc_gpio_pullup_en((gpio_num_t)sensorPin);
    rtc_gpio_pulldown_dis((gpio_num_t)sensorPin);
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_EXT0);
    esp_sleep_enable_ext0_wakeup((gpio_num_t)sensorPin, wakeLevel);
#elif CONFIG_IDF_TARGET_ESP32C3
    gpio_reset_pin((gpio_num_t)sensorPin);
    pinMode(sensorPin, INPUT_PULLUP);
    gpio_set_pull_mode((gpio_num_t)sensorPin, GPIO_PULLUP_ONLY);
    delay(50);
    esp_deep_sleep_enable_gpio_wakeup(
        1ULL << sensorPin,
        wakeLevel ? ESP_GPIO_WAKEUP_GPIO_HIGH : ESP_GPIO_WAKEUP_GPIO_LOW);
    // C3: without hold the internal pull-up drops in deep sleep ÔåÆ the pin floats and never wakes the chip.
    gpio_hold_en((gpio_num_t)sensorPin);
#else
    pinMode(sensorPin, INPUT_PULLUP);
    delay(200);
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_EXT0);
    esp_sleep_enable_ext0_wakeup((gpio_num_t)sensorPin, wakeLevel);
#endif
#if DEEP_SLEEP_HEARTBEAT_SEC > 0
    esp_sleep_enable_timer_wakeup((uint64_t)DEEP_SLEEP_HEARTBEAT_SEC * 1000000ULL);
#endif
}
// First setup talks to the Aura app over Bluetooth. The phone sends Wi-Fi, email and name.
// AuraHomeSystems_Setup stays only if Bluetooth itself fails to start.
static const char* PROV_SERVICE = "8a1f0001-7c3a-4b2e-9d11-0e5a6b7c8d01";
static const char* PROV_LIST = "8a1f0002-7c3a-4b2e-9d11-0e5a6b7c8d01";
static const char* PROV_CRED = "8a1f0003-7c3a-4b2e-9d11-0e5a6b7c8d01";
static const char* PROV_STAT = "8a1f0004-7c3a-4b2e-9d11-0e5a6b7c8d01";
static volatile bool provConnected = false;
static char provCred[512];
static volatile int provCredLen = 0;
static BLECharacteristic* provListChar = nullptr;
static BLECharacteristic* provStatChar = nullptr;
static BLEServer* provServer = nullptr;

class ProvServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* server) override {
        (void)server;
        provConnected = true;
        Serial.print("BLE phone CONNECTED, clients=");
        Serial.println(server ? server->getConnectedCount() : -1);
    }
    void onDisconnect(BLEServer* server) override {
        (void)server;
        provConnected = false;
        Serial.println("BLE phone DISCONNECTED — restart advertising");
        delay(80);
        BLEDevice::startAdvertising();
        Serial.println("BLE advertising resumed after disconnect");
    }
};

class ProvCredCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* characteristic) override {
        String raw = characteristic->getValue();
        if (raw.length() == 0) return;
        Serial.print("BLE cred chunk len=");
        Serial.print(raw.length());
        Serial.print(raw.charAt(0) == '+' ? " (+)" : " (start)");
        Serial.println();
        // Phone may send the JSON in pieces. "+" means append the rest.
        if (raw.charAt(0) == '+') {
            raw = raw.substring(1);
            int have = provCredLen > 0 ? (int)strlen(provCred) : 0;
            if (have < 0) have = 0;
            if (have + (int)raw.length() >= (int)sizeof(provCred)) {
                Serial.println("BLE cred overflow");
                return;
            }
            memcpy(provCred + have, raw.c_str(), raw.length());
            provCred[have + raw.length()] = '\0';
        } else {
            if (raw.length() >= sizeof(provCred)) {
                Serial.println("BLE cred too long");
                return;
            }
            memcpy(provCred, raw.c_str(), raw.length());
            provCred[raw.length()] = '\0';
        }
        size_t have = strlen(provCred);
        if (have > 0 && provCred[have - 1] == '}') {
            provCredLen = (int)have;
            Serial.print("BLE cred complete, bytes=");
            Serial.println(provCredLen);
        }
    }
};

static bool provJoinWifi(const char* ssid, const char* pass) {
    // Keep the phone link. Only stop advertising so the radio can join Wi-Fi.
    BLEDevice::stopAdvertising();
    delay(150);
    WiFi.persistent(true);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.disconnect(false, false);
    delay(250);
    Serial.print("BLE join SSID len=");
    Serial.print(ssid ? strlen(ssid) : 0);
    Serial.print(" pass len=");
    Serial.println(pass ? strlen(pass) : 0);
    if (pass && pass[0] != '\0') {
        WiFi.begin(ssid, pass);
    } else {
        WiFi.begin(ssid);
    }
    for (int attempt = 0; attempt < 2; attempt++) {
        for (int i = 0; i < 100; i++) {
            wl_status_t st = WiFi.status();
            if (st == WL_CONNECTED) return true;
            if (st == WL_CONNECT_FAILED || st == WL_NO_SSID_AVAIL) break;
            delay(250);
        }
        Serial.print("BLE Wi-Fi status=");
        Serial.println((int)WiFi.status());
        WiFi.disconnect(false, false);
        delay(400);
        if (pass && pass[0] != '\0') {
            WiFi.begin(ssid, pass);
        } else {
            WiFi.begin(ssid);
        }
    }
    return WiFi.status() == WL_CONNECTED;
}

static void provNotify(const char* msg) {
    if (!provStatChar || !provConnected) return;
    provStatChar->setValue(msg);
    provStatChar->notify();
    delay(40);
}

static String provScanWifi() {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(false);
    delay(80);
    // Fast scan so BLE advertising starts sooner (phone times out ~20s).
    int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/true, /*passive=*/false, /*max_ms_per_chan=*/110);
    String out;
    int added = 0;
    for (int i = 0; i < n && added < 12; i++) {
        String ssid = WiFi.SSID(i);
        ssid.trim();
        if (ssid.length() == 0 || ssid.length() > 32) continue;
        if (out.indexOf("\n" + ssid + "\n") >= 0) continue;
        if (out.length() + ssid.length() + 1 > 360) break;
        if (out.length() == 0) out = "\n";
        out += ssid;
        out += "\n";
        added++;
    }
    WiFi.scanDelete();
    if (out.length() > 0 && out.charAt(0) == '\n') out = out.substring(1);
    return out;
}

static void provSleepRetry() {
    Serial.println("BLE setup idle — sleep 60s");
    Serial.flush();
    BLEDevice::deinit(true);
    WiFi.mode(WIFI_OFF);
    rtcCapturedClosed = -1;
    armDeepSleepGpioWakeup(nextWakeLevel);
    esp_sleep_enable_timer_wakeup(60ULL * 1000000ULL);
    esp_deep_sleep_start();
}

static String softApBody;
static volatile bool softApGotPost = false;
static WebServer* softApHttp = nullptr;

static void softApHandlePing() {
    if (!softApHttp) return;
    softApHttp->sendHeader("Access-Control-Allow-Origin", "*");
    softApHttp->send(200, "text/plain", "aura");
}

// Phone has no Location permission — sensor scans 2.4 GHz and returns SSIDs.
static void softApHandleWifi() {
    if (!softApHttp) return;
    softApHttp->sendHeader("Access-Control-Allow-Origin", "*");
    softApHttp->sendHeader("Cache-Control", "no-store");
    WiFi.mode(WIFI_AP_STA);
    delay(80);
    int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/false, /*passive=*/false, /*max_ms_per_chan=*/120);
    String json = "[";
    int added = 0;
    for (int i = 0; i < n && added < 16; i++) {
        String ssid = WiFi.SSID(i);
        ssid.trim();
        if (ssid.length() == 0 || ssid.length() > 32) continue;
        if (ssid.equals(SETUP_AP_SSID)) continue;
        bool dup = false;
        for (int j = 0; j < i; j++) {
            if (ssid.equals(WiFi.SSID(j))) {
                dup = true;
                break;
            }
        }
        if (dup) continue;
        if (added > 0) json += ",";
        json += "\"";
        for (unsigned k = 0; k < ssid.length(); k++) {
            char c = ssid.charAt(k);
            if (c == '"' || c == '\\') json += '\\';
            json += c;
        }
        json += "\"";
        added++;
    }
    json += "]";
    WiFi.scanDelete();
    Serial.print("SoftAP /wifi networks=");
    Serial.println(added);
    softApHttp->send(200, "application/json", json);
}

static void softApHandleProv() {
    if (!softApHttp) return;
    softApHttp->sendHeader("Access-Control-Allow-Origin", "*");
    if (!softApHttp->hasArg("plain")) {
        softApHttp->send(400, "application/json", "{\"ok\":false,\"err\":\"nobody\"}");
        return;
    }
    softApBody = softApHttp->arg("plain");
    softApGotPost = true;
    softApHttp->send(200, "application/json", "{\"ok\":true,\"state\":\"accepted\"}");
}

// Make iOS/Android think there is no captive portal — stay in the Aura app.
static void softApHandleCaptiveOk() {
    if (!softApHttp) return;
    softApHttp->sendHeader("Cache-Control", "no-store");
    softApHttp->send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
}

static void softApHandleGenerate204() {
    if (!softApHttp) return;
    softApHttp->sendHeader("Cache-Control", "no-store");
    softApHttp->send(204);
}

static void softApHandleNotFound() {
    if (!softApHttp) return;
    String uri = softApHttp->uri();
    uri.toLowerCase();
    // Captive portal probes (Apple / Google / Microsoft) — never show a setup page.
    if (uri.indexOf("hotspot-detect") >= 0 || uri.indexOf("success.html") >= 0 ||
        uri.indexOf("captive") >= 0 || uri.endsWith("/ncsi.txt") ||
        uri.indexOf("connecttest") >= 0 || uri == "/" || uri == "/index.html") {
        softApHandleCaptiveOk();
        return;
    }
    if (uri.indexOf("generate_204") >= 0 || uri.indexOf("gen_204") >= 0) {
        softApHandleGenerate204();
        return;
    }
    softApHttp->sendHeader("Access-Control-Allow-Origin", "*");
    softApHttp->send(200, "text/plain", "aura");
}

// In-app setup: phone joins this SoftAP and POSTs JSON to /prov (no browser).
static bool runSoftApSetup() {
    Serial.println("SoftAP setup — ");
    Serial.println(SETUP_AP_SSID);
    WiFi.mode(WIFI_AP);
    if (!WiFi.softAP(SETUP_AP_SSID)) {
        Serial.println("SoftAP start failed");
        return false;
    }
    delay(200);
    Serial.print("SoftAP IP ");
    Serial.println(WiFi.softAPIP());

    WebServer server(80);
    softApHttp = &server;
    softApBody = "";
    softApGotPost = false;

    server.on("/ping", HTTP_GET, softApHandlePing);
    server.on("/wifi", HTTP_GET, softApHandleWifi);
    server.on("/prov", HTTP_POST, softApHandleProv);
    server.on("/hotspot-detect.html", HTTP_GET, softApHandleCaptiveOk);
    server.on("/library/test/success.html", HTTP_GET, softApHandleCaptiveOk);
    server.on("/generate_204", HTTP_GET, softApHandleGenerate204);
    server.on("/gen_204", HTTP_GET, softApHandleGenerate204);
    server.on("/", HTTP_GET, softApHandleCaptiveOk);
    server.onNotFound(softApHandleNotFound);
    server.begin();
    Serial.println("SoftAP /ping /wifi /prov ready — waiting for app (no browser portal)");

    unsigned long started = millis();
    while (millis() - started < 600000UL) {
        server.handleClient();
        if (softApGotPost) {
            softApGotPost = false;
            StaticJsonDocument<768> doc;
            if (deserializeJson(doc, softApBody)) {
                Serial.println("SoftAP JSON bad");
                softApBody = "";
                continue;
            }
            const char* ssid = doc["ssid"] | "";
            const char* pass = doc["pass"] | "";
            const char* email = doc["email"] | "";
            const char* name = doc["name"] | "";
            if (ssid[0] == '\0' || !emailLooksValid(email)) {
                Serial.println("SoftAP bad ssid/email");
                softApBody = "";
                continue;
            }
            char ssidCopy[33];
            char passCopy[65];
            char emailCopy[64];
            char nameCopy[30];
            strncpy(ssidCopy, ssid, sizeof(ssidCopy) - 1);
            ssidCopy[sizeof(ssidCopy) - 1] = '\0';
            strncpy(passCopy, pass, sizeof(passCopy) - 1);
            passCopy[sizeof(passCopy) - 1] = '\0';
            strncpy(emailCopy, email, sizeof(emailCopy) - 1);
            emailCopy[sizeof(emailCopy) - 1] = '\0';
            strncpy(nameCopy, name, sizeof(nameCopy) - 1);
            nameCopy[sizeof(nameCopy) - 1] = '\0';

            Serial.println("SoftAP got creds — joining home Wi-Fi");
            server.stop();
            WiFi.softAPdisconnect(true);
            delay(150);
            WiFi.mode(WIFI_STA);
            WiFi.setSleep(false);
            WiFi.persistent(true);
            if (passCopy[0] != '\0') WiFi.begin(ssidCopy, passCopy);
            else WiFi.begin(ssidCopy);
            bool joined = false;
            for (int i = 0; i < 80; i++) {
                if (WiFi.status() == WL_CONNECTED) {
                    joined = true;
                    break;
                }
                delay(250);
            }
            if (!joined) {
                Serial.println("SoftAP home Wi-Fi rejected — SoftAP again");
                WiFi.disconnect(true, true);
                delay(200);
                WiFi.mode(WIFI_AP);
                WiFi.softAP(SETUP_AP_SSID);
                delay(200);
                server.begin();
                softApBody = "";
                continue;
            }
            String emailNorm = String(emailCopy);
            emailNorm.trim();
            emailNorm.toLowerCase();
            emailNorm.toCharArray(user_email, sizeof(user_email));
            String nameNorm = String(nameCopy);
            nameNorm.trim();
            if (nameNorm.length() == 0) nameNorm = DEVICE_NAME_DEFAULT;
            nameNorm.toCharArray(device_name, sizeof(device_name));
            int reg = checkEmailRegistered(user_email);
            if (reg == -1) {
                delay(2000);
                reg = checkEmailRegistered(user_email);
            }
            if (reg == 0) {
                Serial.println("SoftAP email rejected");
                user_email[0] = '\0';
                WiFi.disconnect(true, true);
                delay(200);
                WiFi.mode(WIFI_AP);
                WiFi.softAP(SETUP_AP_SSID);
                delay(200);
                server.begin();
                softApBody = "";
                continue;
            }
            saveSensorConfigToNvs();
            prefs.begin("aura", false);
            if (prefs.getBool("emailbad", false)) prefs.remove("emailbad");
            prefs.end();
            softApHttp = nullptr;
            Serial.println("SoftAP setup done");
            return true;
        }
        delay(2);
        if ((millis() - started) / 10000UL != ((millis() - started - 2) / 10000UL)) {
            Serial.print("SoftAP waiting for app, uptime_s=");
            Serial.println((millis() - started) / 1000UL);
        }
    }
    Serial.println("SoftAP timeout");
    server.stop();
    softApHttp = nullptr;
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    return false;
}

// true = Wi-Fi is up and the account email is stored. false = Bluetooth did not start.
static bool runBleSetup() {
    // Advertise immediately — Wi-Fi scan first made phones miss the sensor for minutes.
    Serial.println("BLE setup — advertising first");
    WiFi.mode(WIFI_OFF);
    delay(150);
    String nets = "\n";
    if (!BLEDevice::getInitialized()) {
        BLEDevice::init("Aura");
    }
    BLEDevice::setMTU(247);
    BLEServer* server = BLEDevice::createServer();
    server->setCallbacks(new ProvServerCallbacks());
    BLEService* service = server->createService(PROV_SERVICE);
    provListChar = service->createCharacteristic(
        PROV_LIST,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    provListChar->addDescriptor(new BLE2902());
    if (nets.length() == 0) nets = "\n";
    provListChar->setValue(nets.c_str());
    BLECharacteristic* cred = service->createCharacteristic(
        PROV_CRED,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    cred->setCallbacks(new ProvCredCallbacks());
    provStatChar = service->createCharacteristic(
        PROV_STAT,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    provStatChar->addDescriptor(new BLE2902());
    provStatChar->setValue("10 wait");
    service->start();
    BLEAdvertising* advertising = BLEDevice::getAdvertising();
    // Keep ADV simple — custom raw packets + stop/start every 5s broke discovery on some phones.
    advertising->addServiceUUID(PROV_SERVICE);
    advertising->setScanResponse(true);
    advertising->setName("Aura");
    BLEDevice::startAdvertising();
    Serial.print("BLE MAC ");
    Serial.println(BLEDevice::getAddress().toString().c_str());
    Serial.println("BLE advertising as Aura");
    Serial.println("BLE waiting for phone — watch for CONNECTED");

    bool announced = false;
    unsigned long idleSince = millis();
    unsigned long connectedSince = 0;
    unsigned long lastAdvKick = millis();
    unsigned long lastHeartbeat = millis();
    unsigned long advKicks = 0;
    while (true) {
        if (!provConnected) {
            announced = false;
            connectedSince = 0;
            // Gentle re-advertise (start only). Aggressive stop/start can blank the radio.
            if (millis() - lastAdvKick > 20000UL) {
                BLEDevice::startAdvertising();
                lastAdvKick = millis();
                advKicks++;
                Serial.print("BLE ADV kick #");
                Serial.print(advKicks);
                Serial.print(" uptime_s=");
                Serial.println(millis() / 1000UL);
            }
            if (millis() - lastHeartbeat > 10000UL) {
                lastHeartbeat = millis();
                Serial.print("BLE still waiting for phone, uptime_s=");
                Serial.println(millis() / 1000UL);
            }
            // Short BLE window — app joins SoftAP in-app soon after.
            if (millis() - idleSince > 8000UL) {
                Serial.println("BLE no phone in 8s — SoftAP for in-app setup");
                Serial.flush();
                BLEDevice::deinit(true);
                WiFi.mode(WIFI_OFF);
                delay(200);
                return false;
            }
        } else {
            idleSince = millis();
            if (connectedSince == 0) connectedSince = millis();
            if (millis() - connectedSince > 300000UL) {
                Serial.println("BLE connected idle timeout");
                provSleepRetry();
            }
            if (!announced) {
                Serial.println("BLE notify 15 found + wifi list");
                provNotify("15 found");
                if (provListChar) {
                    provListChar->notify();
                }
                announced = true;
            }
        }
        if (provCredLen > 0) {
            connectedSince = millis();
            char local[512];
            int n = provCredLen;
            if (n > 511) n = 511;
            memcpy(local, provCred, n);
            local[n] = '\0';
            provCredLen = 0;
            provCred[0] = '\0';
            StaticJsonDocument<768> doc;
            if (deserializeJson(doc, local)) {
                Serial.println("BLE JSON bad");
                provNotify("0 badwifi");
                BLEDevice::startAdvertising();
                continue;
            }
            const char* ssid = doc["ssid"] | "";
            const char* pass = doc["pass"] | "";
            const char* email = doc["email"] | "";
            const char* name = doc["name"] | "";
            if (ssid[0] == '\0' || !emailLooksValid(email)) {
                provNotify("0 bademail");
                BLEDevice::startAdvertising();
                continue;
            }
            char ssidCopy[33];
            char passCopy[65];
            char emailCopy[64];
            char nameCopy[30];
            strncpy(ssidCopy, ssid, sizeof(ssidCopy) - 1);
            ssidCopy[sizeof(ssidCopy) - 1] = '\0';
            strncpy(passCopy, pass, sizeof(passCopy) - 1);
            passCopy[sizeof(passCopy) - 1] = '\0';
            strncpy(emailCopy, email, sizeof(emailCopy) - 1);
            emailCopy[sizeof(emailCopy) - 1] = '\0';
            strncpy(nameCopy, name, sizeof(nameCopy) - 1);
            nameCopy[sizeof(nameCopy) - 1] = '\0';
            provNotify("45 join");
            bool joined = provJoinWifi(ssidCopy, passCopy);
            if (!joined) {
                Serial.println("BLE Wi-Fi rejected");
                WiFi.disconnect(true, true);
                WiFi.mode(WIFI_OFF);
                delay(200);
                provNotify("0 badwifi");
                BLEDevice::startAdvertising();
                continue;
            }
            provNotify("70 check");
            String emailNorm = String(emailCopy);
            emailNorm.trim();
            emailNorm.toLowerCase();
            emailNorm.toCharArray(user_email, sizeof(user_email));
            String nameNorm = String(nameCopy);
            nameNorm.trim();
            if (nameNorm.length() == 0) nameNorm = DEVICE_NAME_DEFAULT;
            nameNorm.toCharArray(device_name, sizeof(device_name));
            int reg = checkEmailRegistered(user_email);
            if (reg == -1) {
                delay(2000);
                reg = checkEmailRegistered(user_email);
            }
            if (reg == 0) {
                Serial.println("BLE email rejected");
                user_email[0] = '\0';
                WiFi.disconnect(true, true);
                WiFi.mode(WIFI_OFF);
                delay(200);
                provNotify("0 bademail");
                BLEDevice::startAdvertising();
                continue;
            }
            saveSensorConfigToNvs();
            prefs.begin("aura", false);
            if (prefs.getBool("emailbad", false)) prefs.remove("emailbad");
            prefs.end();
            provNotify("100 ok");
            delay(800);
            BLEDevice::deinit(true);
            provListChar = nullptr;
            provStatChar = nullptr;
            if (WiFi.status() != WL_CONNECTED) connectWifiFast();
            Serial.println("BLE setup done");
            return WiFi.status() == WL_CONNECTED;
        }
        delay(80);
    }
}

static bool isPowerOnReset() {
    const esp_reset_reason_t reason = esp_reset_reason();
    return reason == ESP_RST_POWERON || reason == ESP_RST_BROWNOUT;
}

void setup() {
    const esp_sleep_wakeup_cause_t bootWakeCause = esp_sleep_get_wakeup_cause();
    const bool coldBoot = (bootWakeCause == ESP_SLEEP_WAKEUP_UNDEFINED);
    // Only clear RTC sensor state on true power-on — NOT on ESP.restart() (periodic restart).
    if (isPowerOnReset()) {
        rtcLastSentStatus = -1;
        rtcCapturedClosed = -1;
        rtcWakeCount = 0;
    }
#if UPLOAD_GRACE_MS > 0
    if (coldBoot) delay(UPLOAD_GRACE_MS);
#endif
#if !USE_DEEP_SLEEP
    delay(2000);
#endif
    Serial.begin(115200);
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
    Serial.setTxTimeoutMs(0);
#endif
    Serial.println("\n--- PetrovSolution ---");
#if USE_DEEP_SLEEP && UPLOAD_GRACE_MS > 0
    if (coldBoot) {
        Serial.println("UPLOAD: hold BOOT + RST to flash a sketch.");
    }
#endif
    loadSensorConfigFromNvs();
#if CONFIG_IDF_TARGET_ESP32C3
    // Release the hold from the previous deep sleep, otherwise the pin stays frozen.
    gpio_deep_sleep_hold_dis();
    gpio_hold_dis((gpio_num_t)sensorPin);
#endif
    pinMode(sensorPin, INPUT_PULLUP);
    delay(30);
    bool liveAtWakeClosed = false;
    bool recordedWakePin = false;
    {
        const bool pinHigh = digitalRead(sensorPin) == HIGH;
        liveAtWakeClosed = closedWhenLow ? !pinHigh : pinHigh;
        recordedWakePin = true;
    }
    if (BATTERY_ADC_PIN >= 0) pinMode(BATTERY_ADC_PIN, INPUT);
    if (USB_DETECT_PIN >= 0) pinMode(USB_DETECT_PIN, INPUT);
#if USE_DEEP_SLEEP
    {
        const esp_sleep_wakeup_cause_t earlyWake = esp_sleep_get_wakeup_cause();
        const bool gpioWake = (earlyWake == ESP_SLEEP_WAKEUP_EXT0
#if CONFIG_IDF_TARGET_ESP32C3
            || earlyWake == ESP_SLEEP_WAKEUP_GPIO
#endif
        );
        loadEventQueue();
        // NVS last history write is truth. RTC RAM can think Open while last event was Closed,
        // which then skips the real Open and GPIO-force-duplicates the same status.
        if (eventQueue.lastAcknowledged >= 0) {
            rtcLastSentStatus = eventQueue.lastAcknowledged;
        }
        // Read the reed after gpio hold is released. Inferring the state from the
        // armed wake level reported Open again and never woke on Close.
        bool st = readSensorClosedStable();
        liveAtWakeClosed = st;
        recordedWakePin = true;
        nextWakeLevel = wakeLevelForClosed(st);
        enqueueSensorEvent(st);
        if (gpioWake) {
            rtcCapturedClosed = st ? 1 : 0;
            Serial.print("Sensor at wake (GPIO): ");
            Serial.println(st ? "CLOSED" : "OPEN");
        } else {
            Serial.print("Sensor at wake (non-GPIO): ");
            Serial.println(st ? "CLOSED" : "OPEN");
        }
    }
#if LOW_BATT_SKIP_WIFI_PCT > 0
    {
        char psLow[16];
        int batLow = readBatteryPercent(psLow, sizeof(psLow));
        if (batLow < (int)LOW_BATT_SKIP_WIFI_PCT && strcmp(psLow, "battery") == 0) {
            Serial.print("Critical battery ");
            Serial.print(batLow);
            Serial.print("% ÔÇö skipping Wi-Fi, retry in ");
            Serial.print((unsigned long)(LOW_BATT_RETRY_SEC / 3600UL));
            Serial.println(" h");
            WiFi.mode(WIFI_OFF);
            esp_sleep_enable_timer_wakeup((uint64_t)LOW_BATT_RETRY_SEC * 1000000ULL);
            esp_deep_sleep_start();
            return;
        }
    }
#endif
#endif
    char prev_email[64];
    strncpy(prev_email, user_email, sizeof(prev_email) - 1);
    prev_email[sizeof(prev_email) - 1] = '\0';
    bool wifiConnected = false;
    bool emailFromPortal = false;
    if (emailLooksValid(user_email)) {
        Serial.println("Fast WiFi connect...");
        wifiConnected = connectWifiFast();
        if (wifiConnected) {
            Serial.print("WiFi OK: ");
            Serial.println(WiFi.localIP());
        }
    }
    if (!wifiConnected) {
#if USE_DEEP_SLEEP
        if (emailLooksValid(user_email)) {
            // Already configured: do not open the setup AP on a temporary Wi-Fi failure.
            Serial.println("No WiFi - deep sleep 5 min, then retry.");
            Serial.flush();
            rtcCapturedClosed = -1;
            armDeepSleepGpioWakeup(nextWakeLevel);
            esp_sleep_enable_timer_wakeup(300ULL * 1000000ULL);
            esp_deep_sleep_start();
            return;
        }
#endif
        bool bleReady = false;
        if (!emailLooksValid(user_email)) {
            Serial.println("No email — BLE setup");
            bleReady = runBleSetup();
        }
        if (bleReady) {
            emailFromPortal = true;
        } else if (!emailLooksValid(user_email) && runSoftApSetup()) {
            emailFromPortal = true;
            bleReady = true;
        } else if (!emailLooksValid(user_email)) {
            // Never open WiFiManager browser portal — SoftAP + app only. Retry SoftAP once.
            Serial.println("SoftAP not finished — retry SoftAP (no WiFiManager portal)");
            if (runSoftApSetup()) {
                emailFromPortal = true;
                bleReady = true;
            } else {
                Serial.println("Setup still incomplete — deep sleep 2 min, then retry SoftAP");
                Serial.flush();
#if USE_DEEP_SLEEP
                rtcCapturedClosed = -1;
                armDeepSleepGpioWakeup(nextWakeLevel);
                esp_sleep_enable_timer_wakeup(120ULL * 1000000ULL);
                esp_deep_sleep_start();
#else
                delay(120000);
                ESP.restart();
#endif
            }
        }
    }
    // Verify only after the setup portal changes the email. A configured sensor must not block
    // on Render/email-check during normal wakeups or after a cold start.
    if (emailFromPortal) {
        int reg = checkEmailRegistered(user_email);
        if (reg == -1) {
            delay(2000);
            reg = checkEmailRegistered(user_email);
        }
        if (reg == 0) {
            Serial.println("Email rejected as invalid! Clearing it and reopening the setup portal...");
            prefs.begin("aura", false);
            prefs.remove("email");
            prefs.putBool("emailbad", true);
            prefs.end();
            user_email[0] = '\0';
            delay(500);
            ESP.restart();
        }
        if (reg == 1) {
            Serial.println("Email OK ÔÇö account is ready.");
            prefs.begin("aura", false);
            if (prefs.getBool("emailbad", false)) prefs.remove("emailbad");
            prefs.end();
        }
        // reg == -1: server unreachable ÔÇö continue, so a working sensor is never blocked.
    }
    Serial.println("Firebase init...");
    config.database_url = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
#if USE_DEEP_SLEEP
    Serial.println("Time sync...");
    syncTimeQuick();
#else
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    delay(800);
#endif
    // Path: /users/<email_key>/ ÔÇö same as the dashboard after registration
    String userKey = getSafeEmailKey(user_email);
    String userPath = "/users/" + userKey;
#if USE_DEEP_SLEEP
    const esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
    if (wakeCause != ESP_SLEEP_WAKEUP_UNDEFINED) {
        Serial.print("Wakeup cause: ");
        Serial.println((int)wakeCause);
    }
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
    Serial.print("Device path: ");
    Serial.println(devicePath);
    syncClosedWhenLowFromFirebase(userPath, deviceID);
    adoptHistStatusOnce(userPath, deviceID);
    // After Wi-Fi + polarity sync the pin has had time to leave the held wake level.
    // Use this — not the 30 ms wake sample — to decide if a second event is real.
    const bool pinAfterWifi = readSensorClosedStable();
    PendingSensorEvent pendingEvent;
    const bool hasPendingEvent = peekSensorEvent(pendingEvent);
    bool currentStatus = hasPendingEvent
        ? (pendingEvent.closed == 1)
        : pinAfterWifi;
    rtcCapturedClosed = -1;
    Serial.print("Sensor ");
    Serial.print(device_name);
    Serial.print(" -> ");
    Serial.println(currentStatus ? "CLOSED" : "OPEN");
    const int8_t curSt = currentStatus ? 1 : 0;
    // Push when queue has an event OR the live status differs from the last successful send.
    // Do not require GPIO wake cause — ESP sometimes reports timer wake after a real door move.
    const bool shouldSendEvent =
        hasPendingEvent
        || (rtcLastSentStatus >= 0 && curSt != rtcLastSentStatus);
    if (shouldSendEvent) {
        Serial.println("Alarm push via Firebase Cloud Function.");
    } else {
        Serial.println("No alarm event: heartbeat / no status change.");
    }
    char powerSource[16];
    int batteryPct = readBatteryPercent(powerSource, sizeof(powerSource));
    const char* battStatus = batteryStatusLabel(powerSource, batteryPct);
    Serial.print("Battery ");
    Serial.print(batteryPct);
    Serial.print("% → ");
    Serial.println(strcmp(battStatus, "low") == 0 ? "Battery Low" : "Battery OK");
    FirebaseJson json;
    // Never show a new Open/Closed on the card until that event is in history.
    // Using the live pin here left Closed on the card with no Closed history and no push.
    const bool statusForDevice = (rtcLastSentStatus >= 0)
        ? (rtcLastSentStatus == 1)
        : currentStatus;
    json.set("status", statusForDevice);
    json.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
    json.set("lastSeen/.sv", "timestamp");
#else
    json.set("lastSeen", timestampMsNow());
#endif
    json.set("battery", batteryPct);
    if (lastBatteryMv >= 0) json.set("batteryMv", lastBatteryMv);
    json.set("powerSource", powerSource);
    json.set("batteryStatus", battStatus);
    json.set("fwVersion", String(FW_VERSION));
    bool deviceWriteOk = false;
    for (int attempt = 1; attempt <= 3 && !deviceWriteOk; attempt++) {
        deviceWriteOk = Firebase.RTDB.setJSON(&fbdo, devicePath, &json);
        if (!deviceWriteOk) delay(attempt * 1000);
    }
    bool historyWriteOk = !shouldSendEvent;
    if (deviceWriteOk) {
        Serial.println("Firebase: OK");
    } else {
        Serial.print("Firebase FAIL: ");
        Serial.println(fbdo.errorReason());
    }
    bool liveStatus = currentStatus;
    bool sampledLive = false;
    bool sentHistory = false;
    if (deviceWriteOk && shouldSendEvent) {
        // Real magnet changes only. Same status is dropped. The app shows the
        // previous status in History and the live magnet on the card.
        for (int sentCount = 0; sentCount < 4; sentCount++) {
            PendingSensorEvent ev;
            bool fromQueue = peekSensorEvent(ev);
            bool closed = fromQueue ? (ev.closed == 1) : currentStatus;
            int8_t closedSt = closed ? 1 : 0;
            if (fromQueue && rtcLastSentStatus == closedSt) {
                // Do not move lastAcknowledged backwards to this duplicate.
                if (!removeQueuedSensorEvent(ev.sequence, closedSt, false)) {
                    historyWriteOk = false;
                    break;
                }
                historyWriteOk = true;
                Serial.println("Dropped duplicate queued event");
                continue;
            }
            if (!fromQueue && rtcLastSentStatus == closedSt) {
                historyWriteOk = true;
                break;
            }
            int64_t histTs = timestampMsNow();
            if (histTs < 1700000000000LL) histTs = timestampMsNow();
            String historyKey = fromQueue
                ? buildQueuedHistoryKey(deviceID, ev.sequence, ev.nonce)
                : buildHistoryKey(deviceID, closed, (unsigned long)histTs);
            String historyPath = userPath + "/history/" + historyKey;
            FirebaseJson jsonHist;
            jsonHist.set("deviceId", deviceID);
            jsonHist.set("deviceName", String(device_name));
            jsonHist.set("status", closed ? "closed" : "open");
#if RTDB_USE_SV_TIMESTAMP
            jsonHist.set("timestamp/.sv", "timestamp");
#else
            jsonHist.set("timestamp", histTs);
#endif
            bool wrote = false;
            for (int attempt = 1; attempt <= 3 && !wrote; attempt++) {
                wrote = Firebase.RTDB.setJSON(&fbdo, historyPath.c_str(), &jsonHist);
                if (!wrote) delay(attempt * 1000);
            }
            if (!wrote) {
                Serial.println("Event remains queued for retry.");
                historyWriteOk = false;
                break;
            }
            if (fromQueue && !removeQueuedSensorEvent(ev.sequence, closedSt)) {
                Serial.println("Queue commit failed; event will be retried idempotently.");
                historyWriteOk = false;
                break;
            }
            rtcLastSentStatus = closedSt;
            historyWriteOk = true;
            sentHistory = true;
            rememberAcknowledged(closedSt);
            Firebase.RTDB.setString(
                &fbdo,
                (userPath + "/deviceSettings/" + deviceID + "/histStatus").c_str(),
                closed ? "closed" : "open");
            Serial.println(closed ? "Sent CLOSED" : "Sent OPEN");

            liveStatus = readSensorClosedStable();
            sampledLive = true;
            currentStatus = liveStatus;
            // One extra transition per wake, and only if a second stable read
            // agrees. A single glitch after Open was written as Closed, pushed
            // again, and left the card on Closed.
            if (sentCount == 0 && (liveStatus ? 1 : 0) != rtcLastSentStatus) {
                const bool confirm = readSensorClosedStable();
                if (confirm == liveStatus) {
                    enqueueSensorEvent(liveStatus);
                    continue;
                }
                liveStatus = rtcLastSentStatus == 1;
            }
            break;
        }
        if (sentHistory && rtcLastSentStatus >= 0) {
            FirebaseJson liveJson;
            liveJson.set("status", rtcLastSentStatus == 1);
            liveJson.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
            liveJson.set("lastSeen/.sv", "timestamp");
#else
            liveJson.set("lastSeen", timestampMsNow());
#endif
            liveJson.set("battery", batteryPct);
            if (lastBatteryMv >= 0) liveJson.set("batteryMv", lastBatteryMv);
            liveJson.set("powerSource", powerSource);
            liveJson.set("batteryStatus", battStatus);
            liveJson.set("fwVersion", String(FW_VERSION));
            Firebase.RTDB.setJSON(&fbdo, devicePath, &liveJson);
        }
    }
    if (!sampledLive) {
        liveStatus = readSensorClosedStable();
    }
    if (rtcLastSentStatus < 0) {
        enqueueSensorEvent(liveStatus);
    } else if ((liveStatus ? 1 : 0) != rtcLastSentStatus) {
        const bool confirm = readSensorClosedStable();
        if (confirm == liveStatus) {
            enqueueSensorEvent(liveStatus);
        } else {
            liveStatus = rtcLastSentStatus == 1;
        }
    }
    // Arm the opposite of the pin we actually see, so a close wakes the chip
    // and an already-open door does not immediately send another Open.
    nextWakeLevel = wakeLevelForClosed(liveStatus);
    rtcWakeCount++;
    delay(300);
    Serial.flush();
    // OTA on timer wake whenever the queue is empty. Requiring !shouldSendEvent
    // blocked Garage (cwl false on 1.1.24) from ever updating — every wake looked like an event.
    maybeApplyFirmwareUpdate(
        batteryPct,
        powerSource,
        eventQueue.count == 0 && wakeCause == ESP_SLEEP_WAKEUP_TIMER
    );
    // Periodic full restart: clears WiFi stack, SSL session, Firebase library state.
    if (rtcWakeCount >= PERIODIC_RESTART_WAKES) {
        rtcWakeCount = 0;
        Serial.println("Periodic restart to clear accumulated state...");
        delay(100);
        ESP.restart();
        return;
    }
    // Before sleep: RTC pull (ESP32/S3) or gpio pull (C3) ÔÇö see armDeepSleepGpioWakeup().
    armDeepSleepGpioWakeup(nextWakeLevel);
    if (eventQueue.count > 0) {
        esp_sleep_enable_timer_wakeup(2ULL * 1000000ULL);
        Serial.print("Queued events remaining: ");
        Serial.println(eventQueue.count);
    }
    Serial.print("Deep sleep. Next wake: sensor change (waiting for ");
    Serial.print(nextWakeLevel ? "HIGH" : "LOW");
    Serial.print(")");
#if DEEP_SLEEP_HEARTBEAT_SEC > 0
    Serial.print(" or timer ");
    Serial.print(DEEP_SLEEP_HEARTBEAT_SEC);
    Serial.print("s");
#endif
    Serial.println();
    Serial.println("Sleeping...");
    delay(150);
    esp_deep_sleep_start();
    return;
#endif

    Serial.println("ONLINE AND READY!");
}
void loop() {
#if !USE_DEEP_SLEEP
    String userKey = getSafeEmailKey(user_email);
    String userPath = "/users/" + userKey;
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
    bool systemEnabled = true;
    static bool lastStatus = (bool)-1;
    bool currentStatus = readSensorClosedDebounced();
    static int loopCount = 0;
    const bool statusChanged = (currentStatus != lastStatus);
    loopCount++;
    bool shouldSend = statusChanged;
    if (!shouldSend && BATTERY_ADC_PIN >= 0 && loopCount >= 30) {
        shouldSend = true;
        loopCount = 0;
    }
    if (shouldSend) {
        Serial.print("Sensor ");
        Serial.print(device_name);
        Serial.print(" -> ");
        Serial.println(currentStatus ? "CLOSED" : "OPEN");
        char powerSource[16];
        int batteryPct = readBatteryPercent(powerSource, sizeof(powerSource));
        const char* battStatus = batteryStatusLabel(powerSource, batteryPct);
        Serial.print("Battery ");
        Serial.print(batteryPct);
        Serial.print("% → ");
        Serial.println(strcmp(battStatus, "low") == 0 ? "Battery Low" : "Battery OK");
        FirebaseJson json;
        json.set("status", currentStatus);
        json.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
        json.set("lastSeen/.sv", "timestamp");
#else
        json.set("lastSeen", timestampMsNow());
#endif
        json.set("battery", batteryPct);
        if (lastBatteryMv >= 0) json.set("batteryMv", lastBatteryMv);
        json.set("powerSource", powerSource);
        json.set("batteryStatus", battStatus);
        json.set("fwVersion", String(FW_VERSION));
        if (Firebase.RTDB.setJSON(&fbdo, devicePath, &json)) {
            Serial.println("Firebase updated!");
            // History + push only on a real change; periodic sends are just for battery/lastSeen.
            if (statusChanged) {
                unsigned long histTs = timestampMsNow();
                String historyKey = buildHistoryKey(deviceID, currentStatus, histTs);
                String historyPath = userPath + "/history/" + historyKey;
                FirebaseJson jsonHist;
                jsonHist.set("deviceId", deviceID);
                jsonHist.set("deviceName", String(device_name));
                jsonHist.set("status", currentStatus ? "closed" : "open");
#if RTDB_USE_SV_TIMESTAMP
                jsonHist.set("timestamp/.sv", "timestamp");
#else
                jsonHist.set("timestamp", timestampMsNow());
#endif
                Firebase.RTDB.setJSON(&fbdo, historyPath.c_str(), &jsonHist);
            }
        } else {
            Serial.print("Error: ");
            Serial.println(fbdo.errorReason());
        }
        if (statusChanged) lastStatus = currentStatus;
    }
    delay(2000);
#endif
}


