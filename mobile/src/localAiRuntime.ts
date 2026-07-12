import type {DeviceProfile} from './native';

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
export type ModelInstallStatus = 'not_installed' | 'queued' | 'downloading' | 'paused' | 'installed' | 'failed';

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
  downloadUrl: string;
  downloadSizeGB: number;
  installedSizeGB: number;
  minRamGB: number;
  recommendedRamGB: number;
  recommendedCpuClass: string;
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
}

export interface InstalledModel {
  modelId: string;
  status: ModelInstallStatus;
  progress: number;
  active: boolean;
  installedSizeGB: number;
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
  generate(request: GenerationRequest): Promise<GenerationResult>;
  stream(request: GenerationRequest): AsyncGenerator<string>;
  cancel(): Promise<void>;
  unload(): Promise<void>;
  getActiveModel(): ModelDefinition | null;
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  automaticSelection: true,
  runtime: 'auto',
  modelId: 'auto',
  allowLargerModels: false,
  preferFasterModels: true,
  preferHigherAccuracy: false,
  allowCloudFallback: true,
};

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: 'gemma-3-1b-q4',
    displayName: 'Gemma 3 1B (Q4)',
    family: 'Gemma',
    version: '3',
    provider: 'Google',
    parameters: '1B',
    quantization: 'Q4',
    runtime: 'google-ai-edge',
    downloadUrl: 'https://huggingface.co/google/gemma-3-1b-it',
    downloadSizeGB: 0.9,
    installedSizeGB: 1.1,
    minRamGB: 3.5,
    recommendedRamGB: 4,
    recommendedCpuClass: 'mobile-low',
    supportsVision: false,
    supportsToolCalling: false,
    supportsReasoning: false,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['4 GB phones', 'fast offline chat', 'classification'],
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b-q4',
    displayName: 'DeepSeek-R1 Distill Qwen 1.5B (Q4)',
    family: 'DeepSeek-R1 Distill',
    version: '1.5B',
    provider: 'DeepSeek',
    parameters: '1.5B',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    downloadUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    downloadSizeGB: 1.1,
    installedSizeGB: 1.4,
    minRamGB: 4,
    recommendedRamGB: 4,
    recommendedCpuClass: 'mobile-low',
    supportsVision: false,
    supportsToolCalling: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['small reasoning tasks', '4 GB phones', 'offline summaries'],
  },
  {
    id: 'qwen3-4b-q4',
    displayName: 'Qwen 3 4B (Q4)',
    family: 'Qwen',
    version: '3',
    provider: 'Alibaba Cloud',
    parameters: '4B',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF',
    downloadSizeGB: 2.4,
    installedSizeGB: 2.7,
    minRamGB: 6,
    recommendedRamGB: 8,
    recommendedCpuClass: 'mobile-mid',
    supportsVision: false,
    supportsToolCalling: true,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['balanced phone automation', 'tool calling', 'offline chat'],
  },
  {
    id: 'deepseek-r1-distill-qwen-7b-q4',
    displayName: 'DeepSeek-R1 Distill Qwen 7B (Q4)',
    family: 'DeepSeek-R1 Distill',
    version: '7B',
    provider: 'DeepSeek',
    parameters: '7B',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    downloadUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    downloadSizeGB: 4.1,
    installedSizeGB: 4.7,
    minRamGB: 8,
    recommendedRamGB: 10,
    recommendedCpuClass: 'mobile-high',
    supportsVision: false,
    supportsToolCalling: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['reasoning-heavy tasks', 'high-RAM phones'],
  },
  {
    id: 'qwen3-8b-q4',
    displayName: 'Qwen 3 8B (Q4)',
    family: 'Qwen',
    version: '3',
    provider: 'Alibaba Cloud',
    parameters: '8B',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF',
    downloadSizeGB: 4.8,
    installedSizeGB: 5.4,
    minRamGB: 10,
    recommendedRamGB: 12,
    recommendedCpuClass: 'mobile-high',
    supportsVision: false,
    supportsToolCalling: true,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['12 GB phones', 'better planning quality', 'tool calling'],
  },
  {
    id: 'deepseek-r1-distill-llama-8b-q4',
    displayName: 'DeepSeek-R1 Distill Llama 8B (Q4)',
    family: 'DeepSeek-R1 Distill',
    version: '8B',
    provider: 'DeepSeek',
    parameters: '8B',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    downloadUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    downloadSizeGB: 4.9,
    installedSizeGB: 5.5,
    minRamGB: 10,
    recommendedRamGB: 12,
    recommendedCpuClass: 'mobile-high',
    supportsVision: false,
    supportsToolCalling: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['reasoning-heavy tasks', '12 GB phones'],
  },
  {
    id: 'qwen3-14b-q4',
    displayName: 'Qwen 3 14B (Q4)',
    family: 'Qwen',
    version: '3',
    provider: 'Alibaba Cloud',
    parameters: '14B',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen3-14B-GGUF',
    downloadSizeGB: 8.2,
    installedSizeGB: 9.0,
    minRamGB: 16,
    recommendedRamGB: 24,
    recommendedCpuClass: 'desktop',
    supportsVision: false,
    supportsToolCalling: true,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsOffline: true,
    recommendedFor: ['desktop devices', 'larger context tasks', 'advanced automation'],
  },
];

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
  const enoughStorage = profile.storageAvailableMB > 1024;

  return [
    {
      provider: 'google-ai-edge',
      available: false,
      reason: profile.sdk >= 26 && arm64 ? 'Compatible target, but the Google AI Edge adapter is not bundled yet.' : 'Requires a modern 64-bit Android device.',
    },
    {
      provider: 'mediapipe',
      available: false,
      reason: profile.sdk >= 26 && arm64 ? 'Compatible target, but the MediaPipe runtime binary is not bundled yet.' : 'Requires Android 8+ on arm64.',
    },
    {
      provider: 'llama.cpp',
      available: false,
      reason: arm64 && enoughStorage ? 'Compatible target, but llama.cpp native libraries are not bundled yet.' : 'Requires arm64 and enough free storage for model files.',
    },
    {
      provider: 'mlc-llm',
      available: false,
      reason: profile.supportsGPUAcceleration ? 'GPU-capable target, but MLC runtime packaging is not bundled yet.' : 'GPU acceleration was not detected.',
    },
    {
      provider: 'executorch',
      available: false,
      reason: 'Future provider placeholder. No ExecuTorch adapter is bundled yet.',
    },
    {
      provider: 'qualcomm-ai-engine',
      available: false,
      reason: profile.supportsNPUAcceleration ? 'Possible accelerator detected, but Qualcomm AI Engine integration is not bundled yet.' : 'No detectable Qualcomm/NPU feature was exposed by Android.',
    },
  ];
}

