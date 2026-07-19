# Roadmap

## Phase 3: Event-driven foundation

Status: implemented foundation, still evolving.

Goals:

- Normalize Android subsystem events.
- Maintain world state.
- Build planner context from state and relevant events.
- Keep planner independent from raw Accessibility nodes.
- Avoid hardcoded app automations.

## Phase 4: Mature screen observation

Goals:

- Improve semantic screen models.
- Better identify dialogs, forms, navigation bars, tabs, lists, and selected state.
- Add robust validation across common Android apps.
- Keep Accessibility primary.

## Phase 5: Context and task reliability

Goals:

- Improve context selection.
- Improve retry/recovery.
- Add clearer action failure reasons.
- Add regression tests for planner decisions.

## Phase 6: Continuous agent loop

Goals:

- Make observe/think/plan/execute/observe loop more explicit.
- Support long-running tasks.
- Keep task progress accurate.
- Avoid UI lifecycle dependency where possible.

## Phase 7: Goal Manager

Goals:

- Separate goals from tasks.
- Track multi-step goals.
- Add pause/resume/cancel semantics.

## Phase 8: Wake word

Goals:

- WakeWordDetected event.
- Speech capture.
- Transcription.
- VoiceInstructionReceived event.
- Same planner path as typed tasks.

## Phase 9: Memory Core

Goals:

- Importance scoring.
- Deduplication.
- Embeddings.
- Durable storage.
- Retrieval through Context Builder.

## Phase 10: Vision layer

Goals:

- Screenshot understanding.
- Vision model integration.
- Merge vision observations into screen model/world state.
- Use vision only where Accessibility is weak.

## Phase 11: Autonomous behaviors

Goals:

- Event-triggered behavior policies.
- Safety gates.
- User-configurable autonomy.
- Background task execution.
