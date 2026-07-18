import type {AgentAction} from './protocol.js';

export type CapabilityId =
  | 'read_screen'
  | 'tap_screen'
  | 'type_text'
  | 'open_app'
  | 'resolve_app'
  | 'read_notifications'
  | 'read_calls'
  | 'read_sms'
  | 'make_call'
  | 'show_overlay'
  | 'run_background'
  | 'run_local_model';

export interface CapabilityRequirement {
  id: CapabilityId;
  androidPermission?: string;
  androidSetting?: string;
  userFacingName: string;
}

export interface CapabilityCheck {
  available: boolean;
  required: CapabilityRequirement[];
  reason?: string;
}

const ACTION_CAPABILITIES: Partial<Record<AgentAction['action'], CapabilityId[]>> = {
  tap: ['tap_screen'],
  type: ['type_text'],
  find_and_tap: ['read_screen', 'tap_screen'],
  swipe: ['tap_screen'],
  open_app: ['open_app'],
  resolve_app: ['resolve_app'],
  list_apps: ['open_app'],
  get_device_profile: [],
  get_recent_calls: ['read_calls'],
  call: ['make_call'],
  wait: [],
  task_complete: [],
  task_failed: [],
};

const REQUIREMENTS: Record<CapabilityId, CapabilityRequirement> = {
  read_screen: {
    id: 'read_screen',
    androidSetting: 'Accessibility Service',
    userFacingName: 'Accessibility screen reading',
  },
  tap_screen: {
    id: 'tap_screen',
    androidSetting: 'Accessibility Service',
    userFacingName: 'Accessibility touch control',
  },
  type_text: {
    id: 'type_text',
    androidSetting: 'Accessibility Service',
    userFacingName: 'Accessibility typing',
  },
  open_app: {
    id: 'open_app',
    userFacingName: 'Open installed apps',
  },
  resolve_app: {
    id: 'resolve_app',
    userFacingName: 'Resolve installed app names',
  },
  read_notifications: {
    id: 'read_notifications',
    androidSetting: 'Notification Access',
    userFacingName: 'Notification access',
  },
  read_calls: {
    id: 'read_calls',
    androidPermission: 'READ_CALL_LOG',
    userFacingName: 'Call log access',
  },
  read_sms: {
    id: 'read_sms',
    androidPermission: 'RECEIVE_SMS',
    userFacingName: 'SMS access',
  },
  make_call: {
    id: 'make_call',
    androidPermission: 'CALL_PHONE',
    userFacingName: 'Phone calling',
  },
  show_overlay: {
    id: 'show_overlay',
    androidSetting: 'Display over other apps',
    userFacingName: 'Floating overlay',
  },
  run_background: {
    id: 'run_background',
    androidSetting: 'Unrestricted battery usage',
    userFacingName: 'Background operation',
  },
  run_local_model: {
    id: 'run_local_model',
    userFacingName: 'Local AI runtime',
  },
};

export class CapabilityManager {
  private readonly available = new Map<CapabilityId, boolean>();

  constructor() {
    for (const id of Object.keys(REQUIREMENTS) as CapabilityId[]) {
      this.available.set(id, true);
    }
  }

  setCapability(id: CapabilityId, available: boolean): void {
    this.available.set(id, available);
  }

  checkAction(action: AgentAction): CapabilityCheck {
    const ids = ACTION_CAPABILITIES[action.action] ?? [];
    const missing = ids
      .filter(id => this.available.get(id) === false)
      .map(id => REQUIREMENTS[id]);

    return {
      available: missing.length === 0,
      required: missing,
      reason: missing.length > 0 ? `Missing capability: ${missing.map(item => item.userFacingName).join(', ')}` : undefined,
    };
  }
}
