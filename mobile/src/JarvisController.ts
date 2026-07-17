import {NativeEventEmitter, NativeModules} from 'react-native';
// Current Phase 2.2 host: React Native's TypeScript runtime embeds the Brain.
// Future host swap: a service-owned JavaScript runtime can implement the same
// BrainRuntime + PhoneTransport + LlmRuntime adapter boundary without changing
// planner, agents, task manager, memory, or business logic.
// @ts-ignore generated from ../brain/src by `npm run build` in brain
import {BrainRuntime} from '../../brain/dist-cjs/runtime.js';
// @ts-ignore generated from ../brain/src by `npm run build` in brain
import {setLogSink} from '../../brain/dist-cjs/logger.js';
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
  | {type: 'action'; action: 'get_device_profile'; status?: string; progress?: number}
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
  data?: unknown;
}

type LogListener = (log: LogEntry[]) => void;

class MobileLocalLlmRuntime {
  readonly provider = 'android-local';
  readonly model = 'MediaPipe via native bridge';
  private runtime: MediaPipeRuntime | null = null;
  private loadedModelId: string | null = null;

  constructor(private readonly observe: (kind: string, detail: string, data?: unknown) => void) {}

  async generate(request: {system: string; prompt: string; maxTokens?: number; temperature?: number}): Promise<string> {
    const startedAt = Date.now();
    this.observe('llm_generate_start', 'Preparing local model request', {
      maxTokens: request.maxTokens ?? 512,
      temperature: request.temperature ?? 0.2,
      promptChars: request.prompt.length,
      systemChars: request.system.length,
      promptPreview: previewText(request.prompt, 900),
    });
    const runtime = await this.ensureRuntime();
    const prompt = buildLocalPlannerPrompt(request);
    const maxTokens = Math.min(request.maxTokens ?? 512, 96);
    this.observe('llm_generate_call', 'Calling MediaPipe local runtime', {
      loadedModelId: this.loadedModelId,
      fullPromptChars: prompt.length,
      adaptedPromptPreview: previewText(prompt, 1400),
      maxTokens,
    });
    let streamedText = '';
    try {
      this.observe('llm_stream_start', 'Streaming local model output', {loadedModelId: this.loadedModelId});
      for await (const chunk of runtime.stream({
        prompt,
        maxTokens,
        temperature: request.temperature ?? 0.2,
      })) {
        streamedText += chunk;
        this.observe('llm_stream_chunk', chunk, {
          chunk,
          text: previewText(streamedText, 5000),
          totalChars: streamedText.length,
          elapsedMs: Date.now() - startedAt,
        });
      }
      this.observe('llm_stream_done', `Local model streamed ${streamedText.length} chars in ${Date.now() - startedAt}ms`, {
        loadedModelId: this.loadedModelId,
        outputPreview: previewText(streamedText, 1200),
        elapsedMs: Date.now() - startedAt,
      });
      if (!streamedText.trim()) {
        this.observe('llm_stream_empty', 'Streaming completed without text, falling back to blocking generate', {
          loadedModelId: this.loadedModelId,
          elapsedMs: Date.now() - startedAt,
        });
        const result = await runtime.generate({
          prompt,
          maxTokens,
          temperature: request.temperature ?? 0.2,
        });
        this.observe('llm_generate_result', `Local model returned ${result.text.length} chars after empty stream fallback`, {
          loadedModelId: this.loadedModelId,
          outputPreview: previewText(result.text, 1200),
          elapsedMs: Date.now() - startedAt,
        });
        return result.text;
      }
      return streamedText;
    } catch (error) {
      this.observe('llm_stream_fallback', `Streaming failed, falling back to blocking generate: ${errorMessage(error)}`);
      const result = await runtime.generate({
        prompt,
        maxTokens,
        temperature: request.temperature ?? 0.2,
      });
      this.observe('llm_generate_result', `Local model returned ${result.text.length} chars in ${Date.now() - startedAt}ms`, {
        loadedModelId: this.loadedModelId,
        outputPreview: previewText(result.text, 1200),
        elapsedMs: Date.now() - startedAt,
      });
      return result.text;
    }
  }