export function compatibleModels(profile: DeviceProfile, allowLargerModels = false): ModelDefinition[] {
  const ram = ramGB(profile);
  return MODEL_REGISTRY.filter(model => {
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
    model = settings.preferHigherAccuracy ? pickById('deepseek-r1-distill-qwen-1.5b-q4') : pickById('gemma-3-1b-q4');
  } else if (ram < 10) {
    model = settings.preferHigherAccuracy && !settings.preferFasterModels ? pickById('deepseek-r1-distill-qwen-7b-q4') : pickById('qwen3-4b-q4');
  } else if (ram < 16) {
    model = settings.preferHigherAccuracy ? pickById('deepseek-r1-distill-llama-8b-q4') : pickById('qwen3-8b-q4');
  } else {
    model = pickById('qwen3-14b-q4');
  }

  return {
    model,
    runtime: settings.runtime === 'auto' ? model.runtime : settings.runtime,
    score,
    reason: `Selected for ${Math.round(ram)} GB RAM, ${profile.cpuCores} CPU cores, ${score.toLowerCase()} capability, and ${settings.preferFasterModels ? 'faster response preference' : 'quality preference'}.`,
    estimatedMemoryGB: Math.round(model.installedSizeGB * 0.78 * 10) / 10,
  };
}

class LocalModelManager {
  private installed = new Map<string, InstalledModel>();
  private activeModelId: string | null = null;

  listInstalled(): InstalledModel[] {
    return Array.from(this.installed.values());
  }

  getModelState(modelId: string): InstalledModel {
    return this.installed.get(modelId) ?? {
      modelId,
      status: 'not_installed',
      progress: 0,
      active: false,
      installedSizeGB: 0,
    };
  }

  getStorageUsageGB(): number {
    return this.listInstalled().reduce((total, item) => total + item.installedSizeGB, 0);
  }

  beginDownload(modelId: string): InstalledModel {
    const model = MODEL_REGISTRY.find(item => item.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    const state: InstalledModel = {
      modelId,
      status: 'queued',
      progress: 0,
      active: false,
      installedSizeGB: 0,
    };
    this.installed.set(modelId, state);
    return state;
  }

  pauseDownload(modelId: string): InstalledModel {
    return this.patch(modelId, {status: 'paused'});
  }

  resumeDownload(modelId: string): InstalledModel {
    return this.patch(modelId, {status: 'queued'});
  }

  deleteModel(modelId: string): void {
    this.installed.delete(modelId);
    if (this.activeModelId === modelId) this.activeModelId = null;
  }

  switchActiveModel(modelId: string): InstalledModel {
    const current = this.getModelState(modelId);
    if (current.status !== 'installed') throw new Error('Model is not installed yet.');
    this.installed.forEach(value => {
      value.active = false;
    });
    current.active = true;
    this.activeModelId = modelId;
    this.installed.set(modelId, current);
    return current;
  }

  private patch(modelId: string, patch: Partial<InstalledModel>): InstalledModel {
    const next = {...this.getModelState(modelId), ...patch};
    this.installed.set(modelId, next);
    return next;
  }
}

export const modelManager = new LocalModelManager();

export class LocalAiRuntime implements ModelRuntime {
  private activeModel: ModelDefinition | null = null;

  async initialize(profile: DeviceProfile): Promise<void> {
    this.activeModel = recommendModel(profile).model;
  }

  async generate(): Promise<GenerationResult> {
    throw new Error('Local inference is not available until a runtime provider adapter is bundled.');
  }

  async *stream(): AsyncGenerator<string> {
    throw new Error('Local streaming is not available until a runtime provider adapter is bundled.');
  }

  async cancel(): Promise<void> {
    return;
  }

  async unload(): Promise<void> {
    this.activeModel = null;
  }

  getActiveModel(): ModelDefinition | null {
    return this.activeModel;
  }
}

export function createPlaceholderDiagnostics(recommendation: ModelRecommendation): RuntimeDiagnostics {
  return {
    provider: recommendation.runtime,
    currentModel: recommendation.model.displayName,
    contextLength: 8192,
    inferenceDevice: 'Not loaded',
    accelerator: 'Detecting',
    memoryUsageGB: 0,
    peakMemoryGB: 0,
    modelSizeGB: recommendation.model.installedSizeGB,
    promptTokens: 0,
    generatedTokens: 0,
    generationSpeedTokPerSec: 0,
    plannerMode: 'Cloud planner remains active until local runtime provider is installed',
    temperature: 0.3,
  };
}
