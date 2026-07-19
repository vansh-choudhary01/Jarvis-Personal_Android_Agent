# Android layer

## Purpose

The Android layer is the platform adapter. It exposes Android capabilities to the TypeScript Brain without moving business logic into Kotlin.

Primary files live under:

```text
mobile/android/app/src/main/java/com/yourname/jarvis/
```

## Foreground Service

`JarvisForegroundService.kt` owns Android-side long-running service behavior, status notification, native event publishing, and phone/Brain connection handling.

## Accessibility

`JarvisAccessibilityService.kt` provides:

- current node tree capture
- find-and-tap
- tap
- swipe
- text entry
- screen change callbacks
- overlay ownership

Accessibility is the primary observation layer because it provides structured UI data.

## Notifications

`JarvisNotificationListenerService.kt` publishes active and newly posted notifications. Notification history is only available while Jarvis has notification listener access.

## Calls and SMS

- `TelephonyModule.kt` handles call-log and telephony bridge operations.
- `SmsReceiver.kt` publishes incoming SMS events.
- `JarvisCallScreeningService.kt` supports call-screening integration.

## Battery, Bluetooth, Clipboard, WiFi

These signals are normalized as events before entering the Brain. The planner should not directly consume Android broadcast callbacks.

## Overlay

`JarvisOverlayController.kt` renders the floating J button and live task panel. The overlay is diagnostic and control UI; it should not block normal phone interaction when expanded.

## Local AI Runtime

`LocalAiRuntimeModule.kt` bridges Google AI Edge / MediaPipe local inference. The Brain calls a runtime interface; it should not contain MediaPipe-specific logic.

## Kotlin boundary

Kotlin should:

- expose Android APIs
- publish normalized events
- execute requested actions
- report results

Kotlin should not own planner logic, agent policy, task decomposition, memory policy, or plugin business logic.
