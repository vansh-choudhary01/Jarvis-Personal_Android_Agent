# Future features

## Dedicated Brain Runtime

Move the TypeScript Brain out of the React Native UI runtime into a long-lived embedded JavaScript runtime owned by Android foreground service.

Candidates to evaluate:

- embedded Node.js
- QuickJS
- Hermes outside RN
- V8/Javet

This is a future architecture phase, not part of the current documentation iteration.

## Wake word and voice

Wake word should produce events:

```text
WakeWordDetected
-> SpeechCaptured
-> TranscriptionCompleted
-> VoiceInstructionReceived
-> same planner path as typed tasks
```

## Memory Core

Memory should subscribe to events, score importance, deduplicate, embed, store, and later retrieve through Context Builder.

The planner should not scan memory directly.

## Vision

Vision should supplement Accessibility for:

- games
- canvas UIs
- maps
- image-only controls
- custom rendered views

Accessibility remains primary because it is structured, deterministic, and cheaper.

## Plugins

Future plugins may include:

- Calendar
- Email
- Browser
- GitHub
- PC Companion
- Smart Home
- Wearables
- Car Integration

Plugins should publish events, register capabilities, and expose actions through stable contracts. They should not patch planner prompts directly.

## Autonomous behaviors

Autonomous behavior requires:

- explicit user policy
- event triggers
- safety gates
- reversible action design
- clear logs
- pause/stop controls

Examples:

- battery low -> suggest or enable battery saver
- car Bluetooth connected -> driving mode
- meeting soon -> open notes or meeting app
