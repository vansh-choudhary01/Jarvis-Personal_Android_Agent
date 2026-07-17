import {AndroidAgent} from './agent.js';
import type {LlmRuntime} from './llmRuntime.js';
import type {PhoneTransport} from './phoneTransport.js';
import type {PhoneMessage} from './protocol.js';
import {TaskManager} from './taskManager.js';

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
  private running = false;

  constructor(private readonly options: BrainRuntimeOptions) {
    this.manager = new TaskManager(new AndroidAgent(options.llm));
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
    return this.manager.startTask(instruction);
  }

  async receivePhoneMessage(message: PhoneMessage): Promise<void> {
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
    };
  }
}
