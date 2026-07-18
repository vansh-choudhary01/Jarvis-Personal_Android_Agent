export const JARVIS_CONFIG = {
  // USB-reversed laptop Brain mode. The laptop Brain chooses Gemini/Anthropic
  // from brain/.env; current run uses AI_PROVIDER=gemini.
  brainWebSocketUrl: 'ws://127.0.0.1:3000/phone',
  // Android emulator: ws://10.0.2.2:3000/phone
  // Physical phone/EC2: wss://your-domain.example/phone
  phoneAuthToken: 'jarvis-local-emulator-dev-token-2026',
};

export const isJarvisConfigured =
  JARVIS_CONFIG.brainWebSocketUrl.startsWith('local://') ||
  (!JARVIS_CONFIG.phoneAuthToken.startsWith('replace-') &&
    !JARVIS_CONFIG.brainWebSocketUrl.includes('your-domain'));
