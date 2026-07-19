# Testing

## Test levels

Jarvis currently relies on:

- TypeScript checks.
- Android debug builds.
- Real-device manual tests.
- Health endpoint inspection.
- Screenshot verification.
- Planner trace review.

## TypeScript checks

```powershell
cd brain
npx.cmd tsc --noEmit

cd ..\mobile
npx.cmd tsc --noEmit
```

## Android build check

Build from the short path:

```powershell
cd X:\mobile\android
.\gradlew.bat --no-daemon :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
```

## Device readiness test

Expected:

- App opens.
- All permission rows show Ready.
- Connection shows connected.
- `/health.phoneConnected` is true in laptop Brain mode.
- World state changes when switching apps.

## Event validation

Open several apps and verify recent events include:

- `foreground_app.changed`
- `screen.state`
- `accessibility.ui_changed`
- `notification.received`, when a notification arrives
- battery/WiFi/charging events, when state changes

Planner does not need to run for passive event validation.

## World State validation

Open different apps and verify:

- `worldState.currentApp`
- `worldState.currentAppLabel`
- `worldState.screen.title`
- `worldState.screen.summary`

## Screen Observer validation

Open Settings, Jarvis, a browser, and a messaging app. Verify screen models contain useful semantic data:

- title
- buttons
- text fields
- visible text
- scrollable state

The planner should not depend on raw node-tree parsing.

## Planner validation

Use simple tasks first:

- Open Settings
- Open Calculator
- Tap 7
- Check my device Android version

Expected loop:

```text
observe -> plan -> execute -> observe -> verify -> complete
```

## Failure validation

Test an app or action that is unavailable. Expected result:

- clear task failure
- no fake completion
- no hardcoded package guess
- recent events explain the missing capability or unresolved app

## Current validation record

The last architecture validation report lives in [architecture-validation.md](architecture-validation.md).
