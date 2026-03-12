#include <WiFi.h>
#include <WiFiManager.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoJson.h>
#include <time.h>
#include "esp_sleep.h"
#if CONFIG_IDF_TARGET_ESP32
#include "driver/rtc_io.h"
extern "C" void esp_sleep_enable_ext0_wakeup(gpio_num_t gpio, int level);
#elif CONFIG_IDF_TARGET_ESP32C3
#include "driver/gpio.h"
#endif
// ========== DEEP SLEEP: 1 = батерия ~6 месеца, 0 = без deep sleep (за тест без заспиване)
#define USE_DEEP_SLEEP 1
// --- КОНФИГУРАЦИЯ FIREBASE ---
#define FIREBASE_HOST "https://cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app"
#define FIREBASE_AUTH "5h8JwKgmM9yFZuzBlCYSQ9mPEjdWPq552l7U9irF"
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
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
// --- ТВОЯТ АКАУНТ И ИМЕ НА СЕНЗОРА (смени преди компилиране, после всичко е автоматично) ---
#define FIREBASE_USER_UID "I5u2P9EvXpgxOE9RaUj6pVDsORE3"
#define DEVICE_NAME_DEFAULT "Senzor1"
// ---
char user_uid[64];
char device_name[30];
RTC_DATA_ATTR int nextWakeLevel = -1;
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
    strncpy(powerSourceOut, "battery", powerSourceLen - 1);
    powerSourceOut[powerSourceLen - 1] = '\0';
    if (raw <= BATTERY_ADC_EMPTY) return 0;
    if (raw >= BATTERY_ADC_FULL) return 100;
    int pct = map(raw, BATTERY_ADC_EMPTY, BATTERY_ADC_FULL, 0, 100);
    return (pct < 0) ? 0 : (pct > 100 ? 100 : pct);
}
void setup() {
#if !USE_DEEP_SLEEP
    delay(2000);
#endif
    Serial.begin(115200);
    Serial.println("\n--- PetrovSolution ---");
    strncpy(user_uid, FIREBASE_USER_UID, sizeof(user_uid) - 1);
    user_uid[sizeof(user_uid) - 1] = '\0';
    strncpy(device_name, DEVICE_NAME_DEFAULT, sizeof(device_name) - 1);
    device_name[sizeof(device_name) - 1] = '\0';
    pinMode(sensorPin, INPUT_PULLUP);
    if (BATTERY_ADC_PIN >= 0) pinMode(BATTERY_ADC_PIN, INPUT);
    if (USB_DETECT_PIN >= 0) pinMode(USB_DETECT_PIN, INPUT);
    WiFiManager wm;
    if (!wm.autoConnect("AuraHomeSolutions_Setup")) {
        Serial.println("Neuspeh! Restart...");
        delay(3000);
        ESP.restart();
    }
    config.database_url = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    delay(800);
    // Път: /users/<uid>/
    String uidStr = String(user_uid);
    uidStr.trim();
    String userPath = "/users/" + uidStr;
#if USE_DEEP_SLEEP
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
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
    json.set("lastSeen", millis());
    json.set("battery", batteryPct);
    json.set("powerSource", powerSource);
    if (Firebase.RTDB.setJSON(&fbdo, devicePath, &json)) {
        Serial.println("Firebase: OK");
        time_t nowSec;
        time(&nowSec);
        unsigned long long tsMs = (unsigned long long)nowSec * 1000;
        if (tsMs == 0) tsMs = (unsigned long long)millis();
        String historyKey = String(millis()) + "_" + String((uint32_t)(esp_random() & 0xFFFF));
        String historyPath = userPath + "/history/" + historyKey;
        FirebaseJson jsonHist;
        jsonHist.set("deviceId", deviceID);
        jsonHist.set("deviceName", String(device_name));
        jsonHist.set("status", currentStatus ? "closed" : "open");
        jsonHist.set("timestamp", (int64_t)tsMs);
        Firebase.RTDB.setJSON(&fbdo, historyPath.c_str(), &jsonHist);
    } else {
        Serial.print("Firebase FAIL: ");
        Serial.println(fbdo.errorReason());
    }
    nextWakeLevel = currentStatus ? 0 : 1;
    delay(300);
    Serial.flush();
    WiFi.disconnect(true);
    delay(50);
    WiFi.mode(WIFI_OFF);
    pinMode(sensorPin, INPUT_PULLUP);
    delay(200);
#if CONFIG_IDF_TARGET_ESP32
    esp_sleep_enable_ext0_wakeup((gpio_num_t)sensorPin, nextWakeLevel);
#elif CONFIG_IDF_TARGET_ESP32C3
    esp_deep_sleep_enable_gpio_wakeup(1ULL << sensorPin, nextWakeLevel ? ESP_GPIO_WAKEUP_GPIO_HIGH : ESP_GPIO_WAKEUP_GPIO_LOW);
#else
    esp_sleep_enable_ext0_wakeup((gpio_num_t)sensorPin, nextWakeLevel);
#endif
    Serial.println("Spam...");
    delay(150);
    esp_deep_sleep_start();
    return;
#endif
    Serial.println("ONLINE I GOTOVO!");
}
void loop() {
#if !USE_DEEP_SLEEP
    String uidStr = String(user_uid);
    uidStr.trim();
    String userPath = "/users/" + uidStr;
    String deviceID = getDeviceIdFromName(device_name);
    String devicePath = userPath + "/devices/" + deviceID;
    bool systemEnabled = false;
    if (Firebase.RTDB.getBool(&fbdo, userPath + "/systemEnabled")) {
        if (fbdo.dataType() == "boolean") {
            systemEnabled = fbdo.boolData();
        }
    }
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
        json.set("lastSeen", millis());
        json.set("battery", batteryPct);
        json.set("powerSource", powerSource);
        if (Firebase.RTDB.setJSON(&fbdo, devicePath, &json)) {
            Serial.println("Firebase obnoven!");
            time_t nowSec;
            time(&nowSec);
            unsigned long long tsMs = (unsigned long long)nowSec * 1000;
            if (tsMs == 0) tsMs = (unsigned long long)millis();
            String historyKey = String(millis()) + "_" + String((uint32_t)(esp_random() & 0xFFFF));
            String historyPath = userPath + "/history/" + historyKey;
            FirebaseJson jsonHist;
            jsonHist.set("deviceId", deviceID);
            jsonHist.set("deviceName", String(device_name));
            jsonHist.set("status", currentStatus ? "closed" : "open");
            jsonHist.set("timestamp", (int64_t)tsMs);
            Firebase.RTDB.setJSON(&fbdo, historyPath.c_str(), &jsonHist);
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
