#include <Arduino.h>
#include <Preferences.h>
#include <nvs_flash.h>

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("      WiFi mreji - IZTRITI");

  Serial.println("[2/3] Iztrivane na email i ime na senzor (namespace 'aura')...");
  Preferences prefs;
  prefs.begin("aura", false);
  prefs.clear();
  prefs.end();
  Serial.println("      Email/ime - IZTRITI");

  Serial.println("[3/3] Pulno iztrivane na NVS flash...");
  esp_err_t err = nvs_flash_erase();
  if (err == ESP_OK) {
    Serial.println("      NVS - NAPULNO IZTRITA");
  } else {
    Serial.print("      NVS erase greshka: ");
    Serial.println(err);
  }
  nvs_flash_init();

  Serial.println("\n--- GOTOVO! Platkata e kato nova. ---");
  Serial.println("Sega kachi AuraSensor_UID.ino - shte se otvori");
  Serial.println("setup portal 'AuraHomeSystems_Setup' kato pri nov senzor.");
  Serial.println("--------------------------------------\n");
}

void loop() {
  Serial.print("[LOG] Hard reset zavurshen. Vreme ot starta: ");
  Serial.print(millis() / 1000);
  Serial.println(" sekundi. Kachi osnovniya sketch.");
  delay(5000);
}
