# Jarvis

Jarvis is a sideload-only Android personal AI agent for a phone you own. The current app runs the TypeScript Brain inside the Android debug app through the React Native JavaScript runtime, while Kotlin provides Android capabilities such as Accessibility, notifications, calls, SMS, foreground service, overlays, files, and MediaPipe local inference.

The laptop Node server is no longer required for normal Android use. It remains as a development adapter for testing the same Brain runtime from a PC.

## Current architecture

For the detailed event-driven architecture audit, readiness scores, validation matrix, and known debt, see [docs/ARCHITECTURE_VALIDATION.md](docs/ARCHITECTURE_VALIDATION.md).

```text
Jarvis APK
├─ React Native UI
│  └─ setup, runtime screen, logs, developer controls
├─ Embedded TypeScript Brain
│  ├─ Planner
│  ├─ Agent loop
│  ├─ Task Manager
│  └─ Protocol
└─ Kotlin native bridge
   ├─ Foreground service
   ├─ Accessibility actions and screen tree
   ├─ Notifications, calls, SMS
   ├─ Floating overlay
   └─ Google AI Edge / MediaPipe local model runtime
```

Important boundary: Planner, Agents, Task Manager, Protocol, and future Memory stay in TypeScript. Kotlin stays a thin platform layer. The Brain calls one runtime interface; it does not know whether the model is MediaPipe, cloud, or a future runtime.

## Phase 3 direction: Android Personal AI Operating Layer

Jarvis is being refactored from command-only automation toward an event-driven Android AI operating layer:

```text
Android callbacks
↓
Kotlin capability layer
↓
React Native / native bridge
↓
TypeScript Event Bus
↓
Rule Engine
↓
Working Memory / future Long-Term Memory
↓
Planner + Task Manager
↓
Executor
↓
Android capability layer
```

The planner should not receive raw Android callbacks. Android signals are normalized into events first. The TypeScript Brain now has these foundation modules:

- `brain/src/eventBus.ts` — centralized event bus and Android phone-message normalization.
- `brain/src/ruleEngine.ts` — lightweight filtering before waking planner work.
- `brain/src/workingMemory.ts` — transient current-task/current-screen/recent-event state.
- `brain/src/eventHistory.ts` — chronological searchable event log foundation.
- `brain/src/capabilityManager.ts` — maps planner actions to Android capabilities and future permission requests.

Current implementation is intentionally incremental. Existing typed/developer tasks still work through the current `TaskManager`, but task submission, phone messages, planner requests, selected actions, capability checks, executor starts/results, and task completion/failure now publish Brain events.

Future sources such as wake word, calendar, Bluetooth, Wi-Fi, clipboard, package changes, scheduled automations, and plugins should publish events without modifying planner logic. Voice is only one event source: wake word should publish a wake event, speech recognition should publish an instruction event, and the planner should treat spoken tasks the same as typed developer tasks.

## What works now

- Run the Brain locally inside the Android app.
- Start the native foreground service in local mode with `local://embedded-brain`.
- Observe screen state and device events from the native layer.
- Execute Android actions through Accessibility: tap, type, swipe, find-and-tap, open apps, wait.
- List installed launchable apps.
- Read recent call log entries.
- Relay notifications and incoming SMS as passive events.
- Show a floating Jarvis overlay with task/status/progress.
- Manage local AI models from the AI Runtime screen.
- Import `.task` / `.litertlm` models through Android's document picker.
- Load and test local models through the MediaPipe runtime bridge.
- Run an offline local-model test from the app.
- Normalize Brain-side phone/task/action signals through the TypeScript Event Bus.
- Record rule-engine decisions and working-memory state inside the Brain runtime.

Jarvis cannot unlock the phone, enter a PIN, approve biometrics, read `FLAG_SECURE` screens, or reliably control apps that expose no useful Accessibility nodes.

## Requirements

- Windows PowerShell
- Node.js 22+
- Java 21
- Android Studio
- Android SDK Platform 36
- Android Build Tools 36.0.0
- Android SDK Platform Tools
- CMake 3.22.1
- NDK `27.1.12297006`
- Android 8/API 26 or newer
- A physical phone is recommended

## Important Windows rule: split Metro and Gradle paths

React Native's native CMake build can fail on Windows when the repo path is too long:

```text
Filename longer than 260 characters
```

But Metro can fail on Windows `subst` drives because its file hashing can resolve the real path internally while the project root says `X:\...`. The reliable setup is:

- Start Metro from the real `C:\...` path.
- Run Android/Gradle build commands from the short `X:\...` path.
- Do not start Metro from `X:\...`.
- Do not run Gradle from the deep `C:\...` path.

