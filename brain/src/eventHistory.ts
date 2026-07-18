import type {JarvisEvent} from './eventBus.js';
import type {RuleDecision} from './ruleEngine.js';

export interface EventHistoryEntry {
  event: JarvisEvent;
  decision?: RuleDecision;
}

export class EventHistory {
  private readonly entries: EventHistoryEntry[] = [];

  constructor(private readonly limit = 500) {}

  record(event: JarvisEvent, decision?: RuleDecision): void {
    this.entries.push({event, decision});
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  recent(limit = 80): EventHistoryEntry[] {
    return this.entries.slice(-limit);
  }

  search(query: string, limit = 50): EventHistoryEntry[] {
    const needle = query.toLowerCase();
    return this.entries
      .filter(entry => JSON.stringify(entry).toLowerCase().includes(needle))
      .slice(-limit);
  }
}
