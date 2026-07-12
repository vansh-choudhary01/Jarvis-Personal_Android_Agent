import {DeviceEventEmitter} from 'react-native';
import registry from './modelRegistry.json';
import {JarvisLocalAiRuntime, type DeviceProfile, type NativeRuntimeDiagnostics} from './native';

export type RuntimeProvider =
  | 'auto'
  | 'mediapipe'
  | 'mlc-llm'
  | 'llama.cpp'
  | 'executorch'
  | 'qualcomm-ai-engine'
  | 'google-ai-edge'
  | 'unknown';

export type CapabilityScore = 'Low' | 'Medium' | 'High' | 'Ultra';
export type ModelInstallStatus =
  | 'not_installed'
  | 'needs_license_acceptance'
  | 'downloading'
  | 'paused'
  | 'installing'
  | 'benchmarking'
  | 'ready'
  | 'loading'
  | 'loaded'
  | 'running'
  | 'corrupted'
  | 'unsupported'
  | 'missing'
  | 'invalid_model'
  | 'failed';

export interface RuntimeDetection {
  provider: RuntimeProvider;
  available: boolean;
  reason: string;
}

export interface ModelDefinition {
  id: string;
  displayName: string;
  family: string;
  version: string;
  provider: string;
  parameters: string;
  quantization: string;
  runtime: RuntimeProvider;
  format: 'task' | 'litertlm';
  downloadUrl: string;
  modelPageUrl: string;
  licenseRequired: boolean;
  fileName: string;
  checksumSha256: string;
  downloadSizeGB: number;
  installedSizeGB: number;
  minRamGB: number;
  recommendedRamGB: number;
  recommendedCpuClass: string;
  contextLength: number;
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  supportsOffline: boolean;
  recommendedFor: string[];
}

export interface ModelRecommendation {
  model: ModelDefinition;
  runtime: RuntimeProvider;
  score: CapabilityScore;
  reason: string;
  estimatedMemoryGB: number;
  estimatedPerformance: string;
  estimatedStorageGB: number;
}

export interface InstalledModel {
  modelId: string;
  status: ModelInstallStatus;
  progress: number;
  active: boolean;
  installedSizeGB: number;
  downloadedBytes: number;
  totalBytes: number;
  format?: string;
  storagePath?: string;
  importedFileName?: string;
  benchmark?: ModelBenchmark;
  error?: string;
}

export interface ModelBenchmark {
  loadTimeMs: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
  peakRamBytes: number;
  currentRamBytes: number;
  backend: string;
  initializationTimeMs: number;
  generatedTokens: number;
  validatedAt: string;
}

export interface RuntimeSettings {
  automaticSelection: boolean;
  runtime: RuntimeProvider;
  modelId: string | 'auto';
  allowLargerModels: boolean;
  preferFasterModels: boolean;
  preferHigherAccuracy: boolean;
  allowCloudFallback: boolean;
}

export interface RuntimeDiagnostics {
  provider: RuntimeProvider;
  currentModel: string;
  contextLength: number;
  inferenceDevice: string;
  accelerator: string;
  memoryUsageGB: number;
  peakMemoryGB: number;
  modelSizeGB: number;
  promptTokens: number;
  generatedTokens: number;
  generationSpeedTokPerSec: number;
  plannerMode: string;
  temperature: number;
  loaded: boolean;
  hardwareAccelerationStatus: string;
  cpuUsage: string;
  timeToFirstTokenMs: number;
  loadTimeMs: number;
  initializationTimeMs: number;
  backend: string;
  modelFormat: string;
  storagePath: string;
  streamingEnabled: boolean;
}

