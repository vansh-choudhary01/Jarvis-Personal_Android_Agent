import type {JarvisEvent} from './eventBus.js';

export interface MemoryCandidate {
  eventId: string;
  type: string;
  timestamp: number;
  importance: number;
  summary: string;
}

export class MemoryCore {
  private readonly candidates: MemoryCandidate[] = [];

  observe(event: JarvisEvent): void {
    const importance = estimateImportance(event);
    if (importance <= 0) return;
    this.candidates.push({
      eventId: event.id,
      type: event.type,
      timestamp: event.timestamp,
      importance,
      summary: summarizeEvent(event),
    });
    if (this.candidates.length > 300) this.candidates.splice(0, this.candidates.length - 300);
  }

  snapshot(): MemoryCandidate[] {
    return this.candidates.slice(-50);
  }
}

function estimateImportance(event: JarvisEvent): number {
  if (event.type.startsWith('task.') || event.type.startsWith('planner.') || event.type.startsWith('executor.')) return 0.4;
  if (event.type === 'notification.received' || event.type === 'sms.received' || event.type.startsWith('call.')) return 0.6;
  if (event.priority === 'critical') return 1;
  if (event.priority === 'high') return 0.7;
  return 0;
}

function summarizeEvent(event: JarvisEvent): string {
  return `${event.type} from ${event.source}`;
}
