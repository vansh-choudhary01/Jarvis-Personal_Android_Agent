# Capability Manager

## Purpose

Capability Manager maps planner actions to Android capabilities and permission requirements.

Primary implementation: `brain/src/capabilityManager.ts`.

## Responsibilities

- Determine whether an action is available.
- Report missing capabilities before execution.
- Keep planner code independent from Android permission details.
- Prepare for future user approval/resume flows.

## Example mapping

```text
find_and_tap -> Accessibility
type -> Accessibility
open_app -> Package/app launcher access
get_recent_calls -> Call log permission
call -> Phone/call permission
get_notifications -> Notification access
generate -> Model runtime
```

## Capability state

Today, capability checks are lightweight. The future direction is to sync live permission state from Android into the Brain so the planner can ask for missing permission through a normal event/resume flow.

## Execution routing

Capability Manager does not execute actions. It answers whether execution is allowed, then the executor bridge sends the action to Android.
