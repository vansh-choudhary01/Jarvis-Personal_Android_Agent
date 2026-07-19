# Working Memory

## Purpose

Working Memory stores transient runtime state for the current task and recent observations.

Primary implementation: `brain/src/workingMemory.ts`.

## Responsibilities

- Track current task id, instruction, and state.
- Track current foreground app and screen package.
- Keep recent accepted events.
- Expose the current task context to diagnostics.

## What belongs here

Working Memory is for short-lived state:

- current task instruction
- last planner action
- recent screen event
- recent executor result
- current waiting state

## What does not belong here

Working Memory should not become long-term memory. Facts like "met Rahul yesterday" should eventually go through Memory Core, importance scoring, deduplication, embeddings, and durable storage.

## Lifecycle

Working Memory changes as tasks and events happen. It can be cleared or reconstructed without losing durable user knowledge, once long-term memory exists.
