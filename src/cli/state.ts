import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { StampDirection } from '../gfos/types';

export interface StampLogEntry {
  /** ISO 8601 date-time of the log write. */
  ts: string;
  kind: 'stamp' | 'correction-request';
  direction: StampDirection;
  /** HH:MM; confirmed by GFOS when ok, intended local time otherwise. */
  time: string;
  /** YYYY-MM-DD */
  date: string;
  ok: boolean;
  source: 'cli' | 'gfos-sync';
  comment?: string;
  error?: string;
  /** GFOS messages of the stamp response. */
  messages?: string[];
}

function stateDir(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'timebooking');
}

export function stampLogPath(): string {
  return process.env.TIMEBOOKING_STAMP_LOG || join(stateDir(), 'stamps.jsonl');
}

export async function readStampLog(): Promise<StampLogEntry[]> {
  const path = stampLogPath();
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return content
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== '')
    .map(({ line, number }) => {
      try {
        return JSON.parse(line) as StampLogEntry;
      } catch {
        throw new Error(`${path}:${number} is not valid JSON; fix the line before syncing.`);
      }
    });
}

export async function appendStampLog(entries: StampLogEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const path = stampLogPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, entries.map((entry) => JSON.stringify(entry) + '\n').join(''));
}
