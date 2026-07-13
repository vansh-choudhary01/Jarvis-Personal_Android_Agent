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
  listApps(): Promise<Array<{label: string; packageName: string}>>;
  openAccessibilitySettings(): void;
  openNotificationSettings(): void;
  openBatterySettings(): void;
  getPermissionStatus(): Promise<PermissionStatus>;
  getDeviceProfile(): Promise<DeviceProfile>;
}

export interface NativeInstalledModel {
  modelId: string;
  status: string;
  progress: number;
  active: boolean;
  installedSizeBytes: number;
  downloadedBytes: number;
  totalBytes: number;
  format?: string;
  storagePath?: string;
  benchmarkJson?: string;
  importedFileName?: string;
  error?: string;
}

export interface NativeRuntimeDiagnostics {
  provider?: string;
  currentModel?: string;
  contextLength?: number;
  inferenceDevice?: string;
  accelerator?: string;
  memoryUsageBytes?: number;
  peakMemoryBytes?: number;
  modelSizeBytes?: number;
  promptTokens?: number;
  generatedTokens?: number;
  generationSpeedTokPerSec?: number;
  temperature?: number;
  loaded?: boolean;
  hardwareAccelerationStatus?: string;
  cpuUsage?: string;
  timeToFirstTokenMs?: number;
  loadTimeMs?: number;
  initializationTimeMs?: number;
  backend?: string;
  modelFormat?: string;
  storagePath?: string;
  streamingEnabled?: boolean;
}

interface LocalAiRuntimeModule {
  detectMediaPipe(): Promise<{provider: string; available: boolean; reason: string}>;
  getActiveModelId(): Promise<string | null>;
  setActiveModel(modelId: string): Promise<boolean>;
  listInstalledModels(): Promise<NativeInstalledModel[]>;
  getModelState(modelId: string): Promise<NativeInstalledModel>;
  getStorageUsageBytes(): Promise<number>;
  downloadModel(model: Record<string, unknown>): Promise<boolean>;
  getHuggingFaceTokenConfigured(): Promise<boolean>;
  setHuggingFaceToken(token: string): Promise<boolean>;
  clearHuggingFaceToken(): Promise<boolean>;
  openModelPage(url: string): Promise<boolean>;
  importModelFromPicker(model: Record<string, unknown>): Promise<NativeInstalledModel>;
  pauseDownload(modelId: string): Promise<boolean>;
  resumeDownload(model: Record<string, unknown>): Promise<boolean>;
  cancelDownload(modelId: string): Promise<boolean>;
  deleteModel(modelId: string): Promise<boolean>;
  loadModel(model: Record<string, unknown>, maxTokens: number, temperature: number): Promise<boolean>;
  generate(prompt: string, maxTokens: number, temperature: number): Promise<{text: string; modelId: string; tokensGenerated: number}>;
  stream(prompt: string, maxTokens: number, temperature: number): Promise<boolean>;
  cancel(): Promise<boolean>;
  unload(): Promise<boolean>;
  dispose(): Promise<boolean>;
  isLoaded(): Promise<boolean>;
  getDiagnostics(): Promise<NativeRuntimeDiagnostics>;
}

export const JarvisAccessibility = NativeModules.JarvisAccessibility as AccessibilityModule;
export const JarvisTelephony = NativeModules.JarvisTelephony as TelephonyModule;
export const JarvisDevice = NativeModules.JarvisDevice as DeviceModule;
export const JarvisLocalAiRuntime = NativeModules.JarvisLocalAiRuntime as LocalAiRuntimeModule;
