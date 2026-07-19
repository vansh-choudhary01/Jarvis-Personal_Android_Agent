# Project structure

## Top-level layout

```text
brain/       TypeScript Brain runtime and optional Node server
mobile/      React Native UI and Android Kotlin capability layer
docs/        Project documentation
```

There is currently no separate `shared/` package. Shared contracts live in `brain/src/protocol.ts` and native-facing TypeScript types live in `mobile/src/native.ts`. If the project grows, shared schemas should move into a dedicated package.

## brain/

`brain/` owns the portable business logic:

- planning
- task lifecycle
- event bus
- rule engine
- world state
- working memory
- screen observer
- context builder
- optional Node development server

Important files:

- `src/runtime.ts` - `BrainRuntime` boundary.
- `src/agent.ts` - planner/action loop.
- `src/taskManager.ts` - task lifecycle.
- `src/eventBus.ts` - normalized event intake.
- `src/worldState.ts` - current device snapshot.
- `src/workingMemory.ts` - transient task and planner state.
- `src/screenObserver.ts` - raw screen snapshot to semantic screen model.
- `src/contextBuilder.ts` - planner input construction.
- `src/capabilityManager.ts` - action-to-capability checks.
- `src/index.ts` - optional laptop HTTP/WebSocket adapter.

## mobile/

`mobile/` owns the Android app:

- React Native screens and developer UI.
- Embedded Brain host for the current phase.
- Android native modules.
- Foreground service.
- Accessibility service.
- Overlay.
- Notification/SMS/call/device bridges.
- Local AI Runtime UI and MediaPipe bridge.

Important files:

- `App.tsx` - setup, AI Runtime, developer controls, observability UI.
- `src/JarvisController.ts` - current embedded Brain host.
- `src/localAiRuntime.ts` - model registry and runtime adapter.
- `src/modelRegistry.json` - data-driven model catalog.
- `android/app/src/main/java/com/yourname/jarvis/JarvisForegroundService.kt` - Android service and native event publisher.
- `android/app/src/main/java/com/yourname/jarvis/JarvisAccessibilityService.kt` - screen tree and Accessibility actions.
- `android/app/src/main/java/com/yourname/jarvis/DeviceModule.kt` - permissions, device profile, app list, model/file helpers.

## docs/

Docs are split by purpose:

- `getting-started/` - setup and local execution.
- `architecture/` - system design and subsystem boundaries.
- `development/` - debugging, observability, testing, contributing.
- `deployment/` - debug/release build process.
- `roadmap/` - implemented, scaffolded, and planned work.