export interface GenerationRequest {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerationResult {
  text: string;
  modelId: string;
  provider: RuntimeProvider;
  tokensGenerated: number;
}

export interface ModelRuntime {
  initialize(profile: DeviceProfile): Promise<void>;
  loadModel(model?: ModelDefinition): Promise<void>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  stream(request: GenerationRequest): AsyncGenerator<string>;
  cancel(): Promise<void>;
  unload(): Promise<void>;
  dispose(): Promise<void>;
  getActiveModel(): ModelDefinition | null;
  isLoaded(): Promise<boolean>;
  supportsVision(): boolean;
  supportsToolCalling(): boolean;
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  automaticSelection: true,
  runtime: 'auto',
  modelId: 'auto',
  allowLargerModels: false,
  preferFasterModels: true,
  preferHigherAccuracy: false,
  allowCloudFallback: false,
};

export const MODEL_REGISTRY = registry as ModelDefinition[];

export function ramGB(profile: DeviceProfile): number {
  return profile.ramMB / 1024;
}

export function computeCapabilityScore(profile: DeviceProfile): CapabilityScore {
  const ram = ramGB(profile);
  const arm64 = profile.abi.includes('64') || profile.architecture.includes('64');

  if (ram >= 16 && profile.cpuCores >= 8) return 'Ultra';
  if (ram >= 11.5 && profile.cpuCores >= 8 && arm64) return 'High';
  if (ram >= 6 && profile.cpuCores >= 6 && arm64) return 'Medium';
  return 'Low';
}

export function detectRuntimeProviders(profile: DeviceProfile): RuntimeDetection[] {
  const arm64 = profile.abi.includes('arm64') || profile.architecture.includes('aarch64');
  const mediaPipeCandidate = profile.sdk >= 26 && arm64;

  return [
    {
      provider: 'mediapipe',
      available: mediaPipeCandidate,
      reason: mediaPipeCandidate
        ? 'MediaPipe runtime is packaged and can use the best supported Android backend at load time.'
        : 'MediaPipe runtime is not available on this device. Requires Android 8+ on arm64.',
    },
    {
      provider: 'mlc-llm',
      available: false,
      reason: 'Future provider placeholder. No MLC LLM adapter is bundled yet.',
    },
    {
      provider: 'llama.cpp',
      available: false,
      reason: 'Future provider placeholder. No llama.cpp adapter is bundled yet.',
    },
    {
      provider: 'executorch',
      available: false,
      reason: 'Future provider placeholder. No ExecuTorch adapter is bundled yet.',
    },
    {
      provider: 'qualcomm-ai-engine',
      available: false,
      reason: 'Future provider placeholder. Hardware acceleration remains hidden behind the runtime abstraction.',
    },
  ];
}

export function compatibleModels(profile: DeviceProfile, allowLargerModels = false): ModelDefinition[] {
  const ram = ramGB(profile);
  return MODEL_REGISTRY.filter(model => {
    if (model.runtime !== 'mediapipe') return false;
    if (!allowLargerModels && model.minRamGB > ram) return false;
    return model.installedSizeGB * 1024 < profile.storageAvailableMB;
  });
}

export function recommendModel(
  profile: DeviceProfile,
  settings: RuntimeSettings = DEFAULT_RUNTIME_SETTINGS,
): ModelRecommendation {
  const score = computeCapabilityScore(profile);
  const ram = ramGB(profile);
  const candidates = compatibleModels(profile, settings.allowLargerModels);
  const fallback = candidates[0] ?? MODEL_REGISTRY[0]!;
  const pickById = (id: string) => candidates.find(model => model.id === id) ?? fallback;

  let model: ModelDefinition;
  if (settings.modelId !== 'auto') {
    model = MODEL_REGISTRY.find(item => item.id === settings.modelId) ?? fallback;
  } else if (ram < 5) {
    model = pickById('gemma-3-1b-it-mediapipe-task');
  } else if (ram < 8) {
    model = pickById('gemma-3-1b-it-mediapipe-task');
  } else if (ram < 12) {
    model = settings.preferHigherAccuracy && !settings.preferFasterModels
      ? pickById('gemma-3n-e2b-it-litertlm')
      : pickById('gemma-3-1b-it-mediapipe-task');
  } else {
    model = settings.preferHigherAccuracy
      ? pickById('gemma-3n-e4b-it-litertlm')
      : pickById('gemma-3n-e2b-it-litertlm');
  }

  const runtime = settings.runtime === 'auto' ? 'mediapipe' : settings.runtime;
  return {
    model,
    runtime,
    score,
    reason: `Selected from official MediaPipe/LiteRT-compatible models for ${Math.round(ram)} GB RAM, ${profile.cpuCores} CPU cores, ${score.toLowerCase()} capability, model size, and ${settings.preferFasterModels ? 'faster response preference' : 'quality preference'}. Jarvis will refine this after the first benchmark.`,
    estimatedMemoryGB: Math.round(model.installedSizeGB * 0.78 * 10) / 10,
    estimatedPerformance: score === 'Low' ? 'Usable for short responses' : score === 'Medium' ? 'Balanced offline chat' : 'Good offline automation latency',
    estimatedStorageGB: model.installedSizeGB,
  };
}

export function refineRecommendationWithBenchmarks(
  recommendation: ModelRecommendation,
  installed: InstalledModel[],
): ModelRecommendation {
  const benchmarked = installed.find(item => item.modelId === recommendation.model.id && item.benchmark);
  if (!benchmarked?.benchmark || benchmarked.benchmark.tokensPerSecond >= 4) return recommendation;

  const smaller = MODEL_REGISTRY
    .filter(model => model.runtime === 'mediapipe' && model.installedSizeGB < recommendation.model.installedSizeGB)
    .sort((a, b) => b.installedSizeGB - a.installedSizeGB)[0];
  if (!smaller) return recommendation;

  return {
    ...recommendation,
    model: smaller,
    reason: `${recommendation.reason} Previous benchmark was slow (${benchmarked.benchmark.tokensPerSecond.toFixed(1)} tok/s), so Jarvis suggests the smaller ${smaller.displayName}.`,
    estimatedStorageGB: smaller.installedSizeGB,
    estimatedMemoryGB: Math.round(smaller.installedSizeGB * 0.78 * 10) / 10,
    estimatedPerformance: 'Adjusted after benchmark: prefer smaller model for usable latency',
  };
}

function modelPayload(model: ModelDefinition) {
  return {
    ...model,
    expectedSizeBytes: Math.round(model.downloadSizeGB * 1024 * 1024 * 1024),
  };
}

function nativeStateToInstalled(value: any): InstalledModel {
  let benchmark: ModelBenchmark | undefined;
  if (value.benchmarkJson) {
    try {
      benchmark = JSON.parse(String(value.benchmarkJson)) as ModelBenchmark;
    } catch {
      benchmark = undefined;
    }
  }
  return {
    modelId: String(value.modelId),
    status: String(value.status ?? 'not_installed') as ModelInstallStatus,
    progress: Number(value.progress ?? 0),
    active: Boolean(value.active),
    installedSizeGB: Number(value.installedSizeBytes ?? 0) / 1024 / 1024 / 1024,
    downloadedBytes: Number(value.downloadedBytes ?? 0),
    totalBytes: Number(value.totalBytes ?? 0),
    format: value.format ? String(value.format) : undefined,
    storagePath: value.storagePath ? String(value.storagePath) : undefined,
    importedFileName: value.importedFileName ? String(value.importedFileName) : undefined,
    benchmark,
    error: value.error ? String(value.error) : undefined,
  };
}

class NativeModelManager {
  async listInstalled(): Promise<InstalledModel[]> {
    const rows = await JarvisLocalAiRuntime.listInstalledModels();
    return rows.map(nativeStateToInstalled);
  }

