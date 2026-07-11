export const JARVIS_CONFIG = {
  // Android emulator: ws://10.0.2.2:3000/phone
  // Physical phone/EC2: wss://your-domain.example/phone
  brainWebSocketUrl: 'ws://127.0.0.1:3000/phone',
  phoneAuthToken: 'replace-with-the-same-PHONE_AUTH_TOKEN-as-the-brain',
};

export const isJarvisConfigured =
  !JARVIS_CONFIG.phoneAuthToken.startsWith('replace-') &&
  !JARVIS_CONFIG.brainWebSocketUrl.includes('your-domain');
