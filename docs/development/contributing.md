# Contributing

## Core rules

- Keep business logic in TypeScript.
- Keep Kotlin as the platform capability layer.
- Do not add hardcoded app flows unless there is a documented temporary reason.
- Prefer semantic screen observation over raw node parsing in planner logic.
- Add events to the Event Bus before wiring them into planner behavior.
- Keep provider/runtime-specific code behind runtime interfaces.

## Before changing architecture

Update or read:

- [Architecture overview](../architecture/overview.md)
- [Execution flow](../architecture/execution-flow.md)
- [Current status](../roadmap/current-status.md)
- [Roadmap](../roadmap/roadmap.md)

## Adding a new Android signal

1. Publish a normalized event from Kotlin.
2. Add or reuse an event type in TypeScript.
3. Decide rule-engine behavior.
4. Update World State only if it represents current device truth.
5. Expose useful diagnostics.
6. Add docs and tests.

## Adding a planner action

1. Add schema/contract changes.
2. Map it to a capability.
3. Implement execution through the native bridge or runtime interface.
4. Publish task/planner/executor events.
5. Add manual validation instructions.

## Documentation rule

If behavior changes, update the nearest focused doc. Do not put implementation details back into the root README.
