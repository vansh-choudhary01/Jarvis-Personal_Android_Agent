import 'dotenv/config';
import {createServer} from 'node:http';
import {URL} from 'node:url';
import {WebSocketServer} from 'ws';
import {AndroidAgent} from './agent.js';
import {phoneMessageSchema} from './protocol.js';
import {TaskManager} from './taskManager.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.ANTHROPIC_API_KEY;
const authToken = process.env.PHONE_AUTH_TOKEN;

if (!apiKey || !authToken) {
  throw new Error('ANTHROPIC_API_KEY and PHONE_AUTH_TOKEN are required');
}

const manager = new TaskManager(new AndroidAgent(apiKey));

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
    sendJson(response, 200, {ok: true, phoneConnected: manager.hasPhone(), activeTask: manager.getTask()?.id ?? null});
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
    const taskId = await manager.startTask(body.instruction.trim());
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
  manager.attachPhone(phone);
  phone.send(JSON.stringify({type: 'task_status', status: 'connected'}));

  phone.on('message', async raw => {
    try {
      const message = phoneMessageSchema.parse(JSON.parse(raw.toString()));
      if (message.type === 'screen_state') await manager.onScreenState(message);
      else await manager.logPassiveEvent(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      phone.send(JSON.stringify({type: 'task_status', status: 'invalid_message', detail}));
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Jarvis brain listening on http://0.0.0.0:${port}`);
});
