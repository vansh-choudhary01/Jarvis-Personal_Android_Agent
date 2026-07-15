import {z} from 'zod';

const nodeSchema = z.object({
  text: z.string().optional().default(''),
  contentDescription: z.string().optional().default(''),
  className: z.string().optional().default(''),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  clickable: z.boolean(),
  editable: z.boolean().optional().default(false),
  packageName: z.string().optional().default(''),
});

export const phoneMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('screen_state'),
    nodeTree: z.array(nodeSchema),
    screenshotBase64: z.string().optional(),
    screenshotMediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    packageName: z.string().default(''),
    lastActionResult: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('notification'),
    packageName: z.string(),
    title: z.string(),
    text: z.string(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('sms_received'),
    sender: z.string(),
    body: z.string(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('device_observation'),
    kind: z.enum(['app_changed', 'screen_changed', 'screen_activity', 'user_interaction']),
    packageName: z.string(),
    appLabel: z.string().optional().default(''),
    className: z.string().optional().default(''),
    eventType: z.string().optional().default(''),
    timestamp: z.number(),
  }),
]);

const progressFields = {
  status: z.string().max(160).optional(),
  progress: z.number().int().min(0).max(100).optional(),
};
const tap = z.object({action: z.literal('tap'), x: z.number(), y: z.number(), ...progressFields});
const type = z.object({action: z.literal('type'), text: z.string(), ...progressFields});
const findAndTap = z.object({action: z.literal('find_and_tap'), targetText: z.string(), ...progressFields});
const swipe = z.object({
  action: z.literal('swipe'),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  ...progressFields,
});
const openApp = z.object({action: z.literal('open_app'), packageName: z.string(), ...progressFields});
const listApps = z.object({action: z.literal('list_apps'), ...progressFields});
const getDeviceProfile = z.object({action: z.literal('get_device_profile'), ...progressFields});
const call = z.object({action: z.literal('call'), number: z.string(), ...progressFields});
const getRecentCalls = z.object({action: z.literal('get_recent_calls'), limit: z.number().int().min(1).max(50), ...progressFields});
const wait = z.object({action: z.literal('wait'), ms: z.number().int().min(0).max(30_000), ...progressFields});
const taskComplete = z.object({action: z.literal('task_complete'), summary: z.string(), ...progressFields});
const taskFailed = z.object({action: z.literal('task_failed'), reason: z.string(), ...progressFields});

export const agentActionSchema = z.discriminatedUnion('action', [
  tap,
  type,
  findAndTap,
  swipe,
  openApp,
  listApps,
  getDeviceProfile,
  call,
  getRecentCalls,
  wait,
  taskComplete,
  taskFailed,
]);

export type PhoneMessage = z.infer<typeof phoneMessageSchema>;
export type ScreenState = Extract<PhoneMessage, {type: 'screen_state'}>;
export type AgentAction = z.infer<typeof agentActionSchema>;

export type BrainMessage =
  | ({type: 'action'} & AgentAction)
  | {type: 'request_screen_state'}
  | {type: 'task_status'; status: string; detail?: string};
