import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CorrectionRequest, GfosAuthError, GfosClient, GfosUnreachableError, Interval, StampDirection } from '../gfos/types';
import { StatusFile } from '../status';
import { netMinutes } from '../worktime';
import { formatDuration, localDate, localTime } from './dates';
import { appendStampLog, readStampLog, readStatusFile, StampLogEntry, writeStatusFile } from './state';

export function describeError(error: unknown): string {
  if (error instanceof GfosUnreachableError) {
    return 'GFOS not reachable — VPN connected?';
  }
  if (error instanceof GfosAuthError) {
    return `GFOS login failed: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function notify(summary: string, body: string, options: { critical: boolean }): Promise<void> {
  const urgency = options.critical ? ['--urgency=critical'] : [];
  try {
    await promisify(execFile)('notify-send', ['--app-name=timebooking', ...urgency, summary, body]);
  } catch (error) {
    console.error(`notify-send failed: ${(error as Error).message}`);
  }
}

interface Punch {
  direction: StampDirection;
  /** HH:MM */
  time: string;
}

/**
 * The Zeitkonto shows a new punch only after 5 to 15 seconds. Until then, adds the punch that GFOS
 * just confirmed to today's intervals read from it.
 */
export function applyPunch(intervals: Interval[], punch: Punch): Interval[] {
  const open = intervals.at(-1)?.out === null;
  if (punch.direction === 'in') {
    return open ? intervals : [...intervals, { in: punch.time, out: null }];
  }
  return open ? [...intervals.slice(0, -1), { ...intervals.at(-1)!, out: punch.time }] : intervals;
}

/** Fetches the clock state from GFOS and writes it to the status file; `punch` is one GFOS just confirmed. */
async function refreshStatus(client: GfosClient, punch?: Punch): Promise<{ status: StatusFile; since: string | null }> {
  const state = await client.getClockState();
  const now = new Date();
  const read = state.today?.intervals ?? [];
  const intervals = punch ? applyPunch(read, punch) : read;
  const last = intervals.at(-1);
  const status: StatusFile = {
    version: 1,
    updatedAt: now.toISOString(),
    date: state.today?.date ?? localDate(now),
    clockedIn: last !== undefined && last.out === null,
    intervals,
    source: 'gfos',
    lastError: null,
  };
  await writeStatusFile(status);
  return { status, since: status.clockedIn ? last!.in : null };
}

/** Keeps the last known clock state and only records the error, so the widget never shows a stamp that did not happen. */
async function markStatusLocal(error: string): Promise<void> {
  const now = new Date();
  const previous = await readStatusFile();
  await writeStatusFile({
    version: 1,
    updatedAt: now.toISOString(),
    date: previous?.date ?? localDate(now),
    clockedIn: previous?.clockedIn ?? false,
    intervals: previous?.intervals ?? [],
    source: 'local',
    lastError: error,
  });
}

export async function stamp(client: GfosClient, direction: StampDirection, options: { notify: boolean }): Promise<void> {
  const now = new Date();
  const entry = (time: string, ok: boolean): StampLogEntry => ({
    ts: new Date().toISOString(),
    kind: 'stamp',
    direction,
    time,
    date: localDate(now),
    ok,
    source: 'cli',
  });
  let time: string;
  let messages: string[];
  try {
    ({ time, messages } = await client.stamp(direction));
  } catch (error) {
    const message = describeError(error);
    await appendStampLog([{ ...entry(localTime(now), false), error: message }]);
    await markStatusLocal(message);
    if (options.notify) {
      await notify(`Clock-${direction} failed`, message, { critical: true });
    }
    throw error;
  }

  await appendStampLog([{ ...entry(time, true), messages }]);
  console.log(`Clocked ${direction} at ${time}.`);
  if (options.notify) {
    await notify(`Clocked ${direction}`, `at ${time}`, { critical: false });
  }
  try {
    await refreshStatus(client, { direction, time });
  } catch (error) {
    // The stamp is confirmed; only the follow-up read failed.
    const message = `Clocked ${direction} at ${time}, but the status refresh failed: ${describeError(error)}`;
    console.error(message);
    await markStatusLocal(message);
  }
}

function printStatus(status: StatusFile, since: string | null, now: Date): void {
  if (status.clockedIn) {
    console.log(since === null ? 'Clocked in' : `Clocked in since ${since}`);
  } else {
    console.log('Clocked out');
  }
  const isToday = status.date === localDate(now);
  const intervals = status.intervals.map((interval) => `${interval.in}–${interval.out ?? 'now'}`).join(', ');
  console.log(`${isToday ? 'Today' : status.date}: ${intervals || 'no punches'}`);
  // An open interval on a past day is a missing clock-out, not ongoing work.
  if (!isToday && status.intervals.some((interval) => interval.out === null)) {
    console.log('Net working time: unknown (clock-out missing)');
  } else {
    console.log(`Net working time: ${formatDuration(netMinutes(status.intervals, now))}`);
  }
}

export async function status(client: GfosClient, options: { json: boolean }): Promise<void> {
  try {
    const { status, since } = await refreshStatus(client);
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printStatus(status, since, new Date());
    }
  } catch (error) {
    const stale = error instanceof GfosUnreachableError ? await readStatusFile() : null;
    if (stale !== null) {
      if (options.json) {
        console.log(JSON.stringify(stale, null, 2));
      } else {
        console.log(`STALE — last known status from ${new Date(stale.updatedAt).toLocaleString()}`);
        const open = stale.intervals.find((interval) => interval.out === null);
        printStatus(stale, open?.in ?? null, new Date());
      }
    }
    throw error;
  }
}

/** Appends every GFOS punch in the range that the stamp log does not have yet. Idempotent. */
export async function sync(client: GfosClient, range: { from: string; to: string }): Promise<void> {
  const days = await client.getDays(range.from, range.to);
  const key = (entry: { date: string; direction: string; time: string }) => `${entry.date} ${entry.direction} ${entry.time}`;
  const known = new Set((await readStampLog()).filter((entry) => entry.kind === 'stamp' && entry.ok).map(key));

  const ts = new Date().toISOString();
  const missing: StampLogEntry[] = [];
  for (const day of days) {
    for (const interval of day.intervals) {
      const punches: [StampDirection, string | null][] = [
        ['in', interval.in],
        ['out', interval.out],
      ];
      for (const [direction, time] of punches) {
        if (time === null) {
          continue;
        }
        const entry: StampLogEntry = { ts, kind: 'stamp', direction, time, date: day.date, ok: true, source: 'gfos-sync' };
        if (!known.has(key(entry))) {
          known.add(key(entry));
          missing.push(entry);
        }
      }
    }
  }
  await appendStampLog(missing);
  console.log(`Backfilled ${missing.length} punch(es) for ${range.from}..${range.to}.`);
  await refreshStatus(client);
}

export async function correct(client: GfosClient, request: CorrectionRequest): Promise<void> {
  const entry: StampLogEntry = {
    ts: new Date().toISOString(),
    kind: 'correction-request',
    direction: request.direction,
    time: request.time,
    date: request.date,
    ok: true,
    source: 'cli',
    ...(request.comment === undefined ? {} : { comment: request.comment }),
  };
  try {
    await client.requestCorrection(request);
  } catch (error) {
    await appendStampLog([{ ...entry, ok: false, error: describeError(error) }]);
    throw error;
  }
  await appendStampLog([entry]);
  console.log(`Correction requested: ${request.date} ${request.direction} ${request.time}.`);
}
