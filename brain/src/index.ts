import 'dotenv/config';
import {createServer} from 'node:http';
import {URL} from 'node:url';
import type WebSocket from 'ws';
import {WebSocketServer} from 'ws';
import {CloudLlmRuntime} from './llmRuntime.js';
import {installNodeFileLogger} from './nodeLogger.js';
import type {PhoneTransport} from './phoneTransport.js';
import {phoneMessageSchema} from './protocol.js';
import {BrainRuntime} from './runtime.js';

const port = Number(process.env.PORT ?? 3000);
const provider = process.env.AI_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';
const apiKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
const model = provider === 'gemini'
  ? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  : process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const authToken = process.env.PHONE_AUTH_TOKEN;

if (!apiKey || !authToken) {
  throw new Error(`${provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} and PHONE_AUTH_TOKEN are required`);
}

installNodeFileLogger();

const brain = new BrainRuntime({
  llm: new CloudLlmRuntime(provider, apiKey, model),
});
brain.start();

class WebSocketPhoneTransport implements PhoneTransport {
  constructor(private readonly socket: WebSocket) {}

  isConnected(): boolean {
    return this.socket.readyState === this.socket.OPEN;
  }

  send(message: Parameters<PhoneTransport['send']>[0]): void {
    this.socket.send(JSON.stringify(message));
  }

  onClose(listener: () => void): void {
    this.socket.on('close', listener);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}

function bearerToken(value: string | undefined): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function isAuthorized(header: string | undefined, url: URL): boolean {
  return bearerToken(header) === authToken || url.searchParams.get('token') === authToken;
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    const status = brain.getStatus();
    sendJson(response, 200, {
      ok: true,
      provider,
      model,
      phoneConnected: status.phoneConnected,
      activeTask: status.activeTask?.id ?? null,
      workingMemory: status.workingMemory,
      worldState: status.worldState,
      lastPlannerContext: status.lastPlannerContext,
      recentEvents: status.recentEvents,
      memoryCandidates: status.memoryCandidates,
      goals: status.goals,
    });
    return;
  }
  if (request.method !== 'POST' || url.pathname !== '/task') {
    sendJson(response, 404, {error: 'Not found'});
    return;
  }
  if (!isAuthorized(request.headers.authorization, url)) {
    sendJson(response, 401, {error: 'Unauthorized'});
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) throw new Error('Request body too large');
      chunks.push(buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {instruction?: unknown};
    if (typeof body.instruction !== 'string' || !body.instruction.trim()) {
      sendJson(response, 400, {error: 'instruction must be a non-empty string'});
      return;
    }
    const taskId = await brain.submitTask(body.instruction.trim());
    sendJson(response, 202, {taskId, status: 'accepted'});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('already active') ? 409 : message.includes('not connected') ? 503 : 400;
    sendJson(response, status, {error: message});
  }
});

const webSockets = new WebSocketServer({noServer: true, maxPayload: 12 * 1024 * 1024});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/phone' || !isAuthorized(request.headers.authorization, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, phone => webSockets.emit('connection', phone, request));
});

webSockets.on('connection', phone => {
  brain.attachPhone(new WebSocketPhoneTransport(phone));
  phone.send(JSON.stringify({type: 'task_status', status: 'connected'}));

  phone.on('message', async raw => {
    try {
      const message = phoneMessageSchema.parse(JSON.parse(raw.toString()));
      await brain.receivePhoneMessage(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      phone.send(JSON.stringify({type: 'task_status', status: 'invalid_message', detail}));
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Jarvis brain listening on http://0.0.0.0:${port} using ${provider}/${model}`);
});
