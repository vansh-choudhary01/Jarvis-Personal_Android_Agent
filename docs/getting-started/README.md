# Getting started

This section gets a new developer from a clean checkout to a running Jarvis development build.

## Read in order

1. [Installation](installation.md)
2. [Running locally](running-locally.md)
3. [Project structure](project-structure.md)

## Development modes

Jarvis currently supports two development modes:

- Embedded Android mode: the Android app hosts the TypeScript Brain through the React Native JavaScript runtime.
- Laptop Brain mode: the phone connects to a Node.js Brain server over USB-reversed localhost for Gemini or Anthropic testing.

Embedded mode is the target path for normal Android development. Laptop Brain mode exists to debug the same Brain runtime from a PC and to use cloud LLM providers while the local runtime is still maturing.

## Minimum successful setup

A working setup has:

- Node dependencies installed in `brain/` and `mobile/`.
- Android Studio SDK components installed.
- Metro running on port `8081`.
- A physical Android device visible through `adb devices`.
- Jarvis installed with Accessibility, notification, call/SMS, wireless, and battery permissions ready.
