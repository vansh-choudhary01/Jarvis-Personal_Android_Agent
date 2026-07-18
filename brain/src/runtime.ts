import {AndroidAgent} from './agent.js';
import {CapabilityManager} from './capabilityManager.js';
import {EventBus, normalizePhoneMessage, type JarvisEvent} from './eventBus.js';
import {EventHistory} from './eventHistory.js';
import type {LlmRuntime} from './llmRuntime.js';
import {logEvent} from './logger.js';
import type {PhoneTransport} from './phoneTransport.js';
import type {PhoneMessage} from './protocol.js';
import {RuleEngine, type RuleDecision} from './ruleEngine.js';
import {TaskManager} from './taskManager.js';
import {WorkingMemory} from './workingMemory.js';

export interface BrainRuntimeOptions {
  llm: LlmRuntime;
  phone?: PhoneTransport;
}

export interface BrainStatus {
  running: boolean;
  phoneConnected: boolean;
  activeTask: ReturnType<TaskManager['getTask']>;
  llmProvider: string;
  llmModel: string;
  workingMemory: ReturnType<WorkingMemory['snapshot']>;
  recentEvents: ReturnType<EventHistory['recent']>;
}

/**
 * Runtime boundary for Jarvis Brain.
 *
 * Planner, agents, task manager, and future memory live behind this interface.
 * Android React Native, a future service-owned Javet/Node host, desktop, or
 * the development server should all integrate through this runtime instead of
 * importing business logic directly.
 */
export class BrainRuntime {
  private readonly manager: TaskManager;
  private readonly eventBus = new EventBus();
  private readonly ruleEngine = new RuleEngine();
  private readonly eventHistory = new EventHistory();
  private readonly workingMemory = new WorkingMemory();
  private readonly capabilityManager = new CapabilityManager();
  private readonly eventDecisions = new Map<string, RuleDecision>();
  private running = false;

  constructor(private readonly options: BrainRuntimeOptions) {
    this.eventBus.subscribe(event => this.routeEvent(event));
    this.manager = new TaskManager(new AndroidAgent(options.llm), {
      eventBus: this.eventBus,
      capabilityManager: this.capabilityManager,
    });
    if (options.phone) this.attachPhone(options.phone);
  }

  start(phone?: PhoneTransport): void {
    this.running = true;
    if (phone) this.attachPhone(phone);
  }

  stop(): void {
    this.running = false;
  }

  attachPhone(phone: PhoneTransport): void {
    this.manager.attachPhone(phone);
  }

  async submitTask(instruction: string): Promise<string> {
    if (!this.running) this.start();
    this.publishEvent({
      type: 'developer.task_submitted',
      source: 'developer.ui',
      priority: 'high',
      payload: {instruction},
    });
    return this.manager.startTask(instruction);
  }

  async receivePhoneMessage(message: PhoneMessage): Promise<void> {
    const decisions = normalizePhoneMessage(message).map(draft => this.publishEvent(draft));
    const shouldProcess = decisions.some(({decision}) => decision.action === 'allow');
    if (!shouldProcess) return;

    if (message.type === 'screen_state') {
      await this.manager.onScreenState(message);
    } else {
      await this.manager.logPassiveEvent(message);
    }
  }

  getStatus(): BrainStatus {
    return {
      running: this.running,
      phoneConnected: this.manager.hasPhone(),
      activeTask: this.manager.getTask(),
      llmProvider: this.options.llm.provider,
      llmModel: this.options.llm.model,
      workingMemory: this.workingMemory.snapshot(),
      recentEvents: this.eventHistory.recent(40),
    };
  }

  private publishEvent(draft: Parameters<EventBus['publish']>[0]): {event: JarvisEvent; decision: RuleDecision} {
    const event = this.eventBus.publish(draft);
    const decision = this.eventDecisions.get(event.id) ?? this.defaultDecision(event);
    return {event, decision};
  }

  private routeEvent(event: JarvisEvent): void {
    const decision = this.ruleEngine.decide(event);
    this.eventDecisions.set(event.id, decision);
    if (this.eventDecisions.size > 300) {
      const first = this.eventDecisions.keys().next().value;
      if (first) this.eventDecisions.delete(first);
    }
    this.eventHistory.record(event, decision);
    this.workingMemory.observe(event);
    logEvent({
      kind: 'event',
      eventType: event.type,
      source: event.source,
      priority: event.priority,
      decision: decision.action,
      wakePlanner: decision.wakePlanner,
      reason: decision.reason,
      payload: event.payload,
    }).catch(() => undefined);
  }

  private defaultDecision(event: JarvisEvent): RuleDecision {
    return {
      eventId: event.id,
      eventType: event.type,
      action: 'allow',
      wakePlanner: false,
      reason: 'event accepted before recorder returned',
      timestamp: Date.now(),
    };
  }
}