  async getModelState(modelId: string): Promise<InstalledModel> {
    return nativeStateToInstalled(await JarvisLocalAiRuntime.getModelState(modelId));
  }

  async getStorageUsageGB(): Promise<number> {
    return (await JarvisLocalAiRuntime.getStorageUsageBytes()) / 1024 / 1024 / 1024;
  }

  async install(model: ModelDefinition): Promise<InstalledModel> {
    await JarvisLocalAiRuntime.downloadModel(modelPayload(model));
    return this.getModelState(model.id);
  }

  async isHuggingFaceTokenConfigured(): Promise<boolean> {
    return JarvisLocalAiRuntime.getHuggingFaceTokenConfigured();
  }

  async setHuggingFaceToken(token: string): Promise<void> {
    await JarvisLocalAiRuntime.setHuggingFaceToken(token);
  }

  async clearHuggingFaceToken(): Promise<void> {
    await JarvisLocalAiRuntime.clearHuggingFaceToken();
  }

  async openModelPage(model: ModelDefinition): Promise<void> {
    if (!model.modelPageUrl) throw new Error('No official model page is configured.');
    await JarvisLocalAiRuntime.openModelPage(model.modelPageUrl);
  }

  async importFromPicker(model: ModelDefinition): Promise<InstalledModel> {
    return nativeStateToInstalled(await JarvisLocalAiRuntime.importModelFromPicker(modelPayload(model)));
  }

