# Debugging

## Health endpoint

In laptop Brain mode:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
```

Useful fields:

- `provider`
- `model`
- `phoneConnected`
- `activeTask`
- `workingMemory`
- `worldState`
- `lastPlannerContext`
- `recentEvents`
- `memoryCandidates`
- `goals`

## Metro

Check Metro:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8081/status
```

Metro must run from the real `C:\...` project path. If the app shows "Unable to load script", verify:

```powershell
adb reverse tcp:8081 tcp:8081
```

## Brain logs

Laptop Brain logs are printed by `brain/src/index.ts`. If running through redirected background processes, inspect the chosen `.out.log` and `.err.log` files.

## Android logs

Use filtered Logcat:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat | Select-String -Pattern "Jarvis|ReactNativeJS|AndroidRuntime"
```

## Overlay

The floating overlay shows:

- active task
- status text
- progress
- completion/failure state

If the overlay blocks touches, treat it as a UI bug. The overlay should remain draggable and should not prevent normal phone interaction.

## Planner context

Use `/health.lastPlannerContext` to see what the planner received. It should contain semantic state from Context Builder, not raw Android implementation details.

## World State

Use `/health.worldState` to verify current app, screen title, battery, charging, WiFi, Bluetooth, clipboard, notifications, SMS/call snapshots, and current screen model.

## Accessibility

If screen observation is wrong:

1. Confirm Accessibility is enabled for "Jarvis device control".
2. Confirm `/health.worldState.screen` updates when changing apps.
3. Inspect `screen.state` events in recent events.
4. Confirm the target app exposes useful Accessibility labels.

Jarvis cannot read `FLAG_SECURE` screens, unlock the phone, enter a PIN, or approve biometric prompts.
