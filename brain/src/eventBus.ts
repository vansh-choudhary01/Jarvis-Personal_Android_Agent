import type {PhoneMessage, ScreenState} from './protocol.js';
import type {ScreenModel} from './screenObserver.js';

export type JarvisEventPriority = 'low' | 'normal' | 'high' | 'critical';

// Keep event names centralized so future Android subsystems and plugins extend
// the same vocabulary instead of inventing planner-specific side channels.
export const JARVIS_EVENT_TYPES = [
  'developer.task_submitted',
  'screen.state',
  'notification.received',
  'notification.removed',
  'sms.received',
  'call.incoming',
  'call.missed',
  'call.ended',
  'battery.changed',
  'battery.low',
  'charging.started',
  'charging.stopped',
  'bluetooth.connected',
  'bluetooth.disconnected',
  'wifi.connected',
  'wifi.lost',
  'clipboard.changed',
  'package.installed',
  'package.removed',
  'screen.locked',
  'screen.unlocked',
  'wake_word.detected',
  'voice.instruction_received',
  'device.observation',
  'foreground_app.changed',
  'accessibility.ui_changed',
  'accessibility.screen_activity',
  'user.interaction',
  'task.started',
  'task.status',
  'task.completed',
  'task.failed',
  'task.blocked',
  'task.cancelled',
  'planner.requested',
  'planner.action_selected',
  'executor.action_started',
  'executor.action_result',
  'capability.check',
  'capability.unavailable',
  'memory.context_requested',
  'memory.context_returned',
  'system.error',
] as const;

export type JarvisEventType = (typeof JARVIS_EVENT_TYPES)[number];

export interface JarvisEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: JarvisEventType;
  source: string;
  timestamp: number;
  priority: JarvisEventPriority;
  payload: TPayload;
  correlationId?: string;
}

export type JarvisEventDraft<TPayload = Record<string, unknown>> = {
  type: JarvisEventType;
  source: string;
  payload?: TPayload;
  priority?: JarvisEventPriority;
  timestamp?: number;
  correlationId?: string;
};

export type EventListener = (event: JarvisEvent) => void | Promise<void>;

export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly typedListeners = new Map<JarvisEventType, Set<EventListener>>();

  publish<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    draft: JarvisEventDraft<TPayload>,
  ): JarvisEvent<TPayload> {
    const event: JarvisEvent<TPayload> = {
      id: createEventId(),
      type: draft.type,
      source: draft.source,
      timestamp: draft.timestamp ?? Date.now(),
      priority: draft.priority ?? 'normal',
      payload: (draft.payload ?? {}) as TPayload,
      correlationId: draft.correlationId,
    };

    this.notify(event);
    return event;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeTo(type: JarvisEventType, listener: EventListener): () => void {
    const listeners = this.typedListeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.typedListeners.set(type, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.typedListeners.delete(type);
    };
  }

  private notify(event: JarvisEvent): void {
    for (const listener of this.listeners) {
      Promise.resolve(listener(event)).catch(error => {
        console.warn('[brain] event listener failed:', error instanceof Error ? error.message : String(error));
      });
    }

    const typed = this.typedListeners.get(event.type);
    if (!typed) return;
    for (const listener of typed) {
      Promise.resolve(listener(event)).catch(error => {
        console.warn('[brain] typed event listener failed:', error instanceof Error ? error.message : String(error));
      });
    }
  }
}

export function normalizePhoneMessage(message: PhoneMessage, screenModel?: ScreenModel): JarvisEventDraft[] {
  if (message.type === 'screen_state') return [normalizeScreenState(message, screenModel)];

  if (message.type === 'android_event') {
    return [{
      type: message.eventType,
      source: message.source,
      timestamp: message.timestamp,
      priority: message.priority,
      payload: message.payload,
    }];
  }

  if (message.type === 'notification') {
    return [{
      type: 'notification.received',
      source: 'android.notification_listener',
      timestamp: message.timestamp,
      priority: 'normal',
      payload: {
        packageName: message.packageName,
        title: message.title,
        text: message.text,
      },
    }];
  }

  if (message.type === 'sms_received') {
    return [{
      type: 'sms.received',
      source: 'android.sms_receiver',
      timestamp: message.timestamp,
      priority: 'high',
      payload: {
        sender: message.sender,
        body: message.body,
      },
    }];
  }

  const base = {
    source: 'android.accessibility',
    timestamp: message.timestamp,
    payload: {
      kind: message.kind,
      packageName: message.packageName,
      appLabel: message.appLabel,
      className: message.className,
      eventType: message.eventType,
    },
  };

  if (message.kind === 'app_changed') {
    return [{...base, type: 'foreground_app.changed', priority: 'normal'}];
  }
  if (message.kind === 'screen_changed') {
    return [{...base, type: 'accessibility.ui_changed', priority: 'low'}];
  }
  if (message.kind === 'screen_activity') {
    return [{...base, type: 'accessibility.screen_activity', priority: 'low'}];
  }
  if (message.kind === 'user_interaction') {
    return [{...base, type: 'user.interaction', priority: 'normal'}];
  }

  return [{...base, type: 'device.observation', priority: 'low'}];
}

function normalizeScreenState(screen: ScreenState, screenModel?: ScreenModel): JarvisEventDraft {
  return {
    type: 'screen.state',
    source: 'android.accessibility',
    priority: screen.lastActionResult ? 'high' : 'normal',
    payload: {
      packageName: screen.packageName,
      nodeCount: screen.nodeTree.length,
      lastActionResult: screen.lastActionResult ?? null,
      visibleTextSignature: screen.nodeTree
        .slice(0, 40)
        .map(node => `${node.text || ''}|${node.contentDescription || ''}`)
        .join('~')
        .slice(0, 1200),
      screenModel,
    },
  };
}

let eventIdCounter = 0;

function createEventId(): string {
  eventIdCounter = (eventIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `evt-${Date.now().toString(36)}-${eventIdCounter.toString(36)}`;
}
