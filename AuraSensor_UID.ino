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
// 1: След всяко изпращане чипът заспива — НЕ изпраща непрекъснато. Нов запис идва при смяна на
//    магнита (събуждане по GPIO) и/или при heartbeat таймер по-долу (ако е > 0).
// 0: Винаги буден — изпраща при промяна + периодично батерия (като стар режим за тест).
#define USE_DEEP_SLEEP 1
// След reset чака толкова ms ПРЕДИ Wi‑Fi/sleep — за качване на скетч и Serial Monitor. Продукт на батерия: 0.
#if USE_DEEP_SLEEP
#define UPLOAD_GRACE_MS 20000
#else
#define UPLOAD_GRACE_MS 0
#endif
// 1 = lastSeen/history през Firebase .sv (ако библиотеката го поддържа). 0 = millis() — по-надеждно за запис.
#define RTDB_USE_SV_TIMESTAMP 0
// При deep sleep: 0 = само магнит. Напр. 3600 = веднъж на час изпраща пак (жив ли е, батерия).
#define DEEP_SLEEP_HEARTBEAT_SEC 0
// 0 = изключено. При >0: само ако powerSource е „battery“ и % е под прага (виж readBatteryPercent — сива зона ADC = no_battery, без skip).
#define LOW_BATT_SKIP_WIFI_PCT 0
#define LOW_BATT_RETRY_SEC (6UL * 3600UL)
// --- КОНФИГУРАЦИЯ FIREBASE ---
#define FIREBASE_HOST "https://cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app"
// ВНИМАНИЕ: legacy Database Secret е остарял/непрепоръчителен; за продукт → Service Account или друг auth.
#define FIREBASE_AUTH "5h8JwKgmM9yFZuzBlCYSQ9mPEjdWPq552l7U9irF"
// Render API — FCM push при промяна на магнита (само ако systemEnabled=true).
#define PUSH_API_URL "https://cleverhaus.onrender.com/api/sensor-event"
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
// Reed към GND при „активно“: INPUT_PULLUP. За по-малък ток в sleep ползвай външен pull-up 100k–1M към 3V3.
const int sensorPin = 4;
// Батерия: ESP32 класически = GPIO 34. ESP32-C3 = GPIO 0 (D0) ако батерията е свързана там.
#if CONFIG_IDF_TARGET_ESP32C3
#define BATTERY_ADC_PIN 0
#else
#define BATTERY_ADC_PIN 34
#endif
#define BATTERY_ADC_EMPTY 1500
#define BATTERY_ADC_FULL  2500
#define USB_DETECT_PIN -1
#define BATTERY_ADC_NO_CELL 400
// --- Стойности по подразбиране (след първо въвеждане през портала се пазят във флаша) ---
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
// Валидни нива за ext0: 0 = LOW, 1 = HIGH (не ползвай -1 при wakeup).
RTC_DATA_ATTR int nextWakeLevel = 0;
RTC_DATA_ATTR int8_t rtcLastSentStatus = -1;  // -1 = още не сме писали; 0/1 = последен статус
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
    // Между NO_CELL и EMPTY: няма валиден делител/клетка (плаващ ADC на GPIO0 и т.н.) — не е „battery“, за да не спира Wi‑Fi.
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

static void sendPushIfAway(
    const String& userKey,
    const String& deviceId,
    const String& deviceName,
    bool isClosed) {
    if (WiFi.status() != WL_CONNECTED) return;
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    if (!http.begin(client, PUSH_API_URL)) {
        Serial.println("Push API: begin failed");
        return;
    }
    http.addHeader("Content-Type", "application/json");
    StaticJsonDocument<384> doc;
    doc["userKey"] = userKey;
    doc["deviceId"] = deviceId;
    doc["deviceName"] = deviceName;
    doc["state"] = isClosed ? "closed" : "open";
    String body;
    serializeJson(doc, body);
    int code = http.POST(body);
    Serial.print("Push API HTTP ");
    Serial.println(code);
    if (code > 0) {
        String resp = http.getString();
        if (resp.length() > 0) {
            Serial.println(resp);
        }
    }
    http.end();
}
// Изключва Wi‑Fi и настройва GPIO wake + опционален heartbeat таймер преди esp_deep_sleep_start().
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
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_GPIO);
    esp_deep_sleep_enable_gpio_wakeup(
        1ULL << sensorPin,
        wakeLevel ? ESP_GPIO_WAKEUP_GPIO_HIGH : ESP_GPIO_WAKEUP_GPIO_LOW);
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
#if UPLOAD_GRACE_MS > 0
    delay(UPLOAD_GRACE_MS);
