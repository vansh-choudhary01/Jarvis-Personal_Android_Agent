import type {JarvisEvent} from './eventBus.js';
import type {ScreenModel} from './screenObserver.js';

export interface WorldStateSnapshot {
  currentApp: string;
  currentAppLabel: string;
  foregroundActivity: string;
  screenLocked: boolean;
  screenInteractive: boolean;
  batteryPercent: number | null;
  charging: boolean | null;
  powerSource: string;
  wifiConnected: boolean | null;
  wifiName: string;
  bluetoothConnected: boolean | null;
  lastClipboardText: string;
  lastNotification: Record<string, unknown> | null;
  lastSms: Record<string, unknown> | null;
  lastCall: Record<string, unknown> | null;
  lastPackageChanged: Record<string, unknown> | null;
  screen: ScreenModel | null;
  updatedAt: number;
}

export class WorldStateManager {
  private state: WorldStateSnapshot = {
    currentApp: '',
    currentAppLabel: '',
    foregroundActivity: '',
    screenLocked: false,
    screenInteractive: true,
    batteryPercent: null,
    charging: null,
    powerSource: '',
    wifiConnected: null,
    wifiName: '',
    bluetoothConnected: null,
    lastClipboardText: '',
    lastNotification: null,
    lastSms: null,
    lastCall: null,
    lastPackageChanged: null,
    screen: null,
    updatedAt: Date.now(),
  };

  observe(event: JarvisEvent): void {
    const payload = event.payload as Record<string, unknown>;
    const next: Partial<WorldStateSnapshot> = {updatedAt: event.timestamp};

    if (event.type === 'foreground_app.changed') {
      next.currentApp = stringValue(payload.packageName);
      next.currentAppLabel = stringValue(payload.appLabel);
      next.foregroundActivity = stringValue(payload.className);
    }

    if (event.type === 'screen.state') {
      next.currentApp = stringValue(payload.packageName) || this.state.currentApp;
      if (isScreenModel(payload.screenModel)) next.screen = payload.screenModel;
    }

    if (event.type === 'screen.locked') {
      next.screenLocked = true;
      next.screenInteractive = false;
    }
    if (event.type === 'screen.unlocked') {
      next.screenLocked = false;
      next.screenInteractive = true;
    }

    if (event.type === 'battery.changed' || event.type === 'battery.low') {
      next.batteryPercent = numberValue(payload.percent, this.state.batteryPercent);
      next.charging = booleanOrNull(payload.charging, this.state.charging);
      next.powerSource = stringValue(payload.powerSource) || this.state.powerSource;
    }
    if (event.type === 'charging.started') {
      next.charging = true;
      next.powerSource = stringValue(payload.powerSource) || 'charging';
    }
    if (event.type === 'charging.stopped') {
      next.charging = false;
      next.powerSource = '';
    }

    if (event.type === 'wifi.connected') {
      next.wifiConnected = true;
      next.wifiName = stringValue(payload.ssid);
    }
    if (event.type === 'wifi.lost') {
      next.wifiConnected = false;
      next.wifiName = '';
    }

    if (event.type === 'bluetooth.connected') next.bluetoothConnected = true;
    if (event.type === 'bluetooth.disconnected') next.bluetoothConnected = false;

    if (event.type === 'clipboard.changed') {
      next.lastClipboardText = stringValue(payload.text);
    }

    if (event.type === 'notification.received') next.lastNotification = payload;
    if (event.type === 'sms.received') next.lastSms = payload;
    if (event.type === 'call.incoming' || event.type === 'call.missed' || event.type === 'call.ended') next.lastCall = payload;
    if (event.type === 'package.installed' || event.type === 'package.removed') next.lastPackageChanged = payload;

    this.state = {...this.state, ...next};
  }

  snapshot(): WorldStateSnapshot {
    return structuredCloneSafe(this.state);
  }
}

function isScreenModel(value: unknown): value is ScreenModel {
  return Boolean(value && typeof value === 'object' && 'summary' in value && 'nodeCount' in value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function numberValue(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOrNull(value: unknown, fallback: boolean | null): boolean | null {
  return typeof value === 'boolean' ? value : fallback;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
