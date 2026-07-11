import {mkdir, appendFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

const logPath = resolve(process.cwd(), 'logs', 'actions.jsonl');

export async function logEvent(event: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(logPath), {recursive: true});
  await appendFile(
    logPath,
    `${JSON.stringify({timestamp: new Date().toISOString(), ...event})}\n`,
    'utf8',
  );
}