#endif
#if !USE_DEEP_SLEEP
    delay(2000);
#endif
    Serial.begin(115200);
    Serial.println("\n--- PetrovSolution ---");
#if USE_DEEP_SLEEP && UPLOAD_GRACE_MS > 0
    Serial.println("UPLOAD: ako ne mojesh da kachish — XIAO C3/S3: zadraj BOOT, natisni RST, pusni BOOT sled 1s, Upload.");
#endif
    loadSensorConfigFromNvs();
    pinMode(sensorPin, INPUT_PULLUP);
    if (BATTERY_ADC_PIN >= 0) pinMode(BATTERY_ADC_PIN, INPUT);
    if (USB_DETECT_PIN >= 0) pinMode(USB_DETECT_PIN, INPUT);
#if USE_DEEP_SLEEP
    {
        bool st = (digitalRead(sensorPin) == HIGH);
        nextWakeLevel = st ? 0 : 1;
    }
#if LOW_BATT_SKIP_WIFI_PCT > 0
    {
        char psLow[16];
        int batLow = readBatteryPercent(psLow, sizeof(psLow));
        if (batLow < (int)LOW_BATT_SKIP_WIFI_PCT && strcmp(psLow, "battery") == 0) {
            Serial.print("Kritichna bateriya ");
            Serial.print(batLow);
            Serial.print("% — bez Wi-Fi, retry sled ");
            Serial.print((unsigned long)(LOW_BATT_RETRY_SEC / 3600UL));
            Serial.println(" ch");
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
    WiFiManager wm;
    wm.setSaveConfigCallback(saveConfigCallback);
    WiFiManagerParameter custom_email(
        "fbemail",
        "Email (sushtiyat pri registracia)",
        user_email,
        sizeof(user_email) - 1);
    WiFiManagerParameter custom_name(
        "dname",
        "Ime na tozi senzor",
        device_name,
        sizeof(device_name) - 1);
    wm.addParameter(&custom_email);
    wm.addParameter(&custom_name);
    if (!emailLooksValid(user_email)) {
        Serial.println("Nyama email — otvoren setup portal (AuraHomeSystems_Setup)...");
        wm.resetSettings();
    }
    if (!wm.autoConnect("AuraHomeSystems_Setup")) {
        Serial.println("Neuspeh! Restart...");
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
        Serial.println("GRESHKA: Vavedete validen email v setup portala. Restart...");
        delay(3000);
        ESP.restart();
    }
    if (shouldSaveConfig || strcmp(prev_email, user_email) != 0) {
        saveSensorConfigToNvs();
        Serial.print("Email zapazen: ");
        Serial.println(user_email);
        Serial.println("Registrirai se na saita sas sushtiya email.");
    }
    config.database_url = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
#if !USE_DEEP_SLEEP
    // При buden rezim NTP e polezen za lokalno vreme; pri deep sleep vremeto e ot Firebase .sv.
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    delay(800);
#endif
    // Път: /users/<email_key>/ — същият като dashboard след регистрация
    String userKey = getSafeEmailKey(user_email);
    String userPath = "/users/" + userKey;
#if USE_DEEP_SLEEP
    const esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
    const bool wakeFromTimer = (wakeCause == ESP_SLEEP_WAKEUP_TIMER);
    if (wakeCause != ESP_SLEEP_WAKEUP_UNDEFINED) {
        Serial.print("Wakeup cause: ");
        Serial.println((int)wakeCause);
    }
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
    bool systemEnabled = readSystemEnabled(userPath);
    bool currentStatus = (digitalRead(sensorPin) == HIGH);
    Serial.print("Senzor ");
    Serial.print(device_name);
    Serial.print(" -> ");
    Serial.println(currentStatus ? "ZATVORENO" : "OTVORENO");
    char powerSource[16];
    int batteryPct = readBatteryPercent(powerSource, sizeof(powerSource));
    FirebaseJson json;
    json.set("status", currentStatus);
    json.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
    json.set("lastSeen/.sv", "timestamp");
#else
    json.set("lastSeen", (int64_t)millis());
#endif
    json.set("battery", batteryPct);
    json.set("powerSource", powerSource);
    if (Firebase.RTDB.setJSON(&fbdo, devicePath, &json)) {
        Serial.println("Firebase: OK");
        const int8_t curSt = currentStatus ? 1 : 0;
        const bool statusChanged = (rtcLastSentStatus < 0 || rtcLastSentStatus != curSt);
        const bool writeHistory = !wakeFromTimer || statusChanged;
        if (writeHistory) {
            String historyKey = String(millis()) + "_" + String((uint32_t)(esp_random() & 0xFFFF));
            String historyPath = userPath + "/history/" + historyKey;
            FirebaseJson jsonHist;
            jsonHist.set("deviceId", deviceID);
            jsonHist.set("deviceName", String(device_name));
            jsonHist.set("status", currentStatus ? "closed" : "open");
#if RTDB_USE_SV_TIMESTAMP
            jsonHist.set("timestamp/.sv", "timestamp");
#else
            jsonHist.set("timestamp", (int64_t)millis());
#endif
            Firebase.RTDB.setJSON(&fbdo, historyPath.c_str(), &jsonHist);
        }
        if (statusChanged && systemEnabled) {
            sendPushIfAway(userKey, deviceID, String(device_name), currentStatus);
        }
        rtcLastSentStatus = curSt;
    } else {
        Serial.print("Firebase FAIL: ");
        Serial.println(fbdo.errorReason());
    }
    nextWakeLevel = currentStatus ? 0 : 1;
    delay(300);
    Serial.flush();
    // Преди sleep: RTC pull (ESP32/S3) или gpio pull (C3) — виж armDeepSleepGpioWakeup().
    armDeepSleepGpioWakeup(nextWakeLevel);
    Serial.print("Deep sleep. Sledvasht bud: promiana na senzor (chekai ");
    Serial.print(nextWakeLevel ? "HIGH" : "LOW");
    Serial.print(")");
#if DEEP_SLEEP_HEARTBEAT_SEC > 0
    Serial.print(" ili timer ");
    Serial.print(DEEP_SLEEP_HEARTBEAT_SEC);
    Serial.print("s");
#endif
    Serial.println();
    Serial.println("Spam...");
    delay(150);
    esp_deep_sleep_start();
    return;
#endif
    Serial.println("ONLINE I GOTOVO!");
}
void loop() {
#if !USE_DEEP_SLEEP
    String userKey = getSafeEmailKey(user_email);
    String userPath = "/users/" + userKey;
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
    bool systemEnabled = readSystemEnabled(userPath);
    static bool lastStatus = (bool)-1;
    bool currentStatus = (digitalRead(sensorPin) == HIGH);
    static int loopCount = 0;
    const bool statusChanged = (currentStatus != lastStatus);
    loopCount++;
    bool shouldSend = statusChanged;
    if (!shouldSend && BATTERY_ADC_PIN >= 0 && loopCount >= 30) {
        shouldSend = true;
        loopCount = 0;
    }
    if (shouldSend) {
        Serial.print("Senzor ");
        Serial.print(device_name);
        Serial.print(" -> ");
        Serial.println(currentStatus ? "ZATVORENO" : "OTVORENO");
        char powerSource[16];
        int batteryPct = readBatteryPercent(powerSource, sizeof(powerSource));
        FirebaseJson json;
        json.set("status", currentStatus);
        json.set("deviceName", String(device_name));
#if RTDB_USE_SV_TIMESTAMP
        json.set("lastSeen/.sv", "timestamp");
#else
        json.set("lastSeen", (int64_t)millis());
#endif
        json.set("battery", batteryPct);
        json.set("powerSource", powerSource);
        if (Firebase.RTDB.setJSON(&fbdo, devicePath, &json)) {
            Serial.println("Firebase obnoven!");
            String historyKey = String(millis()) + "_" + String((uint32_t)(esp_random() & 0xFFFF));
            String historyPath = userPath + "/history/" + historyKey;
            FirebaseJson jsonHist;
            jsonHist.set("deviceId", deviceID);
            jsonHist.set("deviceName", String(device_name));
            jsonHist.set("status", currentStatus ? "closed" : "open");
#if RTDB_USE_SV_TIMESTAMP
            jsonHist.set("timestamp/.sv", "timestamp");
#else
            jsonHist.set("timestamp", (int64_t)millis());
#endif
            Firebase.RTDB.setJSON(&fbdo, historyPath.c_str(), &jsonHist);
            if (statusChanged && systemEnabled) {
                sendPushIfAway(userKey, deviceID, String(device_name), currentStatus);
            }
        } else {
            Serial.print("Greshka: ");
            Serial.println(fbdo.errorReason());
        }
        if (statusChanged) lastStatus = currentStatus;
    }
    if (!systemEnabled) {
        delay(5000);
        return;
    }
    delay(2000);
#endif
}
