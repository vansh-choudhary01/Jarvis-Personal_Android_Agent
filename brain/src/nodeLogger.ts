import {mkdir, appendFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {setLogSink} from './logger.js';

export function installNodeFileLogger(logPath = resolve(process.cwd(), 'logs', 'actions.jsonl')): void {
  let warned = false;
  setLogSink(async event => {
    try {
      await mkdir(dirname(logPath), {recursive: true});
      await appendFile(
        logPath,
        `${JSON.stringify({timestamp: new Date().toISOString(), ...event})}\n`,
        'utf8',
      );
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn('[brain] file logging disabled:', error instanceof Error ? error.message : String(error));
      }
    }
  });
}