  async pauseDownload(modelId: string): Promise<InstalledModel> {
    await JarvisLocalAiRuntime.pauseDownload(modelId);
    return this.getModelState(modelId);
  }

  async resumeDownload(model: ModelDefinition): Promise<InstalledModel> {
    await JarvisLocalAiRuntime.resumeDownload(modelPayload(model));
    return this.getModelState(model.id);
  }

  async cancelDownload(modelId: string): Promise<InstalledModel> {
    await JarvisLocalAiRuntime.cancelDownload(modelId);
    return this.getModelState(modelId);
  }

  async deleteModel(modelId: string): Promise<void> {
    await JarvisLocalAiRuntime.deleteModel(modelId);
  }

  async switchActiveModel(modelId: string): Promise<InstalledModel> {
    await JarvisLocalAiRuntime.setActiveModel(modelId);
    return this.getModelState(modelId);
  }
}

export const modelManager = new NativeModelManager();

export class MediaPipeRuntime implements ModelRuntime {
  private activeModel: ModelDefinition | null = null;
  private profile: DeviceProfile | null = null;

  async initialize(profile: DeviceProfile): Promise<void> {
    this.profile = profile;
    const detection = await JarvisLocalAiRuntime.detectMediaPipe();
    if (!detection.available) {
      throw new Error(detection.reason);
    }
    this.activeModel = recommendModel(profile).model;
    const activeId = await JarvisLocalAiRuntime.getActiveModelId();
    if (activeId) this.activeModel = MODEL_REGISTRY.find(model => model.id === activeId) ?? this.activeModel;
  }

  async loadModel(model = this.activeModel ?? undefined): Promise<void> {
    if (!model) throw new Error('No local model selected.');
    await JarvisLocalAiRuntime.loadModel(modelPayload(model), model.contextLength, 0.3);
    this.activeModel = model;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.activeModel && this.profile) this.activeModel = recommendModel(this.profile).model;
    if (!this.activeModel) throw new Error('No active local model.');
    const result = await JarvisLocalAiRuntime.generate(
      request.prompt,
      request.maxTokens ?? 512,
      request.temperature ?? 0.3,
    );
    return {
      text: result.text,
      modelId: result.modelId || this.activeModel.id,
      provider: 'mediapipe',
      tokensGenerated: result.tokensGenerated ?? estimateTokens(result.text),
    };
  }

