/*
 * Сензорът в Firebase да стои под ИМЕТО от портала (както на снимката)
 *
 * В loop() ЗАМЕНИ формирането на deviceID:
 *
 * БЕШЕ (с MAC):
 *   String deviceID = WiFi.macAddress();
 *   deviceID.replace(":", "");
 *
 * СТАВА (с име от портала):
 *   String deviceID = getDeviceIdFromName(device_name);
 *
 * Път в Firebase: users/{safeEmail}/devices/{deviceID}
 * Пример: име "Задна Врата" -> ключ "Zadna_Vrata" (латиница) или "Задна_Врата" (кирилица).
 */

// Санитизация на името за Firebase ключ (без транслитерация – ключът остава както е въведен)
String getDeviceIdFromName(char* device_name) {
    String id = String(device_name);
    id.trim();
    if (id.length() == 0) {
        id = WiFi.macAddress();
        id.replace(":", "");
        return id;
    }
    id.replace(" ", "_");
    // Firebase ключове не трябва да съдържат: . $ # [ ] /
    id.replace(".", "_");
    id.replace("$", "_");
    id.replace("#", "_");
    id.replace("[", "_");
    id.replace("]", "_");
    id.replace("/", "_");
    return id;
}

/*
 * ПРИМЕР в loop():
 *
 *   String safeEmail = String(user_email);
 *   safeEmail.trim();
 *   safeEmail.replace(".", "-");
 *
 *   String deviceID = getDeviceIdFromName(device_name);   // <-- вместо MAC
 *   String userPath = "/users/" + safeEmail;
 *   String devicePath = userPath + "/devices/" + deviceID;
 *
 *   // ... systemEnabled check ...
 *
 *   FirebaseJson json;
 *   json.set("status", currentStatus);
 *   json.set("deviceName", String(device_name));   // показваш името и като стойност
 *   json.set("lastSeen", millis());  // или timestamp
 *   json.set("battery", 100);
 *   Firebase.RTDB.updateNode(&fbdo, devicePath, &json);
 *
 * Ако въведеш име на кирилица (напр. "Задна Врата"), ключът ще е "Задна_Врата".
 * В Firebase конзолата понякога кирилицата в ключове се показва объркано – данните са прави.
 * За четим ключ на латиница въведи в портала име на латиница, напр. "Zadna_Vrata" или "Back Door".
 */
