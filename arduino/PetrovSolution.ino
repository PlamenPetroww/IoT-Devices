#include <WiFi.h>
#include <WiFiManager.h>
#include <Firebase_ESP_Client.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

// --- КОНФИГУРАЦИЯ FIREBASE ---
#define FIREBASE_HOST "cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app"
#define FIREBASE_AUTH "5h8JwKgmM9yFZuzBlCYSQ9mPEjdWPq552l7U9irF"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

const int sensorPin = 4;
char user_email[50] = "";
char device_name[30] = "";
bool shouldSaveConfig = false;

void saveConfigCallback() {
    shouldSaveConfig = true;
}

// Транслитерация: българска кирилица -> латиница (за ключ в Firebase, без объркани символи)
String transliterateToLatin(String s) {
    String out = "";
    const char* p = s.c_str();
    while (*p) {
        unsigned char c = (unsigned char)*p;
        if (c < 128) {
            out += (char)c;
            p++;
            continue;
        }
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

// Името на сензора -> ключ за Firebase: латиница + долни черти (без объркани символи)
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
    id.replace("$", "_");
    id.replace("#", "_");
    id.replace("[", "_");
    id.replace("]", "_");
    id.replace("/", "_");
    return id;
}

void setup() {
    delay(2000);
    Serial.begin(115200);
    Serial.println("\n--- PetrovSolution ---");

    pinMode(sensorPin, INPUT_PULLUP);

    if (LittleFS.begin(true)) {
        if (LittleFS.exists("/config.json")) {
            File configFile = LittleFS.open("/config.json", "r");
            if (configFile) {
                StaticJsonDocument<256> doc;
                deserializeJson(doc, configFile);
                strcpy(user_email, doc["email"]);
                strcpy(device_name, doc["name"]);
                configFile.close();
            }
        }
    }

    WiFiManager wm;
    wm.setSaveConfigCallback(saveConfigCallback);

    WiFiManagerParameter custom_email("email", "Vavedi Email", user_email, 50);
    WiFiManagerParameter custom_name("name", "Ime na tozi senzor", device_name, 30);
    wm.addParameter(&custom_email);
    wm.addParameter(&custom_name);

    if (!wm.autoConnect("PetrovSolution_Setup")) {
        Serial.println("Neuspeh! Restart...");
        delay(3000);
        ESP.restart();
    }

    strcpy(user_email, custom_email.getValue());
    strcpy(device_name, custom_name.getValue());

    if (shouldSaveConfig) {
        StaticJsonDocument<256> doc;
        doc["email"] = user_email;
        doc["name"] = device_name;
        File configFile = LittleFS.open("/config.json", "w");
        serializeJson(doc, configFile);
        configFile.close();
        Serial.println("Nastrojkite zapaseni!");
    }

    config.database_url = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    Serial.println("ONLINE I GOTOVO!");
}

void loop() {
    String safeEmail = String(user_email);
    safeEmail.trim();
    safeEmail.replace(".", "-");

    String deviceID = getDeviceIdFromName(device_name);
    String userPath = "/users/" + safeEmail;
    String devicePath = userPath + "/devices/" + deviceID;

    bool systemEnabled = false;
    if (Firebase.RTDB.getBool(&fbdo, userPath + "/systemEnabled")) {
        if (fbdo.dataType() == "boolean") {
            systemEnabled = fbdo.boolData();
        }
    }

    if (!systemEnabled) {
        Serial.println("Rejim DOM: Senzorat ne prashta danni. Vklychi Navun ot tabloto.");
        delay(5000);
        return;
    }

    static bool lastStatus = (bool)-1;
    bool currentStatus = (digitalRead(sensorPin) == LOW);

    if (currentStatus != lastStatus) {
        Serial.print("Senzor ");
        Serial.print(device_name);
        Serial.print(" -> ");
        Serial.println(currentStatus ? "ZATVORENO" : "OTVORENO");

        FirebaseJson json;
        json.set("status", currentStatus);
        json.set("deviceName", String(device_name));
        json.set("lastSeen", millis());
        json.set("battery", 100);

        if (Firebase.RTDB.updateNode(&fbdo, devicePath, &json)) {
            Serial.println("Firebase obnoven!");
            // Ново поле в user профила: име_на_сензора = true/false (при промяна на магнита)
            String profileFieldPath = userPath + "/" + deviceID;
            if (Firebase.RTDB.setBool(&fbdo, profileFieldPath, currentStatus)) {
                Serial.println("Profil pole obnoveno: " + deviceID + " = " + (currentStatus ? "true" : "false"));
            }
        } else {
            Serial.print("Greshka: ");
            Serial.println(fbdo.errorReason());
        }

        lastStatus = currentStatus;
    }

    delay(2000);
}
