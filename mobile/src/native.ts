import {NativeModules} from 'react-native';

export interface NodeTreeItem {
  text: string;
  contentDescription: string;
  className: string;
  packageName: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  editable: boolean;
}

export interface PermissionStatus {
  accessibility: boolean;
  notifications: boolean;
  batteryExempt: boolean;
  callLog: boolean;
  sms: boolean;
  callPhone: boolean;
  postNotifications: boolean;
}

export interface DeviceProfile {
  manufacturer: string;
  model: string;
  ramMB: number;
  cpuCores: number;
  architecture: string;
  abi: string;
  androidVersion: string;
  sdk: number;
  storageAvailableMB: number;
  batteryState: string;
  batteryPercent: number;
  thermalStatus: string;
  supportsGPUAcceleration: boolean;
  supportsNPUAcceleration: boolean;
}

interface AccessibilityModule {
  tap(x: number, y: number): Promise<boolean>;
  type(text: string): Promise<boolean>;
  swipe(x1: number, y1: number, x2: number, y2: number): Promise<boolean>;
  findAndTap(targetText: string): Promise<boolean>;
  getCurrentNodeTree(): Promise<string>;
}

interface TelephonyModule {
  getRecentCalls(limit: number): Promise<unknown[]>;
  getRecentSms(limit: number): Promise<unknown[]>;
  call(number: string): Promise<boolean>;
}

interface DeviceModule {
  startForegroundService(brainUrl: string, authToken: string): Promise<boolean>;
  stopForegroundService(): Promise<boolean>;
  openApp(packageName: string): Promise<boolean>;
  openAccessibilitySettings(): void;
  openNotificationSettings(): void;
  openBatterySettings(): void;
  getPermissionStatus(): Promise<PermissionStatus>;
  getDeviceProfile(): Promise<DeviceProfile>;
}

export const JarvisAccessibility = NativeModules.JarvisAccessibility as AccessibilityModule;
export const JarvisTelephony = NativeModules.JarvisTelephony as TelephonyModule;
export const JarvisDevice = NativeModules.JarvisDevice as DeviceModule;