  async *stream(request: GenerationRequest): AsyncGenerator<string> {
    const queue: string[] = [];
    let done = false;
    let error: Error | null = null;
    let wake: (() => void) | null = null;
    const wakeNext = () => {
      wake?.();
      wake = null;
    };
    const tokenSub = DeviceEventEmitter.addListener('local_ai_token', event => {
      if (!event?.text) return;
      queue.push(String(event.text));
      wakeNext();
    });
    const doneSub = DeviceEventEmitter.addListener('local_ai_done', () => {
      done = true;
      wakeNext();
    });
    const errorSub = DeviceEventEmitter.addListener('local_ai_error', event => {
      error = new Error(String(event?.message ?? 'Local generation failed.'));
      done = true;
      wakeNext();
    });

    try {
      JarvisLocalAiRuntime.stream(request.prompt, request.maxTokens ?? 512, request.temperature ?? 0.3).catch((err: unknown) => {
        error = err instanceof Error ? err : new Error(String(err));
        done = true;
        wakeNext();
      });
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>(resolve => {
            wake = resolve;
          });
        }
      }
      if (error) throw error;
    } finally {
      tokenSub.remove();
      doneSub.remove();
      errorSub.remove();
    }
  }

  async cancel(): Promise<void> {
    await JarvisLocalAiRuntime.cancel();
  }

  async unload(): Promise<void> {
    await JarvisLocalAiRuntime.unload();
  }

  async dispose(): Promise<void> {
    await JarvisLocalAiRuntime.dispose();
    this.activeModel = null;
  }

  getActiveModel(): ModelDefinition | null {
    return this.activeModel;
  }

  async isLoaded(): Promise<boolean> {
    return JarvisLocalAiRuntime.isLoaded();
  }

  supportsVision(): boolean {
    return this.activeModel?.supportsVision ?? false;
  }

  supportsToolCalling(): boolean {
    return this.activeModel?.supportsToolCalling ?? false;
  }
}

export async function getRuntimeDiagnostics(recommendation: ModelRecommendation): Promise<RuntimeDiagnostics> {
  const native = await JarvisLocalAiRuntime.getDiagnostics();
  return diagnosticsFromNative(native, recommendation);
}

export function diagnosticsFromNative(
  native: NativeRuntimeDiagnostics,
  recommendation: ModelRecommendation,
): RuntimeDiagnostics {
  return {
    provider: 'mediapipe',
    currentModel: native.currentModel || recommendation.model.displayName,
    contextLength: native.contextLength || recommendation.model.contextLength,
    inferenceDevice: native.inferenceDevice || 'Auto',
    accelerator: native.accelerator || 'Runtime selected',
    memoryUsageGB: roundGB(native.memoryUsageBytes),
    peakMemoryGB: roundGB(native.peakMemoryBytes),
    modelSizeGB: roundGB(native.modelSizeBytes) || recommendation.model.installedSizeGB,
    promptTokens: native.promptTokens ?? 0,
    generatedTokens: native.generatedTokens ?? 0,
    generationSpeedTokPerSec: native.generationSpeedTokPerSec ?? 0,
    plannerMode: 'Planner will use ModelRuntime.generate only',
    temperature: native.temperature ?? 0.3,
    loaded: Boolean(native.loaded),
    hardwareAccelerationStatus: native.hardwareAccelerationStatus || 'Automatic backend selection',
    cpuUsage: native.cpuUsage || 'Unavailable',
    timeToFirstTokenMs: native.timeToFirstTokenMs ?? 0,
    loadTimeMs: native.loadTimeMs ?? 0,
    initializationTimeMs: native.initializationTimeMs ?? native.loadTimeMs ?? 0,
    backend: native.backend || native.inferenceDevice || 'Auto',
    modelFormat: native.modelFormat || recommendation.model.format,
    storagePath: native.storagePath || '',
    streamingEnabled: native.streamingEnabled ?? recommendation.model.supportsStreaming,
  };
}

export function createPlaceholderDiagnostics(recommendation: ModelRecommendation): RuntimeDiagnostics {
  return diagnosticsFromNative({} as NativeRuntimeDiagnostics, recommendation);
}

function estimateTokens(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function roundGB(bytes?: number): number {
  if (!bytes) return 0;
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}
