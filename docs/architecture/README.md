# Architecture

Jarvis is moving toward an event-driven Android personal AI architecture. Android subsystems publish normalized events, the Brain maintains world state, and the planner operates from semantic context instead of raw platform callbacks.

## Read in order

1. [Overview](overview.md)
2. [Execution flow](execution-flow.md)
3. [Event Bus](event-bus.md)
4. [World State](world-state.md)
5. [Working Memory](working-memory.md)
6. [Screen Observer](screen-observer.md)
7. [Context Builder](context-builder.md)
8. [Planner](planner.md)
9. [Capability Manager](capability-manager.md)
10. [Android Layer](android-layer.md)

## Boundary rule

The planner should not know whether data came from Accessibility, notifications, SMS, calls, local models, cloud models, or future plugins. Those details belong behind event, state, context, runtime, and capability interfaces.
