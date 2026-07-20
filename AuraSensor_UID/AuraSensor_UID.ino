#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "esp_sleep.h"
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
#define DEEP_SLEEP_HEARTBEAT_SEC 900
// 0 = disabled. If >0: only when powerSource is "battery" and % is below the threshold (see readBatteryPercent ÔÇö ADC gray zone = no_battery, no skip).
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
// Battery: classic ESP32 = GPIO 34. ESP32-C3 = GPIO 0 (D0) if the battery is wired there.
#if CONFIG_IDF_TARGET_ESP32C3
#define BATTERY_ADC_PIN 0
#else
#define BATTERY_ADC_PIN 34
#endif
#define BATTERY_ADC_EMPTY 1500
#define BATTERY_ADC_FULL  2500
#define USB_DETECT_PIN -1
#define BATTERY_ADC_NO_CELL 400
// --- Defaults (after first entry via the portal they are kept in flash) ---
#define DEVICE_NAME_DEFAULT "Senzor1"
// ---
char user_email[64];
char device_name[30];
Preferences prefs;
bool shouldSaveConfig = false;
void saveConfigCallback() {
    shouldSaveConfig = true;
}
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
// Valid ext0 levels: 0 = LOW, 1 = HIGH (do not use -1 for wakeup).
RTC_DATA_ATTR int nextWakeLevel = 0;
RTC_DATA_ATTR int8_t rtcLastSentStatus = -1;  // -1 = nothing sent yet; 0/1 = last sent status
RTC_DATA_ATTR int8_t rtcCapturedClosed = -1;  // sensor state captured immediately after GPIO wake
// Periodic full restart: every PERIODIC_RESTART_WAKES wakeups do ESP.restart() to clear any
// accumulated WiFi/SSL/Firebase state that degrades over time.
#define PERIODIC_RESTART_WAKES 50
RTC_DATA_ATTR uint16_t rtcWakeCount = 0;

#define SENSOR_DEBOUNCE_MS 50
#define SENSOR_DEBOUNCE_SAMPLES 5

// HIGH = magnet near = closed. Majority vote filters reed bounce on open/close.
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
    return highCount * 2 >= SENSOR_DEBOUNCE_SAMPLES;
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

#define HISTORY_BUCKET_MS 45000UL

String buildHistoryKey(const String& deviceID, bool isClosed, unsigned long tsMs) {
    unsigned long bucket = tsMs / HISTORY_BUCKET_MS;
    String status = isClosed ? "closed" : "open";
    return deviceID + "_" + status + "_" + String(bucket);
}

