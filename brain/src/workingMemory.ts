import type {JarvisEvent} from './eventBus.js';

export interface WorkingMemorySnapshot {
  currentTaskId: string | null;
  currentTaskInstruction: string | null;
  currentTaskState: string | null;
  foregroundApp: string;
  foregroundAppLabel: string;
  currentScreenPackage: string;
  recentEvents: Array<{
    id: string;
    type: string;
    source: string;
    timestamp: number;
    priority: string;
    payload: Record<string, unknown>;
  }>;
}

export class WorkingMemory {
  private currentTaskId: string | null = null;
  private currentTaskInstruction: string | null = null;
  private currentTaskState: string | null = null;
  private foregroundApp = '';
  private foregroundAppLabel = '';
  private currentScreenPackage = '';
  private readonly recentEvents: JarvisEvent[] = [];

  constructor(private readonly maxRecentEvents = 80) {}

  observe(event: JarvisEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxRecentEvents);
    }

    if (event.type === 'foreground_app.changed') {
      const payload = event.payload as {packageName?: unknown; appLabel?: unknown};
      this.foregroundApp = String(payload.packageName ?? '');
      this.foregroundAppLabel = String(payload.appLabel ?? '');
    }

    if (event.type === 'screen.state') {
      const payload = event.payload as {packageName?: unknown};
      this.currentScreenPackage = String(payload.packageName ?? '');
    }

    if (event.type === 'task.started') {
      const payload = event.payload as {taskId?: unknown; instruction?: unknown};
      this.currentTaskId = String(payload.taskId ?? '');
      this.currentTaskInstruction = String(payload.instruction ?? '');
      this.currentTaskState = 'running';
    }

    if (event.type === 'task.status') {
      const payload = event.payload as {state?: unknown};
      this.currentTaskState = String(payload.state ?? this.currentTaskState ?? 'running');
    }

    if (event.type === 'task.completed' || event.type === 'task.failed' || event.type === 'task.cancelled') {
      this.currentTaskState = event.type.replace('task.', '');
      this.currentTaskId = null;
      this.currentTaskInstruction = null;
    }
  }

  snapshot(): WorkingMemorySnapshot {
    return {
      currentTaskId: this.currentTaskId,
      currentTaskInstruction: this.currentTaskInstruction,
      currentTaskState: this.currentTaskState,
      foregroundApp: this.foregroundApp,
      foregroundAppLabel: this.foregroundAppLabel,
      currentScreenPackage: this.currentScreenPackage,
      recentEvents: this.recentEvents.map(event => ({
        id: event.id,
        type: event.type,
        source: event.source,
        timestamp: event.timestamp,
        priority: event.priority,
        payload: event.payload,
      })),
    };
  }
}
