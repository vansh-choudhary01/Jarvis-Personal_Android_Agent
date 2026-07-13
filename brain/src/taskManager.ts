import {AndroidAgent, type HistoryStep} from './agent.js';
import {logEvent} from './logger.js';
import type {AgentAction, BrainMessage, ScreenState} from './protocol.js';
import type {PhoneTransport} from './phoneTransport.js';

interface ActiveTask {
  id: string;
  instruction: string;
  history: HistoryStep[];
  processing: boolean;
  startedAt: string;
  actionCount: number;
}

export class TaskManager {
  private phone: PhoneTransport | null = null;
  private task: ActiveTask | null = null;
  private recentPhoneEvents: Record<string, unknown>[] = [];

  constructor(private readonly agent: AndroidAgent) {}

  attachPhone(phone: PhoneTransport): void {
    if (this.phone && this.phone !== phone) {
      this.phone.close?.(4001, 'Replaced by a new phone connection');
    }
    this.phone = phone;
    phone.onClose(() => {
      if (this.phone === phone) this.phone = null;
    });
  }

  hasPhone(): boolean {
    return this.phone !== null && this.phone.isConnected();
  }

  getTask(): Readonly<ActiveTask> | null {
    return this.task;
  }

  async startTask(instruction: string): Promise<string> {
    if (!this.hasPhone()) throw new Error('Phone is not connected');
    if (this.task) throw new Error('A task is already active');

    const id = createTaskId();
    this.task = {
      id,
      instruction,
      history: [],
      processing: false,
      startedAt: new Date().toISOString(),
      actionCount: 0,
    };
    await logEvent({kind: 'task_started', taskId: id, instruction});
    this.send({type: 'task_status', status: 'started', detail: instruction});
    this.send({type: 'request_screen_state'});
    return id;
  }

  async onScreenState(screen: ScreenState): Promise<void> {
    const task = this.task;
    if (!task || task.processing) return;

    const awaitingResult = task.history.at(-1)?.result === null;
    if (awaitingResult && !screen.lastActionResult) return;

    if (task.history.length > 0 && screen.lastActionResult) {
      task.history[task.history.length - 1]!.result = screen.lastActionResult;
      await logEvent({
        kind: 'action_result',
        taskId: task.id,
        result: screen.lastActionResult,
        packageName: screen.packageName,
      });
    }

    task.processing = true;
    try {
      const action = await this.agent.nextAction(
        task.instruction,
        screen,
        task.history,
        this.recentPhoneEvents.slice(-30),
      );
      const actionJson = JSON.stringify(action);
      const repeatedThreeTimes =
        action.action !== 'task_complete' &&
        action.action !== 'task_failed' &&
        task.history.slice(-2).length === 2 &&
        task.history.slice(-2).every(step => JSON.stringify(step.action) === actionJson);

      if (repeatedThreeTimes) {
        await this.dispatchAction(task.id, {
          action: 'task_failed',
          reason: `Stopped after the same action repeated three times: ${action.action}`,
        });
        return;
      }

      if (task.actionCount >= 20) {
        await this.dispatchAction(task.id, {
          action: 'task_failed',
          reason: 'Stopped after reaching the 20-action safety limit',
        });
        return;
      }

      task.actionCount += 1;
      await this.dispatchAction(task.id, action);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await logEvent({kind: 'agent_error', taskId: task.id, reason});
      await this.dispatchAction(task.id, {action: 'task_failed', reason: `Agent error: ${reason}`});
    } finally {
      if (this.task === task) task.processing = false;
    }
  }

  async logPassiveEvent(event: Record<string, unknown>): Promise<void> {
    this.recentPhoneEvents.push(event);
    if (this.recentPhoneEvents.length > 100) this.recentPhoneEvents.shift();
    await logEvent({kind: 'phone_event', ...event});
  }

  private async dispatchAction(taskId: string, action: AgentAction): Promise<void> {
    await logEvent({kind: 'action', taskId, action});
    this.send({type: 'action', ...action});

    if (action.action === 'task_complete' || action.action === 'task_failed') {
      await logEvent({kind: 'task_finished', taskId, outcome: action});
      this.task = null;
      return;
    }

    this.task?.history.push({action, result: null});
    if (this.task && this.task.history.length > 10) this.task.history.shift();
  }

  private send(message: BrainMessage): void {
    if (!this.phone || !this.phone.isConnected()) {
      throw new Error('Phone disconnected');
    }
    this.phone.send(message);
  }
}

let taskIdCounter = 0;

function createTaskId(): string {
  const runtimeCrypto = (globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    };
  }).crypto;

  if (runtimeCrypto?.randomUUID) {
    return runtimeCrypto.randomUUID();
  }

  if (runtimeCrypto?.getRandomValues) {
    const bytes = runtimeCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  taskIdCounter = (taskIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `task-${Date.now().toString(36)}-${taskIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
