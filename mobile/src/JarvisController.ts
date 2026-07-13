import {NativeEventEmitter, NativeModules} from 'react-native';
// Current Phase 2.2 host: React Native's TypeScript runtime embeds the Brain.
// Future host swap: a service-owned JavaScript runtime can implement the same
// BrainRuntime + PhoneTransport + LlmRuntime adapter boundary without changing
// planner, agents, task manager, memory, or business logic.
// @ts-ignore generated from ../brain/src by `npm run build` in brain
import {BrainRuntime} from '../../brain/dist-cjs/runtime.js';
import {
  JarvisAccessibility,
  JarvisDevice,
  JarvisTelephony,
  type NodeTreeItem,
} from './native';
import {
  MediaPipeRuntime,
  MODEL_REGISTRY,
  modelManager,
  recommendModel,
  type ModelDefinition,
} from './localAiRuntime';

type ConnectionListener = (status: string) => void;
type ScreenEvent = {nodeTreeJson: string; packageName: string};
type NotificationEvent = {packageName: string; title: string; text: string; timestamp: number};
type SmsEvent = {sender: string; body: string; timestamp: number};
type DeviceObservationEvent = {
  kind: 'app_changed' | 'screen_changed' | 'screen_activity' | 'user_interaction';
  packageName: string;
  appLabel?: string;
  className?: string;
  eventType?: string;
  timestamp: number;
};

type Action =
  | {type: 'action'; action: 'tap'; x: number; y: number; status?: string; progress?: number}
  | {type: 'action'; action: 'type'; text: string; status?: string; progress?: number}
  | {type: 'action'; action: 'find_and_tap'; targetText: string; status?: string; progress?: number}
  | {type: 'action'; action: 'swipe'; x1: number; y1: number; x2: number; y2: number; status?: string; progress?: number}
  | {type: 'action'; action: 'open_app'; packageName: string; status?: string; progress?: number}
  | {type: 'action'; action: 'list_apps'; status?: string; progress?: number}
  | {type: 'action'; action: 'get_recent_calls'; limit: number; status?: string; progress?: number}
  | {type: 'action'; action: 'call'; number: string; status?: string; progress?: number}
  | {type: 'action'; action: 'wait'; ms: number; status?: string; progress?: number}
  | {type: 'action'; action: 'task_complete'; summary: string; status?: string; progress?: number}
  | {type: 'action'; action: 'task_failed'; reason: string; status?: string; progress?: number};

type BrainMessage = Action | {type: 'request_screen_state'} | {type: 'task_status'; status: string; detail?: string};

interface PhoneTransport {
  isConnected(): boolean;
  send(message: BrainMessage): void;
  onClose(listener: () => void): void;
  close(): void;
}

export interface LogEntry {
  ts: number;
  kind: string;
  detail: string;
}

type LogListener = (log: LogEntry[]) => void;

class MobileLocalLlmRuntime {
  readonly provider = 'android-local';
  readonly model = 'MediaPipe via native bridge';
  private runtime: MediaPipeRuntime | null = null;
  private loadedModelId: string | null = null;

  async generate(request: {system: string; prompt: string; maxTokens?: number; temperature?: number}): Promise<string> {
    const runtime = await this.ensureRuntime();
    const prompt = [
      request.system,
      '',
      'You are running inside the Jarvis Android APK. Return only the JSON action object requested by the planner.',
      '',
      request.prompt,
    ].join('\n');
    const result = await runtime.generate({
      prompt,
      maxTokens: request.maxTokens ?? 512,
      temperature: request.temperature ?? 0.2,
    });
    return result.text;
  }

  private async ensureRuntime(): Promise<MediaPipeRuntime> {
    if (!this.runtime) {
      const profile = await JarvisDevice.getDeviceProfile();
      this.runtime = new MediaPipeRuntime();
      await this.runtime.initialize(profile);
    }

    const model = await this.pickModel();
    if (this.loadedModelId !== model.id || !(await this.runtime.isLoaded())) {
      await this.runtime.loadModel(model);
      this.loadedModelId = model.id;
    }
    return this.runtime;
  }

