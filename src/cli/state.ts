import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { StampDirection } from '../gfos/types';
import { StatusFile } from '../status';

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
}

function stateDir(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'timebooking');
}

export function statusFilePath(): string {
  return join(stateDir(), 'status.json');
}

export function stampLogPath(): string {
  return process.env.TIMEBOOKING_STAMP_LOG || join(stateDir(), 'stamps.jsonl');
}

/** Returns null when no status file has been written yet. */
export async function readStatusFile(): Promise<StatusFile | null> {
  try {
    return JSON.parse(await readFile(statusFilePath(), 'utf8')) as StatusFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Atomic: the widget never sees a half-written file. */
export async function writeStatusFile(status: StatusFile): Promise<void> {
  const path = statusFilePath();
  const tmp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, JSON.stringify(status, null, 2) + '\n');
  await rename(tmp, path);
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
