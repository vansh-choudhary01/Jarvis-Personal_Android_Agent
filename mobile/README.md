# Jarvis Android app

React Native 0.86 UI plus native Kotlin services for Android 8/API 26 through Android 16/API 36.

The current Phase 2.2 host embeds the TypeScript Brain in the React Native JavaScript runtime. React Native still owns the UI in this phase, but the Brain logic remains TypeScript-first and is behind the `BrainRuntime + PhoneTransport + LlmRuntime` boundary so it can later move into a dedicated embedded JavaScript runtime without changing Planner, Agents, Task Manager, Protocol, or future Memory.

The native `JarvisForegroundService` runs in local mode with `local://embedded-brain`, emits screen/device events to React Native, and keeps Android-side observation/overlay capabilities alive. `JarvisOverlayController` renders the floating Jarvis bubble and task panel over other apps.

## Development setup

- Node.js 22.11+
- Java 21
- Android Studio
- SDK Platform 36 and Build Tools 36.0.0
- Platform Tools
- CMake 3.22.1
- NDK `27.1.12297006`
- A physical Android phone connected over USB

## Windows path rule: Metro uses `C:\...`, Gradle uses `X:\...`

React Native's native CMake build can fail from the original deep Codex path with:

```text
Filename longer than 260 characters
```

Metro has the opposite problem: on Windows `subst` drives, Metro's file hashing can resolve the real path internally and disagree with the `X:\...` project root. So use this split:

- Start Metro from the real `C:\...` path.
- Build/install Android from the short `X:\...` path.
- Do not start Metro from `X:\...`.
- Do not build Gradle from the deep `C:\...` path.

Create the short drive for Android builds:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
```

Yes, this means Metro and Gradle intentionally use different roots. That is the stable Windows setup for this project.

## Install dependencies

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd install
```

`npm start` and `npm run android` automatically build `../brain` first through the `prestart` and `preandroid` scripts. The Brain build emits both normal ESM output and `dist-cjs` CommonJS output. Mobile imports `brain/dist-cjs/runtime.js` for Metro compatibility.

## Run on device

Check device id:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

Start Metro:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd start -- --reset-cache --port 8081
```

In a second terminal:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
cd X:\mobile
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:Path"
npm.cmd run android -- --device ZD222TQVPK --port 8081 --no-packager
```

Replace `ZD222TQVPK` with your device id.

`--no-packager` is intentional. Metro is already running on `8081`; this avoids the React Native CLI prompt that asks to switch to `8082`.

## Metro and embedded Brain notes

`JarvisController.ts` imports the embedded Brain from:

```ts
../../brain/dist-cjs/runtime.js
```

`metro.config.js` watches `../brain`, but forces `zod` to resolve from `mobile/node_modules`:

```js
extraNodeModules: {
  zod: path.join(mobile, 'node_modules', 'zod'),
}
```

This avoids Metro loading `brain/node_modules/zod` v4 ESM files while bundling the CommonJS Brain output. Mobile intentionally uses `zod` v3 for this bundle path.

## Port cleanup

To see common dev ports:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { 3000,8081,8082,8083,19000,19001,5037 -contains $_.LocalPort } |
  ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    "PORT=$($_.LocalPort) PID=$($_.OwningProcess) NAME=$($proc.ProcessName)"
  }
```

Only stop a process if you recognize it as a stale Metro/Node/dev process.

## Clean generated Android build artifacts

If CMake/Ninja reports missing generated files such as `rules.ninja`, or if a previous build mixed roots, clean generated folders. Do not patch Gradle, `settings.gradle`, React Native internals, or autolinking first.

```powershell
cd X:\mobile\android
.\gradlew.bat --stop

Remove-Item -LiteralPath .\build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\app\build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\app\.cxx -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\.gradle -Recurse -Force -ErrorAction SilentlyContinue
```

For long generated paths that PowerShell cannot delete normally:

```powershell
[System.IO.Directory]::Delete("\\?\X:\mobile\android\app\build", $true)
[System.IO.Directory]::Delete("\\?\X:\mobile\android\app\.cxx", $true)
```

Then start Metro from the real `C:\...` path and rebuild Android from `X:\mobile`.

## App setup

Open Jarvis and complete:

1. Accessibility control
2. Notification access
3. Call, SMS, and notification runtime permissions
4. Battery exemption

When all rows are ready, Jarvis starts the embedded Brain automatically.

## Developer task input

Tap the `Jarvis` title three times to toggle Developer Mode. The Developer section includes:

- Connection status
- Permission state
- Task input
- Recent action log
- Node tree capture

Tasks are submitted directly to the embedded `BrainRuntime`; they do not go through `localhost:3000`.

## AI Runtime screen

The AI Runtime tab includes:

- Device information
- Recommended local runtime/model
- Installed models
- Import local `.task` / `.litertlm` model
- Download/import status
- Delete model
- Active model switch
- Storage usage
- Offline test
- Developer diagnostics

Models are stored in app-private Android storage. The runtime expects Google AI Edge / MediaPipe-compatible `.task` or `.litertlm` models, not GGUF, Ollama, or safetensors files.

## Native components

- `JarvisForegroundService.kt` — local-mode foreground service, device observation events, screen state events.
- `JarvisAccessibilityService.kt` — current Accessibility tree, taps, text entry, find-and-tap, swipes; creates and owns the overlay.
- `JarvisOverlayController.kt` — floating J bubble and task/status/progress panel.
- `JarvisNotificationListenerService.kt` — active and newly posted notification forwarding.
- `SmsReceiver.kt` — incoming SMS events.
- `TelephonyModule.kt` — React Native call/SMS/call-log bridge.
- `DeviceModule.kt` — permission checks, settings links, app launching, app listing, foreground-service startup.
- `JarvisEventBus.kt` — native status/events delivered to the React Native UI.

## Android 16 / package visibility notes

Android 16 enforces strict package visibility. The manifest declares package/intents needed for visible app queries and browser opening. When a package has no launch intent, Jarvis can fall back to Android intents where supported.

## Release note

Generate a private signing key and replace debug signing before producing a release APK. Never distribute an APK containing private keys, model download credentials, or development tokens.

See the project-root `README.md` for the full project architecture, local AI runtime notes, privacy model, and implementation map.