  private async pickModel(): Promise<ModelDefinition> {
    const installedModels = await modelManager.listInstalled();
    const activeModelId = installedModels.find(item => item.active)?.modelId ?? null;
    const activeModel = activeModelId ? MODEL_REGISTRY.find(item => item.id === activeModelId) : null;
    if (activeModel) return activeModel;

    const profile = await JarvisDevice.getDeviceProfile();
    return recommendModel(profile).model;
  }
}

class InAppPhoneTransport implements PhoneTransport {
  private closed = false;
  private closeListeners = new Set<() => void>();

  constructor(private readonly dispatch: (message: BrainMessage) => Promise<void>) {}

  isConnected(): boolean {
    return !this.closed;
  }

  send(message: BrainMessage): void {
    if (this.closed) return;
    this.dispatch(message).catch(() => undefined);
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }
}

class Controller {
  private brain: InstanceType<typeof BrainRuntime> | null = null;
  private transport: InAppPhoneTransport | null = null;
  private stopped = true;
  private listenersInstalled = false;
  private latestScreen: ScreenEvent = {nodeTreeJson: '[]', packageName: ''};
  private statusListeners = new Set<ConnectionListener>();
  private logListeners = new Set<LogListener>();
  private currentStatus = 'Not started';
  private actionLog: LogEntry[] = [];

