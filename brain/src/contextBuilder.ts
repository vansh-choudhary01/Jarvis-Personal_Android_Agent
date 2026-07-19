import type {EventHistoryEntry} from './eventHistory.js';
import type {WorkingMemorySnapshot} from './workingMemory.js';
import type {WorldStateSnapshot} from './worldState.js';

export interface PlannerContext {
  task: string;
  worldState: WorldStateSnapshot;
  workingMemory: WorkingMemorySnapshot;
  relevantEvents: Array<{
    type: string;
    source: string;
    timestamp: number;
    priority: string;
    payload: Record<string, unknown>;
  }>;
  summary: string;
}

export class ContextBuilder {
  build(input: {
    task: string;
    worldState: WorldStateSnapshot;
    workingMemory: WorkingMemorySnapshot;
    recentEvents: EventHistoryEntry[];
  }): PlannerContext {
    const keywords = tokenize(input.task);
    const relevantEvents = input.recentEvents
      .filter(entry => isRelevant(entry, keywords))
      .slice(-20)
      .map(entry => ({
        type: entry.event.type,
        source: entry.event.source,
        timestamp: entry.event.timestamp,
        priority: entry.event.priority,
        payload: entry.event.payload,
      }));

    return {
      task: input.task,
      worldState: input.worldState,
      workingMemory: input.workingMemory,
      relevantEvents,
      summary: summarizeContext(input.task, input.worldState, input.workingMemory, relevantEvents),
    };
  }
}

function isRelevant(entry: EventHistoryEntry, keywords: string[]): boolean {
  if (entry.event.priority === 'high' || entry.event.priority === 'critical') return true;
  if (entry.event.type.startsWith('task.') || entry.event.type.startsWith('planner.') || entry.event.type.startsWith('executor.')) return true;
  if (entry.event.type === 'screen.state' || entry.event.type === 'foreground_app.changed') return true;
  const haystack = JSON.stringify(entry.event.payload).toLowerCase();
  return keywords.some(keyword => haystack.includes(keyword));
}

function summarizeContext(
  task: string,
  worldState: WorldStateSnapshot,
  workingMemory: WorkingMemorySnapshot,
  relevantEvents: PlannerContext['relevantEvents'],
): string {
  return [
    `task="${task}"`,
    `currentApp=${worldState.currentApp || 'unknown'}`,
    `screen=${worldState.screen?.title || worldState.currentApp || 'unknown'}`,
    `locked=${worldState.screenLocked}`,
    `workingTask=${workingMemory.currentTaskInstruction || 'none'}`,
    `events=${relevantEvents.length}`,
  ].join(' | ');
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2);
}
