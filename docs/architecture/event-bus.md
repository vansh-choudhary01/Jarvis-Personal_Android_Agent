# Event Bus

## Purpose

The Event Bus is the normalized intake layer for Jarvis. It receives Android, Brain, planner, task, and executor events and gives downstream systems one consistent event stream.

Primary implementation: `brain/src/eventBus.ts`.

## Responsibilities

- Define supported event names.
- Normalize phone messages into Brain events.
- Run rule-engine decisions.
- Update world state, working memory, event history, and memory candidates.
- Expose recent events through diagnostics.

## Inputs

Examples:

- Accessibility screen changes.
- Foreground app changes.
- Notifications.
- SMS.
- Calls.
- Battery, charging, WiFi, Bluetooth, clipboard, package changes.
- Task submitted/running/completed/failed.
- Planner requested/action selected.
- Executor action started/result.

## Outputs

- Allowed/suppressed event decisions.
- Updated world state.
- Updated working memory.
- Event history entries.
- Optional planner wake signals.

## Lifecycle

```text
event received
-> validate event name
-> rule engine decision
-> update state/history if allowed
-> expose to context builder and diagnostics
```

## Example events

```json
{
  "type": "foreground_app.changed",
  "source": "android.accessibility",
  "priority": "normal",
  "payload": {
    "packageName": "com.android.settings",
    "appLabel": "Settings"
  }
}
```

```json
{
  "type": "screen.state",
  "source": "android.accessibility",
  "priority": "normal",
  "payload": {
    "packageName": "com.android.settings",
    "screenModel": {
      "title": "Settings",
      "buttons": [],
      "scrollable": true
    }
  }
}
```

## Rule Engine

The Rule Engine is the first policy layer after event intake. It is intentionally lightweight today.

Responsibilities:

- Filter noisy events.
- Suppress duplicates.
- Decide whether an event should wake planner work.
- Record the reason for the decision.

The rule engine should not execute actions. It only decides how events enter the Brain's state pipeline.
