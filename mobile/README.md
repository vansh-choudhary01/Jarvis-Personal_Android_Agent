# Jarvis Android app

React Native 0.86 UI plus native Kotlin services for Android 8/API 26 through Android 16/API 36.

The native `JarvisForegroundService` owns the brain WebSocket and action loop, so automation continues when Jarvis is backgrounded. `JarvisOverlayController` renders a floating bubble over any app showing the live task instruction, status text, and progress bar. React Native provides onboarding and development UI; Metro is required only for debug builds.

## Development setup

- Node.js 22.11+
- Java 21
- Android Studio
- SDK Platform 36 and Build Tools 36.0.0
- Platform Tools, CMake 3.22.1, and NDK `27.1.12297006`

Configure `src/config.ts` with the brain WebSocket URL and the same token as `brain/.env`.

Map to a short drive to avoid Windows path-length issues, then build:

```powershell
subst J: "C:\path\to\jarvis"
cd J:\mobile\android
.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Start Metro in a separate terminal (required for debug builds):

```powershell
cd J:\mobile
npm.cmd install
npm.cmd start
```

Set ADB port forwarding each session after connecting the phone:

```powershell
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
```

Complete Accessibility, notification access, call/SMS/runtime permissions, and battery exemption in the onboarding screen.

## Native components

- `JarvisForegroundService.kt` — persistent WebSocket, reconnect, action execution (`list_apps` via `getInstalledPackages`, `open_app` with `ACTION_VIEW` fallback for Chrome, gestures, calls, call-log query)
- `JarvisAccessibilityService.kt` — current Accessibility tree, taps, text entry, find-and-tap, swipes; creates and owns the overlay
- `JarvisOverlayController.kt` — floating J bubble draggable over any app; tap to expand a panel showing task instruction, status, and progress bar; position persisted in SharedPreferences
- `JarvisNotificationListenerService.kt` — active and newly posted notification forwarding
- `SmsReceiver.kt` — incoming SMS events
- `TelephonyModule.kt` — React Native call/SMS/call-log bridge
- `DeviceModule.kt` — permission checks, settings links, app launching, and foreground-service startup
- `JarvisEventBus.kt` — native status events delivered to the React Native UI

## Android 16 / package visibility notes

Android 16 enforces strict package visibility. The manifest declares `<queries>` for `com.android.chrome` and an `<intent>` for `ACTION_VIEW https://` so Chrome appears in `getInstalledPackages`. `getLaunchIntentForPackage` returns null for Chrome on Android 16; the foreground service falls back to `Intent(ACTION_VIEW, Uri.parse("https://"))` with the package set explicitly.

## Release note

Generate a private signing key and replace the template debug signing configuration before producing a release APK. Never distribute an APK containing a real phone token.

See the project-root `README.md` for the complete v1 setup, task API, privacy model, safety limits, and deployment notes.