int readBatteryPercent(char* powerSourceOut, size_t powerSourceLen) {
    powerSourceOut[0] = '\0';
    if (USB_DETECT_PIN >= 0 && digitalRead(USB_DETECT_PIN) == HIGH) {
        strncpy(powerSourceOut, "usb", powerSourceLen - 1);
        powerSourceOut[powerSourceLen - 1] = '\0';
        return 100;
    }
    if (BATTERY_ADC_PIN < 0) {
        strncpy(powerSourceOut, "usb", powerSourceLen - 1);
        powerSourceOut[powerSourceLen - 1] = '\0';
        return 100;
    }
    long sum = 0;
    for (int i = 0; i < 5; i++) {
        sum += analogRead(BATTERY_ADC_PIN);
        delay(2);
    }
    int raw = sum / 5;
    if (raw < BATTERY_ADC_NO_CELL) {
        strncpy(powerSourceOut, "usb", powerSourceLen - 1);
        powerSourceOut[powerSourceLen - 1] = '\0';
        return 100;
    }
    // Between NO_CELL and EMPTY: no valid divider/cell (floating ADC on GPIO0 etc.) ÔÇö not "battery", so Wi-Fi is never skipped.
    if (raw < BATTERY_ADC_EMPTY) {
        strncpy(powerSourceOut, "no_battery", powerSourceLen - 1);
        powerSourceOut[powerSourceLen - 1] = '\0';
        return 0;
    }
    strncpy(powerSourceOut, "battery", powerSourceLen - 1);
    powerSourceOut[powerSourceLen - 1] = '\0';
    if (raw <= BATTERY_ADC_EMPTY) return 0;
    if (raw >= BATTERY_ADC_FULL) return 100;
    int pct = map(raw, BATTERY_ADC_EMPTY, BATTERY_ADC_FULL, 0, 100);
    return (pct < 0) ? 0 : (pct > 100 ? 100 : pct);
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
    gpio_deep_sleep_hold_en();
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
void setup() {
    const esp_sleep_wakeup_cause_t bootWakeCause = esp_sleep_get_wakeup_cause();
    const bool coldBoot = (bootWakeCause == ESP_SLEEP_WAKEUP_UNDEFINED);
    if (coldBoot) {
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
    if (BATTERY_ADC_PIN >= 0) pinMode(BATTERY_ADC_PIN, INPUT);
    if (USB_DETECT_PIN >= 0) pinMode(USB_DETECT_PIN, INPUT);
#if USE_DEEP_SLEEP
    {
        const esp_sleep_wakeup_cause_t earlyWake = esp_sleep_get_wakeup_cause();
        bool st = readSensorClosedDebounced();
        nextWakeLevel = st ? 0 : 1;
        if (earlyWake == ESP_SLEEP_WAKEUP_EXT0
#if CONFIG_IDF_TARGET_ESP32C3
            || earlyWake == ESP_SLEEP_WAKEUP_GPIO
#endif
        ) {
            rtcCapturedClosed = st ? 1 : 0;
            Serial.print("Sensor at wake: ");
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
            armDeepSleepGpioWakeup(nextWakeLevel);
            esp_sleep_enable_timer_wakeup(300ULL * 1000000ULL);
            esp_deep_sleep_start();
            return;
        }
#endif
        WiFiManager wm;
        wm.setSaveConfigCallback(saveConfigCallback);
        bool emailWasRejected = false;
        {
            prefs.begin("aura", true);
            emailWasRejected = prefs.getBool("emailbad", false);
            prefs.end();
        }
        WiFiManagerParameter warn_html(
            "<p style='color:#c00;font-weight:bold'>The email address could not be verified. "
            "Please check it for typos and enter it again.</p>");
        if (emailWasRejected) {
            wm.addParameter(&warn_html);
        }
        WiFiManagerParameter custom_email(
            "fbemail",
            "Email (same as your account registration)",
            user_email,
            sizeof(user_email) - 1);
        WiFiManagerParameter custom_name(
            "dname",
            "Sensor name",
            device_name,
            sizeof(device_name) - 1);
        wm.addParameter(&custom_email);
        wm.addParameter(&custom_name);
        bool portalOk;
        if (!emailLooksValid(user_email)) {
            // No (valid) email ÔåÆ forced portal. startConfigPortal keeps the saved WiFi network,
            // so after a rejected email the user only has to fix the email.
            Serial.println("No email ÔÇö opening setup portal (AuraHomeSystems_Setup)...");
            portalOk = wm.startConfigPortal("AuraHomeSystems_Setup");
        } else {
#if USE_DEEP_SLEEP
            // Configured battery-powered sensor: the portal must not hang forever (AP mode ~100 mA).
            wm.setConfigPortalTimeout(180);
#endif
            portalOk = wm.autoConnect("AuraHomeSystems_Setup");
        }
        if (!portalOk) {
#if USE_DEEP_SLEEP
            if (emailLooksValid(user_email)) {
                // Router missing/power outage: sleep 5 min and retry instead of keeping the portal open.
                Serial.println("No WiFi ÔÇö deep sleep 5 min, then retry.");
                Serial.flush();
                armDeepSleepGpioWakeup(nextWakeLevel);
                esp_sleep_enable_timer_wakeup(300ULL * 1000000ULL);
                esp_deep_sleep_start();
            }
#endif
            Serial.println("Failed! Restarting...");
            delay(3000);
            ESP.restart();
        }
        strncpy(user_email, custom_email.getValue(), sizeof(user_email) - 1);
        user_email[sizeof(user_email) - 1] = '\0';
        strncpy(device_name, custom_name.getValue(), sizeof(device_name) - 1);
        device_name[sizeof(device_name) - 1] = '\0';
        {
            String e = String(user_email);
            e.trim();
            e.toLowerCase();
            e.toCharArray(user_email, sizeof(user_email));
            String n = String(device_name);
            n.trim();
            n.toCharArray(device_name, sizeof(device_name));
        }
        if (!emailLooksValid(user_email)) {
            Serial.println("ERROR: Enter a valid email in the setup portal. Restarting...");
            delay(3000);
            ESP.restart();
        }
        if (shouldSaveConfig || strcmp(prev_email, user_email) != 0) {
            saveSensorConfigToNvs();
            Serial.print("Email saved: ");
            Serial.println(user_email);
        }
        emailFromPortal = true;
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
    const bool wakeFromTimer = (wakeCause == ESP_SLEEP_WAKEUP_TIMER);
    const bool wakeFromSensor = (wakeCause == ESP_SLEEP_WAKEUP_EXT0
#if CONFIG_IDF_TARGET_ESP32C3
        || wakeCause == ESP_SLEEP_WAKEUP_GPIO
#endif
    );
    if (wakeCause != ESP_SLEEP_WAKEUP_UNDEFINED) {
        Serial.print("Wakeup cause: ");
        Serial.println((int)wakeCause);
    }
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
    Serial.print("Device path: ");
    Serial.println(devicePath);
    bool currentStatus;
    if (rtcCapturedClosed >= 0) {
        currentStatus = (rtcCapturedClosed == 1);
        rtcCapturedClosed = -1;
        Serial.println("Using sensor state from wake (before Wi-Fi)");
    } else {
        currentStatus = readSensorClosedDebounced();
    }
    Serial.print("Sensor ");
    Serial.print(device_name);
    Serial.print(" -> ");
    Serial.println(currentStatus ? "CLOSED" : "OPEN");
    const int8_t curSt = currentStatus ? 1 : 0;
    const bool statusChanged = (rtcLastSentStatus < 0 || rtcLastSentStatus != curSt);
    const bool shouldSendEvent = statusChanged;
    if (shouldSendEvent) {
        Serial.println("Alarm push via Firebase Cloud Function.");
    } else {
        Serial.println("No Render event: timer/no status change.");
    }
    char powerSource[16];
    int batteryPct = readBatteryPercent(powerSource, sizeof(powerSource));
    FirebaseJson json;
    json.set("status", currentStatus);
    json.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
    json.set("lastSeen/.sv", "timestamp");
#else
    json.set("lastSeen", timestampMsNow());
#endif
    json.set("battery", batteryPct);
    json.set("powerSource", powerSource);
    if (Firebase.RTDB.setJSON(&fbdo, devicePath, &json)) {
        Serial.println("Firebase: OK");
        // History only on a real change ÔÇö otherwise resets/false wakes fill the list with identical entries.
        const bool writeHistory = shouldSendEvent;
        if (writeHistory) {
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
        Serial.print("Firebase FAIL: ");
        Serial.println(fbdo.errorReason());
    }
    rtcLastSentStatus = curSt;
    nextWakeLevel = currentStatus ? 0 : 1;
    rtcWakeCount++;
    delay(300);
    Serial.flush();
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
        FirebaseJson json;
        json.set("status", currentStatus);
        json.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
        json.set("lastSeen/.sv", "timestamp");
#else
        json.set("lastSeen", timestampMsNow());
#endif
        json.set("battery", batteryPct);
        json.set("powerSource", powerSource);
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