Create the short drive once per terminal session:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
```

This split is intentional: Metro gets the real path it expects, while Gradle/CMake gets the short path it needs.

## First-time install

Install dependencies from the real repo path:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd install
```

The mobile package scripts automatically build the TypeScript Brain before starting Metro or Android. The Brain build emits both ESM and CommonJS output:

```json
"prestart": "cd ../brain && npm run build",
"preandroid": "cd ../brain && npm run build"
```

Mobile imports the CommonJS Brain output from `brain/dist-cjs` so Metro can bundle it cleanly.

## Run on a connected phone

1. Check and free the usual dev ports if needed:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { 3000,8081,8082,8083,19000,19001,5037 -contains $_.LocalPort } |
  Select-Object LocalPort, OwningProcess
```

2. Start Metro on `8081` from the real path, not from `X:\...`:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\mobile"
npm.cmd start -- --reset-cache --port 8081
```

3. In a second terminal, build and install from the short path using the already-running Metro server:

```powershell
subst X: /D 2>$null
subst X: "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis"
cd X:\mobile
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:Path"
npm.cmd run android -- --device ZD222TQVPK --port 8081 --no-packager
```

Replace `ZD222TQVPK` with your device id from:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

Why `--no-packager`: Metro is already running on `8081`. Without this flag, React Native may ask to switch to `8082`, which can recreate confusing dev-server behavior.

Why Metro uses `C:\...`: this avoids the Windows `subst` drive SHA-1/file-hasher issue.

Why Android uses `X:\...`: this avoids the CMake/Ninja 260-character path limit.

## Metro and Brain bundling notes

`mobile/metro.config.js` intentionally watches `../brain` but resolves `zod` from `mobile/node_modules`:

```js
extraNodeModules: {
  zod: path.join(mobile, 'node_modules', 'zod'),
}
```

This prevents Metro from loading `brain/node_modules/zod` v4 ESM syntax while bundling `brain/dist-cjs/protocol.js`. Mobile uses `zod` v3 CommonJS for the embedded Brain bundle.

## If the Android build gets stuck or CMake looks corrupted

Do not patch Gradle, `settings.gradle`, React Native internals, or autolinking first. Clean generated artifacts and rebuild from `X:\mobile`:

```powershell
cd X:\mobile\android
.\gradlew.bat --stop

Remove-Item -LiteralPath .\build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\app\build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\app\.cxx -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\.gradle -Recurse -Force -ErrorAction SilentlyContinue
```

If Windows refuses to delete long generated paths, use the long-path prefix from PowerShell:

```powershell
[System.IO.Directory]::Delete("\\?\X:\mobile\android\app\build", $true)
[System.IO.Directory]::Delete("\\?\X:\mobile\android\app\.cxx", $true)
```

Then start Metro from the real `C:\...` path and run Android again from `X:\mobile`.

## Phone permissions

Open Jarvis and complete each setup row:

1. Accessibility control
2. Notification access
3. Call, SMS, and notification runtime permissions
4. Unrestricted/not-optimized battery usage

The app starts the embedded Brain automatically when every permission is ready. Android shows an ongoing Jarvis foreground-service notification.

## Sending tasks

The current development UI has a hidden Developer screen:

1. Open Jarvis.
2. Tap the `Jarvis` title three times.
3. Use the Developer task input.

Example tasks:

```text
Open Settings and tell me the Android version.
Tell me who recently called me.
Tell me who recently messaged me on WhatsApp or called me.
Open Calculator and calculate 125 multiplied by 8.
```

WhatsApp history is notification-based. Jarvis can report notifications captured while its notification listener was active; it does not read WhatsApp's private database.

## Switching between embedded local mode and laptop/cloud dev mode

Jarvis has two development run modes:

- Embedded/local mode: the Android app runs the TypeScript Brain through the React Native runtime and calls the on-device local model runtime.
- Laptop/cloud dev mode: the Android foreground service connects to the Node Brain on `localhost:3000`; the Node Brain chooses Gemini or Anthropic from `brain/.env`.

For embedded/local mode, set `mobile/src/config.ts` to:

```ts
brainWebSocketUrl: 'local://embedded-brain',
phoneAuthToken: '',
```

For Gemini or Anthropic through the laptop Brain, set `mobile/src/config.ts` to:

```ts
brainWebSocketUrl: 'ws://127.0.0.1:3000/phone',
phoneAuthToken: 'jarvis-local-emulator-dev-token-2026',
```