  subscribe(listener: ConnectionListener): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  subscribeLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    listener(this.actionLog);
    return () => this.logListeners.delete(listener);
  }

  getNodeTree(): string {
    return this.latestScreen.nodeTreeJson;
  }

  async start(): Promise<void> {
    if (!this.stopped && this.brain) return;
    this.stopped = false;
    this.installNativeListeners();

    const llm = new MobileLocalLlmRuntime();
    this.brain = new BrainRuntime({llm});
    this.transport = new InAppPhoneTransport(message => this.onBrainMessage(message));
    this.brain.start(this.transport);

    await JarvisDevice.startForegroundService('local://embedded-brain', '');
    this.setStatus('Embedded brain running on phone');
    await this.refreshAndSend(null);
  }

  stop(): void {
    this.stopped = true;
    this.transport?.close();
    this.transport = null;
    this.brain?.stop();
    this.brain = null;
    JarvisDevice.stopForegroundService().catch(() => undefined);
    this.setStatus('Stopped');
  }

  async submitTask(instruction: string): Promise<string> {
    if (!this.brain || this.stopped) await this.start();
    if (!this.brain) throw new Error('Embedded brain did not start.');
    const taskId = await this.brain.submitTask(instruction);
    this.pushLog('task', instruction);
    await this.refreshAndSend(null);
    return taskId;
  }

  getStatus(): {running: boolean; phoneConnected: boolean; llmProvider: string; llmModel: string} | null {
    return this.brain?.getStatus() ?? null;
  }

  private installNativeListeners(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    const events = new NativeEventEmitter(NativeModules.JarvisDevice);
    events.addListener('screen_state', (event: ScreenEvent) => {
      this.latestScreen = event;
      this.sendScreenState(null);
    });
    events.addListener('notification', (event: NotificationEvent) => {
      this.receivePhoneMessage({type: 'notification', ...event});
    });
    events.addListener('sms_received', (event: SmsEvent) => {
      this.receivePhoneMessage({type: 'sms_received', ...event});
    });
    events.addListener('device_observation', (event: DeviceObservationEvent) => {
      this.receivePhoneMessage({
        type: 'device_observation',
        kind: event.kind,
        packageName: event.packageName,
        appLabel: event.appLabel ?? '',
        className: event.className ?? '',
        eventType: event.eventType ?? '',
        timestamp: event.timestamp,
      });
    });
    events.addListener('jarvis_error', (event: {message: string}) => this.setStatus(`Native error: ${event.message}`));
    events.addListener('connection_status', (event: {status: string}) => this.setStatus(event.status));
  }

  private async receivePhoneMessage(message: object): Promise<void> {
    if (!this.brain || this.stopped) return;
    try {
      await this.brain.receivePhoneMessage(message);
    } catch (error) {
      this.pushLog('brain_error', errorMessage(error));
    }
  }

  private async onBrainMessage(message: BrainMessage): Promise<void> {
    try {
      if (message.type === 'request_screen_state') {
        await this.refreshAndSend(null);
      } else if (message.type === 'task_status') {
        const status = message.detail ? `${message.status}: ${message.detail}` : message.status;
        this.setStatus(status);
        this.pushLog('task_status', status);
      } else if (message.type === 'action') {
        if (message.status) this.setStatus(message.status);
        this.pushLog('action', `${message.action}${message.progress == null ? '' : ` (${message.progress}%)`}`);
        await this.execute(message);
      }
    } catch (error) {
      this.setStatus(`Protocol error: ${errorMessage(error)}`);
    }
  }

  private async execute(action: Action): Promise<void> {
    if (action.action === 'task_complete') {
      this.setStatus(`Complete: ${action.summary}`);
      this.pushLog('complete', action.summary);
      return;
    }
    if (action.action === 'task_failed') {
      this.setStatus(`Failed: ${action.reason}`);
      this.pushLog('failed', action.reason);
      return;
    }

    let result = 'success';
    try {
      switch (action.action) {
        case 'tap':
          await JarvisAccessibility.tap(action.x, action.y);
          break;
        case 'type':
          await JarvisAccessibility.type(action.text);
          break;
        case 'find_and_tap':
          await JarvisAccessibility.findAndTap(action.targetText);
          break;
        case 'swipe':
          await JarvisAccessibility.swipe(action.x1, action.y1, action.x2, action.y2);
          break;
        case 'open_app':
          await JarvisDevice.openApp(action.packageName);
          break;
        case 'list_apps':
          result = JSON.stringify(await JarvisDevice.listApps());
          break;
        case 'get_recent_calls':
          result = JSON.stringify(await JarvisTelephony.getRecentCalls(action.limit));
          break;
        case 'call':
          await JarvisTelephony.call(action.number);
          break;
        case 'wait':
          await delay(action.ms);
          break;
      }
    } catch (error) {
      result = `failed: ${errorMessage(error)}`;
    }
    await delay(450);
    await this.refreshAndSend(result);
  }

  private async refreshAndSend(lastActionResult: string | null): Promise<void> {
    try {
      this.latestScreen = {
        ...this.latestScreen,
        nodeTreeJson: await JarvisAccessibility.getCurrentNodeTree(),
      };
    } catch {
      // An empty tree is still useful: the brain can fail clearly when accessibility is unavailable.
    }
    this.sendScreenState(lastActionResult);
  }

  private sendScreenState(lastActionResult: string | null): void {
    let nodeTree: NodeTreeItem[] = [];
    try {
      nodeTree = JSON.parse(this.latestScreen.nodeTreeJson) as NodeTreeItem[];
    } catch {
      // Keep the protocol valid even if a vendor accessibility node contains malformed data.
    }
    this.receivePhoneMessage({
      type: 'screen_state',
      nodeTree,
      packageName: this.latestScreen.packageName,
      lastActionResult,
    });
  }

  private pushLog(kind: string, detail: string): void {
    this.actionLog = [{ts: Date.now(), kind, detail}, ...this.actionLog].slice(0, 50);
    for (const listener of this.logListeners) listener(this.actionLog);
  }

  private setStatus(status: string): void {
    this.currentStatus = status;
    this.pushLog('status', status);
    for (const listener of this.statusListeners) listener(status);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const JarvisController = new Controller();
