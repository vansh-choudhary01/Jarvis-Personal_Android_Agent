import {NativeEventEmitter, NativeModules} from 'react-native';
import {JARVIS_CONFIG} from './config';
import {JarvisAccessibility, JarvisDevice, JarvisTelephony, type NodeTreeItem} from './native';

type ConnectionListener = (status: string) => void;
type ScreenEvent = {nodeTreeJson: string; packageName: string};
type NotificationEvent = {packageName: string; title: string; text: string; timestamp: number};
type SmsEvent = {sender: string; body: string; timestamp: number};

type Action =
  | {type: 'action'; action: 'tap'; x: number; y: number}
  | {type: 'action'; action: 'type'; text: string}
  | {type: 'action'; action: 'find_and_tap'; targetText: string}
  | {type: 'action'; action: 'swipe'; x1: number; y1: number; x2: number; y2: number}
  | {type: 'action'; action: 'open_app'; packageName: string}
  | {type: 'action'; action: 'call'; number: string}
  | {type: 'action'; action: 'wait'; ms: number}
  | {type: 'action'; action: 'task_complete'; summary: string}
  | {type: 'action'; action: 'task_failed'; reason: string};

export interface LogEntry {
  ts: number;
  kind: string;
  detail: string;
}

type LogListener = (log: LogEntry[]) => void;

class Controller {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.stopped = false;
    this.installNativeListeners();
    this.installNativeListeners();
    await JarvisDevice.startForegroundService(
      JARVIS_CONFIG.brainWebSocketUrl,
      JARVIS_CONFIG.phoneAuthToken,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.setStatus('Stopped');
  }

  private installNativeListeners(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    const events = new NativeEventEmitter(NativeModules.JarvisDevice);
    events.addListener('screen_state', (event: ScreenEvent) => {
      this.latestScreen = event;
      this.sendScreenState(null);
    });
    events.addListener('notification', (event: NotificationEvent) => this.send({type: 'notification', ...event}));
    events.addListener('sms_received', (event: SmsEvent) => this.send({type: 'sms_received', ...event}));
    events.addListener('jarvis_error', (event: {message: string}) => this.setStatus(`Native error: ${event.message}`));
    events.addListener('connection_status', (event: {status: string}) => this.setStatus(event.status));
  }

  private connect(): void {
    if (
      this.stopped ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) return;
    const separator = JARVIS_CONFIG.brainWebSocketUrl.includes('?') ? '&' : '?';
    const url = `${JARVIS_CONFIG.brainWebSocketUrl}${separator}token=${encodeURIComponent(JARVIS_CONFIG.phoneAuthToken)}`;
    this.setStatus('Connecting…');
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.setStatus('Connected');
      this.sendScreenState(null);
    };
    socket.onmessage = event => this.onBrainMessage(String(event.data));
    socket.onerror = () => this.setStatus('Connection error');
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) {
        this.setStatus('Disconnected — retrying');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };
  }

  private async onBrainMessage(raw: string): Promise<void> {
    try {
      const message = JSON.parse(raw) as Action | {type: 'request_screen_state'} | {type: 'task_status'; status: string; detail?: string};
      if (message.type === 'request_screen_state') {
        await this.refreshAndSend(null);
      } else if (message.type === 'task_status') {
        const status = message.detail ? `${message.status}: ${message.detail}` : message.status;
        this.setStatus(status);
        this.pushLog('task_status', status);
      } else if (message.type === 'action') {
        this.pushLog('action', (message as Action).action);
        await this.execute(message);
      }
    } catch (error) {
      this.setStatus(`Protocol error: ${errorMessage(error)}`);
    }
  }

  private async execute(action: Action): Promise<void> {
    if (action.action === 'task_complete') {
      this.setStatus(`Complete: ${action.summary}`);
      return;
    }
    if (action.action === 'task_failed') {
      this.setStatus(`Failed: ${action.reason}`);
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
    this.send({
      type: 'screen_state',
      nodeTree,
      packageName: this.latestScreen.packageName,
      lastActionResult,
    });
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
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
