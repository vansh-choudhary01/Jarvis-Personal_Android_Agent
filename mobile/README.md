# Jarvis mobile app

This package contains the React Native UI and Android Kotlin capability layer for Jarvis.

React Native currently hosts the embedded TypeScript Brain, but the long-term boundary is clear: React Native should be UI/status/control surface, the Brain should remain TypeScript, and Kotlin should remain the Android platform adapter.

## Important docs

- [Install prerequisites](../docs/getting-started/installation.md)
- [Run locally on Android](../docs/getting-started/running-locally.md)
- [Android layer architecture](../docs/architecture/android-layer.md)
- [Debugging](../docs/development/debugging.md)
- [Testing](../docs/development/testing.md)
- [Build](../docs/deployment/build.md)

## Package responsibilities

- `App.tsx` renders setup, AI Runtime, developer tools, task input, and observability UI.
- `src/JarvisController.ts` hosts the current embedded Brain runtime and bridges UI/native events.
- `src/localAiRuntime.ts` owns local model registry, recommendation, model manager, and MediaPipe runtime adapter.
- `src/native.ts` defines React Native native-module types.
- `android/app/src/main/java/com/yourname/jarvis/` contains the Kotlin foreground service, Accessibility service, notification listener, telephony/SMS bridges, overlay, and device helpers.

## Windows development rule

Use the split documented in [running locally](../docs/getting-started/running-locally.md):

- Metro runs from the real `C:\...` project path.
- Gradle/CMake builds run from a short `subst` path such as `X:\mobile`.

Do not patch Gradle, React Native internals, autolinking, or `settings.gradle` to work around mixed-root build symptoms until the build/start pipeline has been checked.
