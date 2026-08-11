# Aura HomeSystems for iOS

The iOS app is a Capacitor shell around the existing authenticated Aura
dashboard. It uses the native Firebase Messaging SDK for iPhone notifications
and can be built from Windows through Codemagic.

## Prerequisites

- Active Apple Developer Program membership
- App Store Connect app with bundle ID `com.aurahomesystems.app`
- Firebase iOS app with the same bundle ID
- APNs authentication key uploaded in Firebase Console
- Codemagic account connected to this GitHub repository and App Store Connect

## Firebase and APNs

1. In Apple Developer, create an APNs Auth Key with Apple Push Notifications
   enabled. Download the `.p8` file once and note its Key ID and Team ID.
2. In Firebase Console (`cleverhaus-petrov`), add an iOS app with bundle ID
   `com.aurahomesystems.app`.
3. Download `GoogleService-Info.plist`. Do not commit it publicly.
4. Firebase Console → Project settings → Cloud Messaging → Apple app
   configuration: upload the APNs `.p8` key.
5. Store `GoogleService-Info.plist` as a secure Codemagic file and copy it to
   `ios/App/App/GoogleService-Info.plist` before `npx cap sync ios`.

## Generate the native project

The first generation can run on Windows after npm dependencies are installed:

```powershell
npx cap add ios
npx cap sync ios
```

Xcode/CocoaPods compilation still runs on Codemagic macOS.

## Codemagic

1. Add the repository in Codemagic.
2. Create an App Store Connect API key in App Store Connect and add it as the
   integration named `Aura HomeSystems`.
3. Add the distribution certificate and App Store provisioning profile, or let
   Codemagic manage signing.
4. Create a protected environment group named `ios_credentials`. Add
   `GOOGLE_SERVICE_INFO_PLIST` containing the base64-encoded contents of
   `GoogleService-Info.plist`.
5. Push a tag such as `ios-v0.1.0` to start the TestFlight workflow.

## Important iOS behavior

- iOS does not permit Android-style full-screen alarm activities.
- Alerts use standard high-priority APNs notifications with sound.
- The user must grant notification permission.
- Background delivery is controlled by iOS; the app cannot bypass Focus,
  notification settings, or system delivery policies.
- Test push delivery on a physical iPhone through TestFlight, not only in the
  simulator.
