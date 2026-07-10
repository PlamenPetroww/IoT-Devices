# Native push (Android app) – reliable notifications in standby

The Play Store TWA used **Chrome web push**, which Android often stops after ~1 minute in standby.
Version **10+** adds **native Firebase Cloud Messaging (FCM)** – same path as banking apps.

## One-time Firebase setup

1. [Firebase Console](https://console.firebase.google.com/) → project **cleverhaus-petrov**
2. **Project settings** → **Your apps** → **Add app** → **Android**
3. Package name: `com.aurahomesystems.app`
4. Download **google-services.json** → copy to **`app/google-services.json`** (inside the `app` folder, not project root)
5. Do **not** commit `google-services.json` (it is in `.gitignore`)

## Build new AAB (version 10)

```bash
# From project root, with google-services.json in app/
./gradlew bundleRelease
```

Upload `app/build/outputs/bundle/release/app-release.aab` to Google Play (version code **10**).

## After users install v10

1. Open Aura app → log in → dashboard
2. Enable notifications (same as before)
3. App registers a **native** FCM token (not Chrome)
4. Render logs should show: `[native-push] registered for …`
5. On sensor events: `[FCM] … tokens: 1 android` (or `web` on browser only)

## How it works

- **Android app**: `NativePushBridgeActivity` gets native FCM token → `POST /api/register-native-push`
- **Server**: stores token under `pushTokens/native_android` with `platform: "android"`
- **Sensor event**: server sends high-priority **android notification** payload (Play Services delivers in Doze)
- **Browser / desktop**: unchanged web push path
