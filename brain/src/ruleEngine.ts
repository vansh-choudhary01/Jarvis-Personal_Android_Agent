import type {JarvisEvent} from './eventBus.js';

export interface RuleDecision {
  eventId: string;
  eventType: JarvisEvent['type'];
  action: 'allow' | 'suppress';
  wakePlanner: boolean;
  reason: string;
  timestamp: number;
}

type Rule = (event: JarvisEvent) => RuleDecision | null;

export class RuleEngine {
  private readonly rules: Rule[] = [
    event => this.ignoreDuplicateNotification(event),
    event => this.ignoreTinyRepeatedScreenState(event),
    event => this.ignoreNoisyScreenActivity(event),
  ];
  private readonly recentSignatures = new Map<string, number>();
  private lastScreenSignature = '';
  private lastScreenAt = 0;

  decide(event: JarvisEvent): RuleDecision {
    for (const rule of this.rules) {
      const decision = rule(event);
      if (decision) return decision;
    }

    return {
      eventId: event.id,
      eventType: event.type,
      action: 'allow',
      wakePlanner: shouldWakePlanner(event),
      reason: 'event accepted',
      timestamp: Date.now(),
    };
  }

  private ignoreDuplicateNotification(event: JarvisEvent): RuleDecision | null {
    if (event.type !== 'notification.received') return null;
    const payload = event.payload as {packageName?: unknown; title?: unknown; text?: unknown};
    const signature = `notification:${String(payload.packageName)}:${String(payload.title)}:${String(payload.text)}`;
    const previousAt = this.recentSignatures.get(signature) ?? 0;
    this.recentSignatures.set(signature, event.timestamp);
    this.pruneSignatures(event.timestamp);
    if (event.timestamp - previousAt < 30_000) {
      return suppress(event, 'duplicate notification within 30s');
    }
    return null;
  }

  private ignoreTinyRepeatedScreenState(event: JarvisEvent): RuleDecision | null {
    if (event.type !== 'screen.state') return null;
    const payload = event.payload as {
      packageName?: unknown;
      nodeCount?: unknown;
      lastActionResult?: unknown;
      visibleTextSignature?: unknown;
    };
    const signature = [
      payload.packageName,
      payload.nodeCount,
      payload.lastActionResult,
      payload.visibleTextSignature,
    ].map(String).join(':');
    const previousSignature = this.lastScreenSignature;
    const previousAt = this.lastScreenAt;
    this.lastScreenSignature = signature;
    this.lastScreenAt = event.timestamp;
    if (signature === previousSignature && event.timestamp - previousAt < 750) {
      return suppress(event, 'duplicate accessibility snapshot within 750ms');
    }
    return null;
  }

  private ignoreNoisyScreenActivity(event: JarvisEvent): RuleDecision | null {
    if (event.type !== 'accessibility.screen_activity') return null;
    const payload = event.payload as {packageName?: unknown; eventType?: unknown};
    const signature = `screen_activity:${String(payload.packageName)}:${String(payload.eventType)}`;
    const previousAt = this.recentSignatures.get(signature) ?? 0;
    this.recentSignatures.set(signature, event.timestamp);
    if (event.timestamp - previousAt < 2_000) {
      return suppress(event, 'screen activity repeated within 2s');
    }
    return null;
  }

  private pruneSignatures(now: number): void {
    for (const [signature, timestamp] of this.recentSignatures.entries()) {
      if (now - timestamp > 60_000) this.recentSignatures.delete(signature);
    }
  }
}

function shouldWakePlanner(event: JarvisEvent): boolean {
  return (
    event.priority === 'critical' ||
    event.priority === 'high' ||
    event.type === 'developer.task_submitted' ||
    event.type === 'screen.state'
  );
}

function suppress(event: JarvisEvent, reason: string): RuleDecision {
  return {
    eventId: event.id,
    eventType: event.type,
    action: 'suppress',
    wakePlanner: false,
    reason,
    timestamp: Date.now(),
  };
}
