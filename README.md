# Jarvis v1

Jarvis is a personal, sideload-only Android agent for a device you own. A Node.js brain asks Claude for one validated action at a time; a native Android foreground service executes the action and returns a fresh Accessibility tree.

## What v1 can do

- Open installed apps, tap visible text or coordinates, type, swipe, and wait.
- Continue multi-step tasks while another app is in the foreground.
- Read the recent Android call log and distinguish incoming, outgoing, and missed calls.
- Use captured WhatsApp/WhatsApp Business notifications for recent-message questions.
- Relay notifications and incoming SMS as passive events.
- Start a phone call when the instruction explicitly requests it.
- Stop safely after three identical actions or 20 total actions.
- Append an audit trail to `brain/logs/actions.jsonl`.

Jarvis cannot unlock the phone, enter a PIN, approve biometrics, read `FLAG_SECURE` screens, or reliably control apps that expose no Accessibility nodes.

## Architecture

```text
PowerShell / API client
        |
        | POST /task
        v
Node + TypeScript brain (port 3000)
        |
        | Anthropic Messages API
        | WebSocket /phone?token=...
        v
Native Android foreground service
        |
        +-- Accessibility service: screen tree and gestures
        +-- Notification listener: WhatsApp and other notifications
        +-- Call log / SMS / telephony integrations
```

The WebSocket and action loop run natively in `JarvisForegroundService.kt`. They do not depend on the React Native screen remaining visible. Metro is only the JavaScript development server for debug builds.

## Requirements

- Windows, macOS, or Linux for the brain
- Node.js 22+
- An Anthropic API key or a Google Gemini API key
- Java 21
- Android Studio and Android SDK Platform 36
- Android Build Tools 36.0.0, Platform Tools, CMake 3.22.1, and NDK `27.1.12297006`
- Android 8/API 26 or newer; a physical phone is recommended

## 1. Configure and run the brain

```powershell
cd brain
Copy-Item .env.example .env
npm.cmd install
npm.cmd run build
npm.cmd start
```

Set these values in `brain/.env`:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-sonnet-4-6
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash
PHONE_AUTH_TOKEN=generate-a-long-random-secret
PORT=3000
```

Choose the active model provider with `AI_PROVIDER`:

```env
# Claude
AI_PROVIDER=anthropic

# Gemini
AI_PROVIDER=gemini
```

Only the API key for the selected provider is required. Provider keys stay in the server-side `.env` and are never placed in the Android app. `/health` reports the active `provider` and `model`.

Never commit `.env`. The brain exposes:

- `GET /health` — connection and active-task status
- `POST /task` — submit one instruction
- `GET /phone` — authenticated WebSocket upgrade used by Android

Health check:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## 2. Configure the Android app

Edit `mobile/src/config.ts`. The token must exactly match `PHONE_AUTH_TOKEN`.

For a physical phone connected over USB:

```ts
export const JARVIS_CONFIG = {
  brainWebSocketUrl: 'ws://127.0.0.1:3000/phone',
  phoneAuthToken: 'the-same-long-token-as-the-brain',
};
```

Forward the development ports:

```powershell
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
```

For an emulator, use `ws://10.0.2.2:3000/phone`. For use without USB, deploy the brain behind TLS and use a reachable `wss://` URL.

## 3. Build and install Android

```powershell
cd mobile
npm.cmd install
npm.cmd start
```

In another terminal:

```powershell
cd mobile\android
.\gradlew.bat installDebug
```

Long Windows paths can break React Native's C++ build. Map the project to a short drive when necessary:

```powershell
subst J: "C:\path\to\jarvis"
cd J:\mobile\android
.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
```

## 4. Grant one-time phone permissions

Open Jarvis and complete all four rows:

1. Accessibility control
2. Notification access
3. Call, SMS, and notification runtime permissions
4. Unrestricted/not-optimized battery usage

The app connects automatically when every row is ready. Android displays an ongoing **Jarvis is running** notification.

## 5. Submit instructions

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/task" `
  -Headers @{
    Authorization = "Bearer YOUR_PHONE_AUTH_TOKEN"
    "Content-Type" = "application/json"
  } `
  -Body (@{
    instruction = "Open Settings and tell me the Android version"
  } | ConvertTo-Json)
```

The response `status: accepted` means the task started, not that it finished. Watch the Jarvis connection card or `brain/logs/actions.jsonl` for `task_finished`.

Example instructions:

```text
Open Calculator and calculate 125 multiplied by 8.
Tell me who recently called me. Use the recent call log.
Tell me who recently messaged me on WhatsApp or called me. Use notification history and the recent call log; do not open WhatsApp unless necessary.
```

WhatsApp history is notification-based: Jarvis can report notifications captured while its notification listener was active. It does not read WhatsApp's private database.

## Privacy and safety

Jarvis sends task text, recent action history, relevant passive phone events, and the current Accessibility tree to whichever AI provider you select: Anthropic or Google Gemini. This data can contain private screen text, contact names, phone numbers, and notification content. Screenshots are sent only if the phone supplies one.

- Use only on a phone you own and control.
- Protect the API key, phone token, TLS keys, logs, and server.
- Do not expose the plaintext brain directly to the internet.
- Review instructions that could call, message, purchase, delete, or disclose data.
- This permission set is not intended for Play Store distribution.

## Deployment

The included `brain/deploy/jarvis-brain.service` expects the built brain at `/opt/jarvis/brain` and environment values in `/opt/jarvis/brain/.env`. Put Nginx, Caddy, or an AWS load balancer in front of it for TLS, then configure the phone with the resulting `wss://` endpoint.

## v1 implementation map

- `brain/src/index.ts` — HTTP and WebSocket server
- `brain/src/taskManager.ts` — task lifecycle, passive-event context, and loop guards
- `brain/src/agent.ts` — Claude prompt and one-action decision loop
- `mobile/android/.../JarvisForegroundService.kt` — native connection and background action execution
- `mobile/android/.../JarvisAccessibilityService.kt` — node-tree capture and gestures
- `mobile/android/.../JarvisNotificationListenerService.kt` — notification forwarding
- `mobile/android/.../TelephonyModule.kt` — call, SMS, and call-log bridge
- `mobile/App.tsx` — permission onboarding and connection status
