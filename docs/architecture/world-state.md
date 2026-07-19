# World State

## Purpose

World State is Jarvis's current understanding of the phone.

Primary implementation: `brain/src/worldState.ts`.

## Ownership

World State is owned by the Brain. Android publishes events; it does not own the final state representation.

## Current representation

The snapshot includes:

- current app package
- current app label
- foreground activity
- screen locked / interactive state
- battery percentage
- charging state and power source
- WiFi state
- Bluetooth state
- last clipboard text
- last notification
- last SMS
- last call
- last package change
- current semantic screen model
- update timestamp

## Update flow

```text
Android event
-> Event Bus
-> Rule Engine
-> WorldStateManager.observe(event)
-> snapshot available to Context Builder and health endpoint
```

## Why it exists

Without World State, the planner would need to replay recent events or parse raw Android data every time it thinks. World State gives the planner a stable "what is true now?" view.

## Current limitation

The state is in-memory. Durable state, replay, snapshots across process death, and conflict resolution are future work.