Then start the laptop Brain from `brain`:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-07-11\files-mentioned-by-the-user-build\outputs\jarvis\brain"
npm.cmd install
npm.cmd run build
npm.cmd start
```

Configure the provider in `brain/.env`:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

or:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

For a USB-connected physical phone, reverse both ports before opening the app:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s ZD222TQVPK reverse tcp:3000 tcp:3000
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s ZD222TQVPK reverse tcp:8081 tcp:8081
```

Replace `ZD222TQVPK` with your device id. If the app shows `fetch failed` in laptop/cloud dev mode, first check that `GET http://localhost:3000/health` reports the selected provider and `phoneConnected: true`, then restart the Node Brain with network access enabled.

## Local AI Runtime

Open the `AI Runtime` tab in the app to:

- View device information.
- See the recommended local model.
- Import a `.task` or `.litertlm` model.
- Download supported models when a direct URL is available.
- Open a license page when a model is gated.
- Mark a model active.
- Delete installed models.
- View storage usage.
- Run an offline test.
- See diagnostics in Developer Mode.

Model files are stored in Jarvis private app storage. Deleting a model from Jarvis should reclaim that storage.

Supported runtime direction:

```text
ModelRuntime
└─ MediaPipeRuntime
   └─ Google AI Edge / MediaPipe LLM native bridge
```

Do not use GGUF, Ollama models, or Hugging Face safetensors for this runtime. Jarvis expects MediaPipe/LiteRT-compatible `.task` or `.litertlm` files.

## Optional laptop Brain server

The Node server is still available for development/testing:

```powershell
cd brain
Copy-Item .env.example .env
npm.cmd install
npm.cmd run build
npm.cmd start
```

Useful endpoints in that dev adapter:

- `GET /health`
- `POST /task`
- `GET /phone`

Normal Android operation should use the embedded Brain through `mobile/src/JarvisController.ts`, not the laptop server.

## Implementation map

- `brain/src/eventBus.ts` — normalized Brain event bus and phone-message event conversion.
- `brain/src/ruleEngine.ts` — modular pre-planner filtering for noisy/duplicate events.
- `brain/src/workingMemory.ts` — transient current task, current screen, foreground app, and recent events.
- `brain/src/eventHistory.ts` — chronological event history foundation for summaries/retrieval.
- `brain/src/capabilityManager.ts` — action-to-capability abstraction for future permission negotiation/resume.

- `brain/src/runtime.ts` — portable `BrainRuntime` boundary.
- `brain/src/agent.ts` — planner/agent action loop using the LLM runtime abstraction.
- `brain/src/taskManager.ts` — task lifecycle and phone transport integration.
- `brain/src/protocol.ts` — Zod schemas for phone messages and actions.
- `brain/src/llmRuntime.ts` — cloud LLM adapter for the optional Node server.
- `brain/src/phoneTransport.ts` — reusable phone transport interface.
- `brain/src/logger.ts` — portable log sink.
- `brain/src/nodeLogger.ts` — Node-only file logger for dev server logs.
- `brain/src/index.ts` — optional laptop HTTP/WebSocket adapter.
- `brain/tsconfig.cjs.json` — CommonJS Brain build used by Metro.
- `mobile/src/JarvisController.ts` — current embedded Brain host in React Native.
- `mobile/src/localAiRuntime.ts` — model registry, recommendation, model manager, MediaPipe runtime adapter.
- `mobile/src/modelRegistry.json` — data-driven local model registry.
- `mobile/src/native.ts` — React Native native-module types.
- `mobile/android/app/src/main/java/com/yourname/jarvis/JarvisForegroundService.kt` — local-mode foreground service and native event bridge.
- `mobile/android/app/src/main/java/com/yourname/jarvis/DeviceModule.kt` — Android permissions, app list, model/file/device bridge helpers.
- `mobile/android/app/src/main/java/com/yourname/jarvis/JarvisAccessibilityService.kt` — screen tree and gestures.
- `mobile/android/app/src/main/java/com/yourname/jarvis/JarvisOverlayController.kt` — floating task overlay.
- `mobile/App.tsx` — setup UI, AI Runtime UI, developer controls.

## Privacy and safety

Jarvis observes screen text through Accessibility, notifications, SMS events, and call-log data on a phone you control. Local-model inference stays on device. If you use the optional Node/cloud adapter, task context may be sent to the selected provider.

- Use only on a phone you own and control.
- Protect model files, logs, tokens, and API keys.
- Do not expose the optional development server directly to the internet.
- Review instructions that could call, message, purchase, delete, or disclose data.
- This permission set is not intended for Play Store distribution.
