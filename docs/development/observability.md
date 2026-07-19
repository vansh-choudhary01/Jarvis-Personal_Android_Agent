# Observability

Jarvis should be inspectable while it is running. Observability exists to answer: what did Jarvis observe, what did it think, what did it do, and why?

## Surfaces

- App setup screen: permission and connection state.
- Developer mode: task input and trace cards.
- Floating overlay: live task state over other apps.
- AI Runtime screen: local model state and diagnostics.
- `/health`: Brain state, world state, recent events, planner context.
- Logs: Metro, Brain, and Android Logcat.

## Event trace

Recent events should show:

- event type
- source
- timestamp
- priority
- payload summary
- rule-engine decision

Event payloads can contain private data from screen text, notifications, SMS, or call logs. Do not paste full traces into public places.

## Model output stream

Developer UI can show local-model generation chunks. This is useful for diagnosing invalid JSON output, slow generation, or malformed planner actions.

## Task progress

Task progress should represent task progress, not safety-limit progress. Good examples:

- observing screen
- opening app
- waiting for app
- tapping visible control
- verifying result
- complete

## What to capture for bugs

For a failed task, capture:

1. instruction
2. screenshot, if it does not expose private data
3. `/health.activeTask`
4. `/health.worldState`
5. `/health.lastPlannerContext`
6. recent planner/executor/task events
7. provider/model/runtime mode

Do not include private phone numbers, messages, tokens, or API keys.
