# Push известия – настройка

## 1. Firebase Console

1. Отвори [Firebase Console](https://console.firebase.google.com/) → твоя проект.
2. **Project settings** (иконка зъбно) → **Cloud Messaging**.
3. В **Web Push certificates** натисни **Generate key pair** и копирай **Key pair** (VAPID ключът започва с `B...`).

## 2. Конфигурация в проекта

- В **firebase-config.js** (копие от firebase-config.example.js) добави:
  ```js
  window.FIREBASE_VAPID_KEY = "Bxxxxxxxx...";  // твоят VAPID ключ
  ```
- В **firebase-messaging-sw.js** замени `firebaseConfig` със същите стойности като в **firebase-config.js** (apiKey, projectId, messagingSenderId, appId и т.н.), за да работи service worker-ът за push.

## 3. Dashboard

- Влез в **dashboard** (логин) и натисни **„Включи известия“**.
- Разреши известия в браузъра. Токенът се записва в Realtime Database под `users/<uid>/pushTokens`.

## 4. Render – изпращане на push при събитие от сензор

В **Render** → твоя service → **Environment** добави:

- **FIREBASE_SERVICE_ACCOUNT_JSON** – целият JSON на service account ключа от Firebase (Project settings → Service accounts → Generate new private key). Копирай целия JSON и го постави като стойност на променливата (на един ред).

След това сензорът/Arduino (или друг клиент) трябва при промяна на магнита да извиква:

```http
POST https://cleverhaus.onrender.com/api/sensor-event
Content-Type: application/json

{
  "uid": "Firebase UID на потребителя",
  "deviceId": "id на сензора",
  "deviceName": "Входна врата",
  "state": "open"
}
```

- **uid** – Firebase Auth UID (същият, който се показва в dashboard като „UID за Arduino“).
- **deviceId** – идентификатор на устройството.
- **deviceName** – име за известието (напр. „Входна врата“, „Прозорец детска“).
- **state** – `"open"` или `"closed"`.

Render ще прочете push токените от Realtime Database за този `uid` и ще изпрати FCM известие на всички регистрирани устройства.

## 5. Arduino (автоматично)

В **`AuraSensor_UID.ino`** (не старият код с email) при **промяна на магнита** и **`systemEnabled: true`** (режим „Навън“ в dashboard) сензорът сам извиква:

`POST https://cleverhaus.onrender.com/api/sensor-event`

В WiFi Manager полето е **Firebase UID** (от dashboard), не имейл. Път в RTDB: `/users/<uid>/devices/...`

Push **не** идва само от запис в Firebase — нужен е този API call (вече е в скетча).
