import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CachedDay, CachedGfosClient, ClockStatus, describeGfosError } from '../gfos/cache';
import { CorrectionRequest, StampDirection } from '../gfos/types';
import { netMinutes } from '../worktime';
import { formatDuration, localDate, localTime } from './dates';
import { appendStampLog, readStampLog, StampLogEntry } from './state';

export const describeError = describeGfosError;

/** Notification texts in German when the locale is German, else in English. */
export function notificationTexts(direction: StampDirection, env: NodeJS.ProcessEnv = process.env) {
  const german = (env.LC_ALL || env.LC_MESSAGES || env.LANG || '').startsWith('de');
  if (german) {
    return {
      failed: direction === 'in' ? 'Einstempeln fehlgeschlagen' : 'Ausstempeln fehlgeschlagen',
      done: direction === 'in' ? 'Eingestempelt' : 'Ausgestempelt',
      at: (time: string) => `um ${time}`,
    };
  }
  return {
    failed: `Clock-${direction} failed`,
    done: `Clocked ${direction}`,
    at: (time: string) => `at ${time}`,
  };
}

async function notify(summary: string, body: string, options: { critical: boolean }): Promise<void> {
  const urgency = options.critical ? ['--urgency=critical'] : [];
  try {
    await promisify(execFile)('notify-send', ['--app-name=timebooking', ...urgency, summary, body]);
  } catch (error) {
    console.error(`notify-send failed: ${(error as Error).message}`);
  }
}

export async function stamp(client: CachedGfosClient, direction: StampDirection, options: { notify: boolean }): Promise<void> {
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
  let result;
  try {
    result = await client.stamp(direction);
  } catch (error) {
    const message = describeError(error);
    await appendStampLog([{ ...entry(localTime(now), false), error: message }]);
    if (options.notify) {
      await notify(notificationTexts(direction).failed, message, { critical: true });
    }
    throw error;
  }

  const { time, messages, error } = result;
  await appendStampLog([{ ...entry(time, true), messages }]);
  console.log(`Clocked ${direction} at ${time}.`);
  if (options.notify) {
    const texts = notificationTexts(direction);
    await notify(texts.done, texts.at(time), { critical: false });
  }
  if (error !== null) {
    // The stamp is confirmed and recorded; only the follow-up read failed.
    console.error(`Clocked ${direction} at ${time}, but reading today from GFOS failed: ${describeError(error)}`);
  }
}

function printStatus(status: ClockStatus, now: Date): void {
  if (status.stale) {
    const at = status.fetchedAt === null ? 'never' : new Date(status.fetchedAt).toLocaleString();
    console.log(`STALE — last read from GFOS ${at}`);
  }
  if (status.clockedIn) {
    console.log(status.since === null ? 'Clocked in' : `Clocked in since ${status.since}`);
  } else {
    console.log('Clocked out');
  }
  const intervals = status.today?.intervals ?? [];
  console.log(`Today: ${formatIntervals(intervals) || 'no punches'}`);
  console.log(`Net working time: ${formatDuration(netMinutes(intervals, now))}`);
}

function formatIntervals(intervals: { in: string; out: string | null }[]): string {
  return intervals.map((interval) => `${interval.in}–${interval.out ?? 'now'}`).join(', ');
}

/** Today is always read from GFOS; when it is not reachable, the cached state is printed and the error thrown. */
export async function status(client: CachedGfosClient, options: { json: boolean }): Promise<void> {
  const { error, ...status } = await client.getClockStatus();
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printStatus(status, new Date());
  }
  if (error !== null) {
    throw error;
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One line per day with a GFOS row: punches, Ist, absence, notes, and when it was read. */
export function formatDays(days: CachedDay[]): string {
  if (days.length === 0) {
    return 'No days.';
  }
  return days
    .map((day) => {
      const [year, month, date] = day.date.split('-').map(Number);
      const parts = [`${day.date} ${WEEKDAYS[new Date(year, month - 1, date).getDay()]}`];
      parts.push(formatIntervals(day.intervals) || '-');
      if (day.actualHours !== null) parts.push(`Ist ${day.actualHours.toFixed(2)}`);
      if (day.absenceReason) parts.push(day.absenceReason);
      if (day.notes.length > 0) parts.push(`[${day.notes.join('; ')}]`);
      const read = new Date(day.fetchedAt);
      const marker = day.stale ? ' STALE' : day.source === 'local' ? ' local' : '';
      parts.push(`(read ${localDate(read)} ${localTime(read)}${marker})`);
      return parts.join('  ');
    })
    .join('\n');
}

export async function days(
  client: CachedGfosClient,
  range: { from: string; to: string; refresh: boolean },
  options: { json: boolean },
): Promise<void> {
  const { days, error } = await client.getDays(range.from, range.to, { refresh: range.refresh });
  console.log(options.json ? JSON.stringify(days, null, 2) : formatDays(days));
  if (error !== null) {
    throw error;
  }
}

/** Appends every GFOS punch in the range that the stamp log does not have yet. Idempotent. */
export async function sync(client: CachedGfosClient, range: { from: string; to: string; refresh: boolean }): Promise<void> {
  const { days, error } = await client.getDays(range.from, range.to, { refresh: range.refresh });
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
  if (error !== null) {
    throw error;
  }
}

export async function correct(client: CachedGfosClient, request: CorrectionRequest): Promise<void> {
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
