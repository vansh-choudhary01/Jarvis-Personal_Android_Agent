# Planner

## Purpose

The planner selects the next action needed to complete the current task.

Primary implementation: `brain/src/agent.ts`.

## Loop

```text
Observe
-> Think
-> Plan
-> Execute
-> Observe
-> Verify
-> Retry or complete
```

## Planner input

The planner receives:

- original instruction
- current semantic screen state
- planner context
- recent relevant history
- last action result
- available action contract

It should not receive hardcoded app recipes or raw Android node trees.

## Action contract

Examples:

- `resolve_app`
- `open_app`
- `find_and_tap`
- `type`
- `swipe`
- `wait`
- `get_device_profile`
- `get_recent_calls`
- `call`
- `task_complete`
- `task_failed`

## Navigation principle

Jarvis should navigate using:

- current screen observation
- visible text
- content descriptions
- semantic screen model
- UI state
- app labels and package names from installed launcher apps

Do not special-case app flows like "if WhatsApp then tap X." If an app layout changes but exposes similar Accessibility labels, Jarvis should still work.

## Failure handling

If an action fails, the planner should observe again and choose a recovery action. It should only fail the task when the current observation shows that no valid path remains or a required capability is unavailable.