  private async ensureRuntime(): Promise<MediaPipeRuntime> {
    if (!this.runtime) {
      this.observe('runtime_initialize_start', 'Initializing MediaPipe runtime');
      const profile = await JarvisDevice.getDeviceProfile();
      this.runtime = new MediaPipeRuntime();
      await this.runtime.initialize(profile);
      this.observe('runtime_initialize_done', 'MediaPipe runtime initialized', {
        manufacturer: profile.manufacturer,
        model: profile.model,
        ramMB: profile.ramMB,
        cpuCores: profile.cpuCores,
        abi: profile.abi,
      });
    }

    const model = await this.pickModel();
    if (this.loadedModelId !== model.id || !(await this.runtime.isLoaded())) {
      this.observe('model_load_start', `Loading ${model.displayName}`, {
        modelId: model.id,
        format: model.format,
        installedSizeGB: model.installedSizeGB,
      });
      await this.runtime.loadModel(model);
      this.loadedModelId = model.id;
      this.observe('model_load_done', `Loaded ${model.displayName}`, {modelId: model.id});
    }
    return this.runtime;
  }

  private async pickModel(): Promise<ModelDefinition> {
    const installedModels = await modelManager.listInstalled();
    const activeModelId = installedModels.find(item => item.active)?.modelId ?? null;
    const activeModel = activeModelId ? MODEL_REGISTRY.find(item => item.id === activeModelId) : null;
    if (activeModel) {
      this.observe('model_select', `Using active model ${activeModel.displayName}`, {modelId: activeModel.id});
      return activeModel;
    }

    const profile = await JarvisDevice.getDeviceProfile();
    const recommended = recommendModel(profile).model;
    this.observe('model_select', `Using recommended model ${recommended.displayName}`, {modelId: recommended.id});
    return recommended;
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
    setLogSink((event: Record<string, unknown>) => {
      const kind = typeof event.kind === 'string' ? event.kind : 'brain_event';
      this.pushLog(`brain:${kind}`, summarizeBrainEvent(event), event);
    });
    this.pushLog('runtime_start', 'Starting embedded Brain runtime');

    const llm = new MobileLocalLlmRuntime((kind, detail, data) => this.pushLog(kind, detail, data));
    this.brain = new BrainRuntime({llm});
    this.transport = new InAppPhoneTransport(message => this.onBrainMessage(message));
    this.brain.start(this.transport);

    this.pushLog('native_service_start', 'Starting Android foreground service in local mode');
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
    this.pushLog('task_submit_start', instruction);
    const taskId = await this.brain.submitTask(instruction);
    this.pushLog('task_submit_done', `Accepted ${taskId}`, {taskId, instruction});
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
      this.pushLog('native_screen_state', event.packageName || 'Screen state received', {
        packageName: event.packageName,
        nodeTreeChars: event.nodeTreeJson.length,
      });
      this.sendScreenState(null);
    });
    events.addListener('notification', (event: NotificationEvent) => {
      this.pushLog('native_notification', `${event.packageName}: ${event.title}`, event);
      this.receivePhoneMessage({type: 'notification', ...event});
    });
    events.addListener('sms_received', (event: SmsEvent) => {
      this.pushLog('native_sms', `SMS from ${event.sender}`, {...event, body: previewText(event.body, 160)});
      this.receivePhoneMessage({type: 'sms_received', ...event});
    });
    events.addListener('device_observation', (event: DeviceObservationEvent) => {
      this.pushLog('native_observation', `${event.kind}: ${event.appLabel || event.packageName}`, event);
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
    events.addListener('jarvis_error', (event: {message: string}) => {
      this.pushLog('native_error', event.message, event);
      this.setStatus(`Native error: ${event.message}`);
    });
    events.addListener('connection_status', (event: {status: string}) => {
      this.pushLog('native_status', event.status, event);
      this.setStatus(event.status);
    });
  }

  private async receivePhoneMessage(message: object): Promise<void> {
    if (!this.brain || this.stopped) return;
    try {
      this.pushLog('brain_receive_phone_message', messageType(message), compactMessage(message));
      await this.brain.receivePhoneMessage(message);
    } catch (error) {
      this.pushLog('brain_error', errorMessage(error), {message});
    }
  }

  private async onBrainMessage(message: BrainMessage): Promise<void> {
    try {
      this.pushLog('brain_to_phone', message.type === 'action' ? `action:${message.action}` : message.type, message);
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
      this.pushLog('complete', action.summary, action);
      return;
    }
    if (action.action === 'task_failed') {
      this.setStatus(`Failed: ${action.reason}`);
      this.pushLog('failed', action.reason, action);
      return;
    }

    let result = 'success';
    try {
      this.pushLog('native_action_start', action.action, action);
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
        case 'get_device_profile':
          result = JSON.stringify(await JarvisDevice.getDeviceProfile());
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
    this.pushLog('native_action_result', `${action.action}: ${previewText(result, 260)}`, {action, result});
    await delay(450);
    await this.refreshAndSend(result);
  }

  private async refreshAndSend(lastActionResult: string | null): Promise<void> {
    try {
      this.pushLog('screen_capture_start', 'Reading Accessibility node tree');
      this.latestScreen = {
        ...this.latestScreen,
        nodeTreeJson: await JarvisAccessibility.getCurrentNodeTree(),
      };
      this.pushLog('screen_capture_done', `${this.latestScreen.nodeTreeJson.length} chars`, {
        packageName: this.latestScreen.packageName,
        nodeTreeChars: this.latestScreen.nodeTreeJson.length,
      });
    } catch {
      // An empty tree is still useful: the brain can fail clearly when accessibility is unavailable.
      this.pushLog('screen_capture_failed', 'Accessibility node tree unavailable');
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
    this.pushLog('screen_state_to_brain', `${nodeTree.length} nodes from ${this.latestScreen.packageName || 'unknown package'}`, {
      packageName: this.latestScreen.packageName,
      nodeCount: nodeTree.length,
      lastActionResult,
    });
    this.receivePhoneMessage({
      type: 'screen_state',
      nodeTree,
      packageName: this.latestScreen.packageName,
      lastActionResult,
    });
  }

  private pushLog(kind: string, detail: string, data?: unknown): void {
    this.actionLog = [{ts: Date.now(), kind, detail, data}, ...this.actionLog].slice(0, 160);
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

function previewText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

type LocalPlannerPayload = {
  originalInstruction?: unknown;
  recentHistory?: unknown;
  currentScreenState?: {
    packageName?: unknown;
    nodeTree?: unknown;
    lastActionResult?: unknown;
  };
  recentPhoneEvents?: unknown;
};

type CompactNode = {
  text?: string;
  desc?: string;
  cls?: string;
  clickable?: boolean;
  editable?: boolean;
};

function buildLocalPlannerPrompt(request: {system: string; prompt: string}): string {
  const payload = parsePlannerPayload(request.prompt);
  if (!payload) {
    return [
      'You are Jarvis running locally on Android.',
      'Return exactly one JSON object and no prose.',
      request.prompt,
    ].join('\n');
  }

  const screen = payload.currentScreenState ?? {};
  const nodes = compactNodes(screen.nodeTree);
  const history = compactJson(payload.recentHistory, 360);
  const events = compactJson(payload.recentPhoneEvents, 360);
  const packageName = safeText(screen.packageName, 90) || 'unknown';
  const lastActionResult = safeText(screen.lastActionResult, 220) || 'none';
  const instruction = safeText(payload.originalInstruction, 500);

  return [
    'You are Jarvis running locally on Android.',
    'The user gives you one short task. Reply with only one valid JSON object.',
    'Do not write markdown, notes, code fences, or extra text.',
    'If the task is only greeting, testing, or chatting, complete it with this exact JSON shape:',
    '{"action":"task_complete","summary":"short friendly answer"}',
    'If phone control or device data is needed, choose one action name from: find_and_tap, type, open_app, list_apps, get_device_profile, swipe, wait, get_recent_calls, call, task_complete, task_failed.',
    'For Android version, SDK, phone model, RAM, CPU, storage, battery, or thermal info, use get_device_profile before task_complete.',
    'Prefer find_and_tap using visible text. Avoid coordinates unless absolutely necessary.',
    '',
    `User task: ${instruction}`,
    `Current package: ${packageName}`,
    `Last action result: ${lastActionResult}`,
    `Visible UI text: ${compactVisibleText(nodes) || 'none'}`,
    `Recent history: ${history}`,
    `Recent phone events: ${events}`,
    'JSON only:',
  ].join('\n');
}

function parsePlannerPayload(prompt: string): LocalPlannerPayload | null {
  try {
    const parsed = JSON.parse(prompt) as LocalPlannerPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function compactNodes(value: unknown): CompactNode[] {
  const nodes = Array.isArray(value) ? value : [];
  return nodes
    .map(node => (node && typeof node === 'object' ? node as Record<string, unknown> : null))
    .filter((node): node is Record<string, unknown> => !!node)
    .filter(node => Boolean(safeText(node.text, 80) || safeText(node.contentDescription, 80) || node.clickable || node.editable))
    .slice(0, 45)
    .map(node => ({
      text: safeText(node.text, 70) || undefined,
      desc: safeText(node.contentDescription, 70) || undefined,
      cls: shortClassName(safeText(node.className, 80)) || undefined,
      clickable: Boolean(node.clickable),
      editable: Boolean(node.editable),
    }));
}

function compactVisibleText(nodes: CompactNode[]): string {
  return nodes
    .map(node => [node.text, node.desc].filter(Boolean).join(' / '))
    .filter(Boolean)
    .slice(0, 25)
    .join(' | ');
}

function compactJson(value: unknown, max: number): string {
  try {
    return previewText(JSON.stringify(value ?? []), max);
  } catch {
    return '[]';
  }
}

function safeText(value: unknown, max: number): string {
  if (value == null) return '';
  return previewText(String(value), max);
}

function shortClassName(value: string): string {
  if (!value) return '';
  const parts = value.split('.');
  return parts[parts.length - 1] ?? value;
}

function messageType(message: object): string {
  if ('type' in message && typeof message.type === 'string') return message.type;
  return 'unknown_message';
}

function compactMessage(message: object): unknown {
  if ('type' in message && message.type === 'screen_state') {
    const screen = message as {nodeTree?: unknown[]; packageName?: string; lastActionResult?: string | null};
    return {
      type: 'screen_state',
      packageName: screen.packageName ?? '',
      nodeCount: Array.isArray(screen.nodeTree) ? screen.nodeTree.length : 0,
      lastActionResult: screen.lastActionResult ?? null,
    };
  }
  return message;
}

function summarizeBrainEvent(event: Record<string, unknown>): string {
  const kind = String(event.kind ?? 'brain_event');
  if (kind === 'planner_generate_start') {
    return `Planning for ${String(event.instruction ?? '').slice(0, 80)}`;
  }
  if (kind === 'planner_generate_result') {
    return `Model response: ${previewText(String(event.responsePreview ?? ''), 120)}`;
  }
  if (kind === 'planner_parse_success' || kind === 'planner_repair_success') {
    const action = event.action as {action?: string} | undefined;
    return `Parsed action: ${action?.action ?? 'unknown'}`;
  }
  if (kind === 'planner_parse_failed') return 'Model response was not valid JSON action';
  if (kind === 'planner_repair_start') return 'Retrying with JSON-only repair prompt';
  if (kind === 'planner_repair_result') return `Repair response: ${previewText(String(event.responsePreview ?? ''), 120)}`;
  if (kind === 'planner_repair_failed') return 'Repair response was still invalid';
  if (kind === 'task_started') return `Task started: ${String(event.instruction ?? '').slice(0, 80)}`;
  if (kind === 'action') {
    const action = event.action as {action?: string} | undefined;
    return `Brain selected action: ${action?.action ?? 'unknown'}`;
  }
  if (kind === 'action_result') return `Action result: ${previewText(String(event.result ?? ''), 120)}`;
  if (kind === 'task_finished') return 'Task finished';
  if (kind === 'agent_error') return `Agent error: ${String(event.reason ?? '')}`;
  return kind;
}

export const JarvisController = new Controller();
