import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {isJarvisConfigured, JARVIS_CONFIG} from './src/config';
import {JarvisController, type LogEntry} from './src/JarvisController';
import {JarvisAccessibility, JarvisDevice, type DeviceProfile, type PermissionStatus} from './src/native';
import {
  DEFAULT_RUNTIME_SETTINGS,
  MODEL_REGISTRY,
  computeCapabilityScore,
  createPlaceholderDiagnostics,
  detectRuntimeProviders,
  modelManager,
  recommendModel,
  type ModelDefinition,
  type RuntimeSettings,
} from './src/localAiRuntime';

const emptyStatus: PermissionStatus = {
  accessibility: false,
  notifications: false,
  batteryExempt: false,
  callLog: false,
  sms: false,
  callPhone: false,
  postNotifications: Number(Platform.Version) < 33,
};

function App(): React.JSX.Element {
  const [devMode, setDevMode] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTitlePress = () => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 800);
    if (tapCount.current >= 3) {
      tapCount.current = 0;
      setDevMode(v => !v);
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F1EA" />
      <Onboarding devMode={devMode} onTitlePress={onTitlePress} />
    </SafeAreaProvider>
  );
}

interface OnboardingProps {
  devMode: boolean;
  onTitlePress: () => void;
}

function Onboarding({devMode, onTitlePress}: OnboardingProps): React.JSX.Element {
  const [permissions, setPermissions] = useState<PermissionStatus>(emptyStatus);
  const [connection, setConnection] = useState('Not started');
  const [screen, setScreen] = useState<'setup' | 'runtime'>('setup');
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setPermissions(await JarvisDevice.getPermissionStatus());
      setDeviceProfile(await JarvisDevice.getDeviceProfile());
    } catch {
      setConnection('Native module unavailable — rebuild the Android app');
    }
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const unsubscribe = JarvisController.subscribe(setConnection);
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [refresh]);

  const ready = useMemo(
    () => Object.values(permissions).every(Boolean) && isJarvisConfigured,
    [permissions],
  );

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    JarvisController.start().catch(error => {
      started.current = false;
      setConnection(`Could not start: ${String(error)}`);
    });
  }, [ready]);

  const requestRuntimePermissions = async () => {
    const requested = [
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
    ];
    if (Number(Platform.Version) >= 33) requested.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    await PermissionsAndroid.requestMultiple(requested);
    await refresh();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>PERSONAL ANDROID AGENT</Text>
        <Pressable onPress={onTitlePress}>
          <Text style={styles.title}>Jarvis</Text>
        </Pressable>
        {devMode && (
          <View style={styles.devBadge}>
            <Text style={styles.devBadgeText}>DEV MODE</Text>
          </View>
        )}
        <Text style={styles.intro}>
          Complete each one-time Android permission. Jarvis connects automatically when every item is ready.
        </Text>

        <View style={styles.tabRow}>
          <Pressable style={[styles.tabButton, screen === 'setup' && styles.tabButtonActive]} onPress={() => setScreen('setup')}>
            <Text style={[styles.tabText, screen === 'setup' && styles.tabTextActive]}>Setup</Text>
          </Pressable>
          <Pressable style={[styles.tabButton, screen === 'runtime' && styles.tabButtonActive]} onPress={() => setScreen('runtime')}>
            <Text style={[styles.tabText, screen === 'runtime' && styles.tabTextActive]}>AI Runtime</Text>
          </Pressable>
        </View>

        {screen === 'setup' && !isJarvisConfigured && (
          <View style={styles.configCard}>
            <Text style={styles.configTitle}>Configure the brain first</Text>
            <Text style={styles.configText}>
              Edit src/config.ts and replace the WebSocket URL and phone token. Current URL: {JARVIS_CONFIG.brainWebSocketUrl}
            </Text>
          </View>
        )}

        {screen === 'setup' ? (
          <>
        <View style={styles.list}>
          <ChecklistRow
            number="01"
            title="Accessibility control"
            detail="Read node trees and perform taps, typing, and swipes."
            complete={permissions.accessibility}
            onPress={() => JarvisDevice.openAccessibilitySettings()}
          />
          <ChecklistRow
            number="02"
            title="Notification access"
            detail="Relay incoming notification title and text to the brain."
            complete={permissions.notifications}
            onPress={() => JarvisDevice.openNotificationSettings()}
          />
          <ChecklistRow
            number="03"
            title="Call, SMS, and alerts"
            detail="Grant call-log, SMS, calling, and notification permissions."
            complete={permissions.callLog && permissions.sms && permissions.callPhone && permissions.postNotifications}
            onPress={requestRuntimePermissions}
          />
          <ChecklistRow
            number="04"
            title="Battery exemption"
            detail="Choose Jarvis and allow unrestricted background use."
            complete={permissions.batteryExempt}
            onPress={() => JarvisDevice.openBatterySettings()}
          />
        </View>

        <View style={styles.connectionCard}>
          <View style={[styles.dot, ready && styles.dotReady]} />
          <View style={styles.connectionCopy}>
            <Text style={styles.connectionLabel}>CONNECTION</Text>
            <Text style={styles.connectionValue}>{connection}</Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={refresh}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={styles.note}>
          Jarvis cannot read FLAG_SECURE screens, unlock the phone, or complete biometric/PIN prompts. The ongoing notification is required by Android.
        </Text>
          </>
        ) : (
          <RuntimeSettingsScreen profile={deviceProfile} devMode={devMode} onRefresh={refresh} />
        )}

        {devMode && <DevScreen connection={connection} permissions={permissions} />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Dev Screen ──────────────────────────────────────────────────────────────

function RuntimeSettingsScreen({
  profile,
  devMode,
  onRefresh,
}: {
  profile: DeviceProfile | null;
  devMode: boolean;
  onRefresh: () => void | Promise<void>;
}): React.JSX.Element {
  const [settings, setSettings] = useState<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS);
  const [selectedModelId, setSelectedModelId] = useState(MODEL_REGISTRY[0]!.id);
  const [message, setMessage] = useState('');
  const [, refreshModels] = useState(0);
  const selectedModel = MODEL_REGISTRY.find(model => model.id === selectedModelId) ?? MODEL_REGISTRY[0]!;
  const detections = profile ? detectRuntimeProviders(profile) : [];
  const recommendation = profile ? recommendModel(profile, settings) : null;
  const diagnostics = recommendation ? createPlaceholderDiagnostics(recommendation) : null;

  const forceModelRefresh = () => refreshModels(value => value + 1);
  const patchSettings = (patch: Partial<RuntimeSettings>) => setSettings(value => ({...value, ...patch}));

  const runModelAction = (action: () => void, done: string) => {
    try {
      action();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      forceModelRefresh();
    }
  };

  if (!profile) {
    return (
      <View style={runtime.container}>
        <Text style={runtime.heading}>AI Runtime</Text>
        <Text style={runtime.body}>Device profile is not available yet. Rebuild and reopen the Android app if this stays empty.</Text>
        <Pressable style={runtime.primaryButton} onPress={onRefresh}>
          <Text style={runtime.primaryButtonText}>Refresh Device Profile</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={runtime.container}>
      <Text style={runtime.heading}>AI Runtime</Text>
      <Text style={runtime.body}>
        Local inference is scaffolded here. Provider binaries and real model downloads are intentionally not wired yet.
      </Text>

      <RuntimeSection title="Device Information">
        <RuntimeRow label="Device" value={`${profile.manufacturer} ${profile.model}`} />
        <RuntimeRow label="Android" value={`${profile.androidVersion} / SDK ${profile.sdk}`} />
        <RuntimeRow label="ABI" value={`${profile.abi} (${profile.architecture})`} />
        <RuntimeRow label="CPU" value={`${profile.cpuCores} cores`} />
        <RuntimeRow label="RAM" value={`${Math.round(profile.ramMB / 1024)} GB`} />
        <RuntimeRow label="Storage" value={`${Math.round(profile.storageAvailableMB / 1024)} GB free`} />
        <RuntimeRow label="Battery" value={`${profile.batteryState}, ${profile.batteryPercent}%`} />
        <RuntimeRow label="Thermal" value={profile.thermalStatus} />
        <RuntimeRow label="AI Capability" value={computeCapabilityScore(profile)} />
      </RuntimeSection>

      {recommendation && (
        <RuntimeSection title="Recommended Setup">
          <RuntimeRow label="Runtime" value={runtimeLabel(recommendation.runtime)} />
          <RuntimeRow label="Model" value={recommendation.model.displayName} />
          <RuntimeRow label="Reason" value={recommendation.reason} />
          <RuntimeRow label="Estimated Storage" value={`${recommendation.model.installedSizeGB} GB`} />
          <RuntimeRow label="Estimated Memory" value={`~${recommendation.estimatedMemoryGB} GB during inference`} />
          <Pressable
            style={runtime.primaryButton}
            onPress={() => {
              setSelectedModelId(recommendation.model.id);
              runModelAction(
                () => modelManager.beginDownload(recommendation.model.id),
                'Download queued. Real binary download is not implemented yet.',
              );
            }}>
            <Text style={runtime.primaryButtonText}>Prepare Download</Text>
          </Pressable>
        </RuntimeSection>
      )}

      <RuntimeSection title="Advanced Settings">
        <ToggleRow label="Automatic Selection" value={settings.automaticSelection} onPress={() => patchSettings({automaticSelection: !settings.automaticSelection})} />
        <RuntimeRow label="Runtime" value={settings.runtime === 'auto' ? 'Auto' : runtimeLabel(settings.runtime)} />
        <RuntimeRow label="Model" value={settings.modelId === 'auto' ? 'Auto' : settings.modelId} />
        <ToggleRow label="Allow Larger Models" value={settings.allowLargerModels} onPress={() => patchSettings({allowLargerModels: !settings.allowLargerModels})} />
        <ToggleRow label="Prefer Faster Models" value={settings.preferFasterModels} onPress={() => patchSettings({preferFasterModels: !settings.preferFasterModels})} />
        <ToggleRow label="Prefer Higher Accuracy" value={settings.preferHigherAccuracy} onPress={() => patchSettings({preferHigherAccuracy: !settings.preferHigherAccuracy})} />
        <ToggleRow label="Allow Cloud Fallback" value={settings.allowCloudFallback} onPress={() => patchSettings({allowCloudFallback: !settings.allowCloudFallback})} />
      </RuntimeSection>

      <RuntimeSection title="Runtime Detection">
        {detections.map(item => (
          <RuntimeRow
            key={item.provider}
            label={runtimeLabel(item.provider)}
            value={`${item.available ? 'Available' : 'Not installed'} - ${item.reason}`}
          />
        ))}
      </RuntimeSection>

      <RuntimeSection title="Installed Models">
        <RuntimeRow label="Storage Used" value={`${modelManager.getStorageUsageGB().toFixed(1)} GB`} />
        {MODEL_REGISTRY.map(model => {
          const state = modelManager.getModelState(model.id);
          return (
            <Pressable key={model.id} style={[runtime.modelCard, selectedModelId === model.id && runtime.modelCardActive]} onPress={() => setSelectedModelId(model.id)}>
              <View style={runtime.modelCardTop}>
                <Text style={runtime.modelTitle}>{model.displayName}</Text>
                <Text style={runtime.modelStatus}>{state.active ? 'Active' : statusLabel(state.status)}</Text>
              </View>
              <Text style={runtime.modelMeta}>{model.installedSizeGB} GB - {runtimeLabel(model.runtime)} - {model.parameters}</Text>
              <View style={runtime.modelActions}>
                <SmallAction label={state.status === 'paused' ? 'Resume' : 'Download'} onPress={() => runModelAction(
                  () => state.status === 'paused' ? modelManager.resumeDownload(model.id) : modelManager.beginDownload(model.id),
                  state.status === 'paused' ? 'Download resumed in the queue.' : 'Download queued. Real binary download is not implemented yet.',
                )} />
                <SmallAction label="Pause" onPress={() => runModelAction(() => modelManager.pauseDownload(model.id), 'Download paused.')} />
                <SmallAction label="Delete" danger onPress={() => runModelAction(() => modelManager.deleteModel(model.id), 'Model entry deleted and storage accounting cleared.')} />
                <SmallAction label="Switch" onPress={() => runModelAction(() => modelManager.switchActiveModel(model.id), 'Active model switched.')} />
              </View>
            </Pressable>
          );
        })}
        {!!message && <Text style={runtime.message}>{message}</Text>}
      </RuntimeSection>

      <ModelDetails model={selectedModel} />

      <RuntimeSection title="Benchmark">
        <RuntimeRow label="Prompt Evaluation" value="Pending runtime provider" />
        <RuntimeRow label="Token Generation" value="Pending runtime provider" />
        <RuntimeRow label="Memory Usage" value="Pending runtime provider" />
        <RuntimeRow label="Model Load Time" value="Pending runtime provider" />
        <RuntimeRow label="Time To First Token" value="Pending runtime provider" />
        <RuntimeRow label="Battery Impact" value="Pending runtime provider" />
        <Pressable style={[runtime.primaryButton, runtime.disabledButton]} disabled>
          <Text style={runtime.primaryButtonText}>Run Benchmark</Text>
        </Pressable>
      </RuntimeSection>

      {devMode && diagnostics && (
        <RuntimeSection title="Developer Diagnostics">
          <RuntimeRow label="Provider" value={runtimeLabel(diagnostics.provider)} />
          <RuntimeRow label="Current Model" value={diagnostics.currentModel} />
          <RuntimeRow label="Context Length" value={`${diagnostics.contextLength}`} />
          <RuntimeRow label="Inference Device" value={diagnostics.inferenceDevice} />
          <RuntimeRow label="Accelerator" value={diagnostics.accelerator} />
          <RuntimeRow label="Memory Usage" value={`${diagnostics.memoryUsageGB} GB`} />
          <RuntimeRow label="Peak Memory" value={`${diagnostics.peakMemoryGB} GB`} />
          <RuntimeRow label="Model Size" value={`${diagnostics.modelSizeGB} GB`} />
          <RuntimeRow label="Prompt Tokens" value={`${diagnostics.promptTokens}`} />
          <RuntimeRow label="Generated Tokens" value={`${diagnostics.generatedTokens}`} />
          <RuntimeRow label="Generation Speed" value={`${diagnostics.generationSpeedTokPerSec} tok/s`} />
          <RuntimeRow label="Planner" value={diagnostics.plannerMode} />
          <RuntimeRow label="Temperature" value={`${diagnostics.temperature}`} />
        </RuntimeSection>
      )}
    </View>
  );
}

function RuntimeSection({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  return (
    <View style={runtime.section}>
      <Text style={runtime.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function RuntimeRow({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View style={runtime.row}>
      <Text style={runtime.label}>{label}</Text>
      <Text style={runtime.value}>{value}</Text>
    </View>
  );
}

function ToggleRow({label, value, onPress}: {label: string; value: boolean; onPress: () => void}): React.JSX.Element {
  return (
    <Pressable style={runtime.row} onPress={onPress}>
      <Text style={runtime.label}>{label}</Text>
      <Text style={[runtime.value, value ? runtime.good : runtime.muted]}>{value ? 'Enabled' : 'Disabled'}</Text>
    </Pressable>
  );
}

function SmallAction({label, onPress, danger}: {label: string; onPress: () => void; danger?: boolean}): React.JSX.Element {
  return (
    <Pressable style={[runtime.smallButton, danger && runtime.dangerButton]} onPress={onPress}>
      <Text style={[runtime.smallButtonText, danger && runtime.dangerText]}>{label}</Text>
    </Pressable>
  );
}

function ModelDetails({model}: {model: ModelDefinition}): React.JSX.Element {
  return (
    <RuntimeSection title="Model Details">
      <RuntimeRow label="Model" value={model.displayName} />
      <RuntimeRow label="Family" value={model.family} />
      <RuntimeRow label="Parameters" value={model.parameters} />
      <RuntimeRow label="Quantization" value={model.quantization} />
      <RuntimeRow label="Runtime" value={runtimeLabel(model.runtime)} />
      <RuntimeRow label="Download Size" value={`${model.downloadSizeGB} GB`} />
      <RuntimeRow label="Installed Size" value={`${model.installedSizeGB} GB`} />
      <RuntimeRow label="Recommended RAM" value={`${model.recommendedRamGB} GB`} />
      <RuntimeRow label="Minimum RAM" value={`${model.minRamGB} GB`} />
      <RuntimeRow label="Supports" value={[
        model.supportsToolCalling ? 'Tool Calling' : '',
        model.supportsStreaming ? 'Streaming' : '',
        model.supportsOffline ? 'Offline' : '',
        model.supportsReasoning ? 'Reasoning' : '',
        model.supportsVision ? 'Vision' : '',
      ].filter(Boolean).join(', ') || 'Chat'} />
    </RuntimeSection>
  );
}

function runtimeLabel(value: string): string {
  if (value === 'mlc-llm') return 'MLC LLM';
  if (value === 'llama.cpp') return 'llama.cpp';
  if (value === 'google-ai-edge') return 'Google AI Edge';
  if (value === 'qualcomm-ai-engine') return 'Qualcomm AI Engine';
  return value.replace(/(^|-)([a-z])/g, (_, prefix: string, char: string) => `${prefix ? ' ' : ''}${char.toUpperCase()}`);
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
}

function DevScreen({connection, permissions}: {connection: string; permissions: PermissionStatus}): React.JSX.Element {
  const [instruction, setInstruction] = useState('');
  const [submitResult, setSubmitResult] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [nodeTree, setNodeTree] = useState('');
  const [nodeExpanded, setNodeExpanded] = useState(false);

  useEffect(() => JarvisController.subscribeLog(setLog), []);

  const refreshNodeTree = async () => {
    try {
      const raw = await JarvisAccessibility.getCurrentNodeTree();
      setNodeTree(raw);
    } catch (e) {
      setNodeTree(`Error: ${String(e)}`);
    }
  };

  const submitTask = async () => {
    if (!instruction.trim()) return;
    setSubmitResult('Sending…');
    try {
      const res = await fetch(`${JARVIS_CONFIG.brainWebSocketUrl.replace(/^ws/, 'http').replace('/phone', '')}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${JARVIS_CONFIG.phoneAuthToken}`,
        },
        body: JSON.stringify({instruction: instruction.trim()}),
      });
      const json = await res.json() as {taskId?: string; status?: string; error?: string};
      setSubmitResult(json.error ?? `Accepted — ${json.taskId}`);
    } catch (e) {
      setSubmitResult(`Failed: ${String(e)}`);
    }
  };

  const permRows = Object.entries(permissions) as [keyof PermissionStatus, boolean][];

  return (
    <View style={dev.container}>
      <Text style={dev.heading}>Developer</Text>

      {/* Connection */}
      <DevSection title="Connection">
        <DevRow label="Status" value={connection} />
        <DevRow label="URL" value={JARVIS_CONFIG.brainWebSocketUrl} />
      </DevSection>

      {/* Permissions */}
      <DevSection title="Permissions">
        {permRows.map(([key, val]) => (
          <DevRow key={key} label={key} value={val ? '✓ granted' : '✗ missing'} valueOk={val} />
        ))}
      </DevSection>

      {/* Send task */}
      <DevSection title="Send Task">
        <TextInput
          style={dev.input}
          placeholder="Enter instruction…"
          placeholderTextColor="#666"
          value={instruction}
          onChangeText={setInstruction}
          multiline
        />
        <Pressable style={dev.button} onPress={submitTask}>
          <Text style={dev.buttonText}>Submit</Text>
        </Pressable>
        {!!submitResult && <Text style={dev.mono}>{submitResult}</Text>}
      </DevSection>

      {/* Action log */}
      <DevSection title={`Action Log (last ${log.length})`}>
        {log.length === 0 && <Text style={dev.empty}>No entries yet.</Text>}
        {log.slice(0, 20).map((entry, i) => (
          <View key={i} style={dev.logRow}>
            <Text style={dev.logKind}>{entry.kind}</Text>
            <Text style={dev.logDetail} numberOfLines={2}>{entry.detail}</Text>
            <Text style={dev.logTs}>{new Date(entry.ts).toLocaleTimeString()}</Text>
          </View>
        ))}
      </DevSection>

      {/* Node tree */}
      <DevSection title="Node Tree">
        <Pressable style={dev.button} onPress={refreshNodeTree}>
          <Text style={dev.buttonText}>Capture</Text>
        </Pressable>
        {!!nodeTree && (
          <>
            <Pressable onPress={() => setNodeExpanded(v => !v)}>
              <Text style={dev.toggleLink}>{nodeExpanded ? 'Collapse ▲' : 'Expand ▼'}</Text>
            </Pressable>
            {nodeExpanded && <Text style={dev.mono}>{nodeTree}</Text>}
          </>
        )}
      </DevSection>
    </View>
  );
}

function DevSection({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  return (
    <View style={dev.section}>
      <Text style={dev.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DevRow({label, value, valueOk}: {label: string; value: string; valueOk?: boolean}): React.JSX.Element {
  return (
    <View style={dev.devRow}>
      <Text style={dev.devLabel}>{label}</Text>
      <Text style={[dev.devValue, valueOk === false && dev.devValueBad, valueOk === true && dev.devValueGood]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

// ─── Checklist row ────────────────────────────────────────────────────────────

interface ChecklistRowProps {
  number: string;
  title: string;
  detail: string;
  complete: boolean;
  onPress: () => void | Promise<void>;
}

function ChecklistRow({number, title, detail, complete, onPress}: ChecklistRowProps): React.JSX.Element {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={styles.number}>{number}</Text>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <View style={[styles.statusPill, complete && styles.statusPillComplete]}>
        <Text style={[styles.statusText, complete && styles.statusTextComplete]}>
          {complete ? 'Ready' : 'Open'}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: '#F4F1EA'},
  content: {paddingHorizontal: 22, paddingTop: 28, paddingBottom: 40},
  eyebrow: {fontSize: 11, letterSpacing: 2.1, color: '#746E62', fontWeight: '700'},
  title: {fontSize: 52, lineHeight: 58, color: '#171713', fontWeight: '300', marginTop: 5},
  devBadge: {alignSelf: 'flex-start', backgroundColor: '#2A4FD4', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6},
  devBadgeText: {fontSize: 10, color: '#fff', fontWeight: '700', letterSpacing: 1.2},
  intro: {fontSize: 16, lineHeight: 24, color: '#555047', marginTop: 12, maxWidth: 540},
  tabRow: {flexDirection: 'row', gap: 8, marginTop: 20, backgroundColor: '#E8E2D7', borderRadius: 12, padding: 4},
  tabButton: {flex: 1, borderRadius: 9, paddingVertical: 10, alignItems: 'center'},
  tabButtonActive: {backgroundColor: '#171713'},
  tabText: {fontSize: 13, color: '#665F54', fontWeight: '700'},
  tabTextActive: {color: '#F4F1EA'},
  configCard: {backgroundColor: '#E9DDC7', padding: 16, borderRadius: 14, marginTop: 24},
  configTitle: {fontSize: 15, fontWeight: '700', color: '#342E24'},
  configText: {fontSize: 13, lineHeight: 19, color: '#5E5445', marginTop: 5},
  list: {marginTop: 28, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#BBB4A7'},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#BBB4A7'},
  number: {width: 34, fontSize: 11, color: '#8A8377', fontVariant: ['tabular-nums']},
  rowCopy: {flex: 1, paddingRight: 12},
  rowTitle: {fontSize: 17, fontWeight: '600', color: '#24221D'},
  rowDetail: {fontSize: 13, lineHeight: 18, color: '#716B61', marginTop: 4},
  statusPill: {borderRadius: 99, backgroundColor: '#E3DED4', minWidth: 56, paddingVertical: 7, alignItems: 'center'},
  statusPillComplete: {backgroundColor: '#294D3B'},
  statusText: {fontSize: 11, color: '#665F54', fontWeight: '700'},
  statusTextComplete: {color: '#F2F5F0'},
  connectionCard: {flexDirection: 'row', alignItems: 'center', marginTop: 28, padding: 17, backgroundColor: '#171713', borderRadius: 16},
  dot: {width: 9, height: 9, borderRadius: 9, backgroundColor: '#8B534A'},
  dotReady: {backgroundColor: '#79AE87'},
  connectionCopy: {flex: 1, marginLeft: 12},
  connectionLabel: {fontSize: 9, letterSpacing: 1.4, color: '#999589'},
  connectionValue: {fontSize: 14, color: '#F4F1EA', marginTop: 3},
  refreshButton: {borderWidth: 1, borderColor: '#4B4941', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8},
  refreshText: {fontSize: 12, color: '#D9D4C9', fontWeight: '600'},
  note: {fontSize: 12, lineHeight: 18, color: '#777166', marginTop: 20},
});

const runtime = StyleSheet.create({
  container: {marginTop: 24},
  heading: {fontSize: 20, fontWeight: '700', color: '#171713'},
  body: {fontSize: 13, lineHeight: 20, color: '#5E584F', marginTop: 6},
  section: {marginTop: 18, backgroundColor: '#ECEAE3', borderRadius: 12, padding: 14},
  sectionTitle: {fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: '#746E62', marginBottom: 9},
  row: {flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#CCC7BC'},
  label: {fontSize: 12, color: '#5A554D', flex: 1},
  value: {fontSize: 12, color: '#24221D', flex: 1.7, textAlign: 'right', lineHeight: 17},
  good: {color: '#294D3B'},
  muted: {color: '#8A8377'},
  primaryButton: {marginTop: 12, backgroundColor: '#171713', borderRadius: 9, paddingVertical: 11, alignItems: 'center'},
  disabledButton: {opacity: 0.45},
  primaryButtonText: {color: '#F4F1EA', fontSize: 13, fontWeight: '700'},
  modelCard: {borderWidth: 1, borderColor: '#D1CABF', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#F8F5EF'},
  modelCardActive: {borderColor: '#2A4FD4'},
  modelCardTop: {flexDirection: 'row', justifyContent: 'space-between', gap: 12},
  modelTitle: {fontSize: 14, fontWeight: '700', color: '#24221D', flex: 1},
  modelStatus: {fontSize: 11, color: '#5A554D', fontWeight: '700'},
  modelMeta: {fontSize: 12, color: '#716B61', marginTop: 4},
  modelActions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10},
  smallButton: {borderWidth: 1, borderColor: '#BBB4A7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7},
  dangerButton: {borderColor: '#A76666'},
  smallButtonText: {fontSize: 11, color: '#24221D', fontWeight: '700'},
  dangerText: {color: '#8B3A3A'},
  message: {marginTop: 10, fontSize: 12, color: '#2A4FD4', lineHeight: 18},
});

const dev = StyleSheet.create({
  container: {marginTop: 32, borderTopWidth: 2, borderColor: '#2A4FD4', paddingTop: 20},
  heading: {fontSize: 13, fontWeight: '700', letterSpacing: 1.6, color: '#2A4FD4', marginBottom: 4},
  section: {marginTop: 20, backgroundColor: '#ECEAE3', borderRadius: 12, padding: 14},
  sectionTitle: {fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: '#746E62', marginBottom: 10},
  devRow: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#CCC7BC'},
  devLabel: {fontSize: 12, color: '#555047', flex: 1},
  devValue: {fontSize: 12, color: '#24221D', flex: 2, textAlign: 'right'},
  devValueGood: {color: '#294D3B'},
  devValueBad: {color: '#8B3A3A'},
  input: {borderWidth: 1, borderColor: '#BBB4A7', borderRadius: 8, padding: 10, fontSize: 13, color: '#171713', minHeight: 60, textAlignVertical: 'top', backgroundColor: '#FAF8F4'},
  button: {marginTop: 10, backgroundColor: '#171713', borderRadius: 9, paddingVertical: 10, alignItems: 'center'},
  buttonText: {color: '#F4F1EA', fontSize: 13, fontWeight: '600'},
  mono: {marginTop: 8, fontSize: 10, color: '#444', fontFamily: 'monospace', lineHeight: 15},
  logRow: {paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#CCC7BC'},
  logKind: {fontSize: 9, fontWeight: '700', letterSpacing: 1, color: '#2A4FD4'},
  logDetail: {fontSize: 12, color: '#24221D', marginTop: 1},
  logTs: {fontSize: 9, color: '#999', marginTop: 2},
  empty: {fontSize: 12, color: '#999', fontStyle: 'italic'},
  toggleLink: {fontSize: 12, color: '#2A4FD4', marginTop: 8, fontWeight: '600'},
});

export default App;
