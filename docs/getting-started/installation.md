# Installation

## Prerequisites

Install these before building Jarvis:

- Windows PowerShell
- Node.js 22 or newer
- Java 21
- Android Studio
- Android SDK Platform 36
- Android SDK Build Tools 36.0.0
- Android SDK Platform Tools
- Android SDK Command-line Tools
- Android Emulator, if using an emulator
- CMake 3.22.1
- NDK side by side `27.1.12297006`
- A physical Android phone for realistic testing

Android 8/API 26 is the minimum app target. Current testing has focused on a physical Android 16/API 36 device.

## Android Studio setup

Use Android Studio's setup wizard with the standard installation. Then open SDK Manager and verify:

- SDK Platforms: Android 16 / API 36
- SDK Tools:
  - Android SDK Build-Tools 36
  - Android SDK Platform-Tools
  - Android SDK Command-line Tools
  - Android Emulator
  - CMake
  - NDK side by side `27.1.12297006`

## Install dependencies

From the real project path:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\brain"
npm.cmd install

cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd install
```

The mobile package runs the Brain build automatically before `npm start` and `npm run android`.

## Environment variables

For laptop Brain mode, create `brain/.env` from the example and choose a provider:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

or:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

For embedded local mode, cloud provider variables are optional unless you are explicitly using the laptop Brain adapter.

## Android permissions

After installing the app, complete the setup rows in Jarvis:

1. Accessibility control
2. Notification access
3. Call, SMS, phone-state, calling, and notification runtime permissions
4. Wireless event router readiness
5. Battery exemption

Jarvis cannot force-enable Accessibility through `adb` in normal development. The user must approve it in Android settings.
