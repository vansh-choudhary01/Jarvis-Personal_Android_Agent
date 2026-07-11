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
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {isJarvisConfigured, JARVIS_CONFIG} from './src/config';
import {JarvisController} from './src/JarvisController';
import {JarvisDevice, type PermissionStatus} from './src/native';

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
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F1EA" />
      <Onboarding />
    </SafeAreaProvider>
  );
}

function Onboarding(): React.JSX.Element {
  const [permissions, setPermissions] = useState<PermissionStatus>(emptyStatus);
  const [connection, setConnection] = useState('Not started');
  const started = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setPermissions(await JarvisDevice.getPermissionStatus());
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
        <Text style={styles.title}>Jarvis</Text>
        <Text style={styles.intro}>
          Complete each one-time Android permission. Jarvis connects automatically when every item is ready.
        </Text>

        {!isJarvisConfigured && (
          <View style={styles.configCard}>
            <Text style={styles.configTitle}>Configure the brain first</Text>
            <Text style={styles.configText}>
              Edit src/config.ts and replace the WebSocket URL and phone token. Current URL: {JARVIS_CONFIG.brainWebSocketUrl}
            </Text>
          </View>
        )}

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
      </ScrollView>
    </SafeAreaView>
  );
}

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

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: '#F4F1EA'},
  content: {paddingHorizontal: 22, paddingTop: 28, paddingBottom: 40},
  eyebrow: {fontSize: 11, letterSpacing: 2.1, color: '#746E62', fontWeight: '700'},
  title: {fontSize: 52, lineHeight: 58, color: '#171713', fontWeight: '300', marginTop: 5},
  intro: {fontSize: 16, lineHeight: 24, color: '#555047', marginTop: 12, maxWidth: 540},
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

export default App;
