# Context Builder

## Purpose

Context Builder prepares planner input.

Primary implementation: `brain/src/contextBuilder.ts`.

## Inputs

- user task
- world state
- working memory
- recent events

## Output

A planner context containing:

- task
- current world state
- current working memory
- relevant events
- summary

## Context selection

The current implementation uses simple relevance:

- high-priority events
- task/planner/executor events
- screen and foreground-app events
- events matching task keywords

This is intentionally small. It prevents the planner from receiving every event while preserving the important context needed for the current task.

## Future Memory integration

Long-term memory should plug into Context Builder, not directly into the planner. The intended future path is:

```text
Task
-> Context Builder
-> World State
-> Working Memory
-> Relevant Events
-> Relevant Memories
-> Planner
```

This keeps retrieval policy outside the planner prompt.
