# Jarvis Android app

React Native 0.86 UI plus native Kotlin services for Android 8/API 26 through Android 16/API 36.

The native `JarvisForegroundService` owns the brain WebSocket and action loop, so automation continues when Jarvis is backgrounded. React Native provides onboarding and development UI; Metro is required only for debug builds.

## Development setup

- Node.js 22.11+
- Java 21
- Android Studio
- SDK Platform 36 and Build Tools 36.0.0
- Platform Tools, CMake 3.22.1, and NDK `27.1.12297006`

Configure `src/config.ts` with the brain WebSocket URL and the same token as `brain/.env`.

```powershell
npm.cmd install
npm.cmd start
```

Then, in another terminal:

```powershell
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
cd android
.\gradlew.bat installDebug
```

Complete Accessibility, notification access, call/SMS/runtime permissions, and battery exemption in the onboarding screen.

## Native components

- `JarvisForegroundService.kt` — persistent WebSocket, reconnect, action execution, and call-log query
- `JarvisAccessibilityService.kt` — current Accessibility tree, taps, text entry, find-and-tap, and swipes
- `JarvisNotificationListenerService.kt` — active and newly posted notification forwarding
- `SmsReceiver.kt` — incoming SMS events
- `TelephonyModule.kt` — React Native call/SMS/call-log bridge
- `DeviceModule.kt` — permission checks, settings links, app launching, and foreground-service startup
- `JarvisEventBus.kt` — native status events delivered to the React Native UI

## Release note

Generate a private signing key and replace the template debug signing configuration before producing a release APK. Never distribute an APK containing a real phone token.

See the project-root `README.md` for the complete v1 setup, task API, privacy model, safety limits, and deployment notes.
