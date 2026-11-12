/**
 * Local cache of GFOS days, so that past days can be read without the VPN.
 *
 * One file per year, $XDG_STATE_HOME/timebooking/days/<yyyy>.json, written atomically under a file
 * lock. The widget reads the current year's file. GFOS is contacted for today, for days that are not
 * final yet, on an explicit refresh and when `alwaysRefresh` is set; everything else comes from the
 * cache. GFOS answers per calendar month at the same cost, so a month with one missing day is
 * fetched as a whole.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { stateDir } from './session';
import {
  CorrectionRequest,
  GfosAuthError,
  GfosClient,
  GfosDay,
  GfosUnreachableError,
  Interval,
  StampDirection,
  StampResult,
} from './types';
import { localDate } from './zeitkonto';

export interface Punch {
  direction: StampDirection;
  /** HH:MM */
  time: string;
}

export interface CacheEntry {
  /** null: GFOS has no row for this date (weekend, nothing booked). */
  day: GfosDay | null;
  /** ISO 8601 date-time of the GFOS read (or of the confirmed stamp for a local entry). */
  fetchedAt: string;
  /** "local" while a punch GFOS confirmed is not visible in the Zeitkonto yet. */
  source: 'gfos' | 'local';
  /** The confirmed punch behind a local entry. */
  localPunch?: Punch;
}

export interface CacheFile {
  version: 1;
  /** Last failed GFOS call; cleared by the next successful read. Kept in the current year's file. */
  lastError: { message: string; at: string } | null;
  days: Record<string, CacheEntry>;
}

export type CachedDay = GfosDay & {
  fetchedAt: string;
  source: 'gfos' | 'local';
  /** GFOS was needed for this day but not reachable; the data is the cached state of `fetchedAt`. */
  stale?: true;
};

export interface DaysResult {
  /** Days with a GFOS row, sorted by date. */
  days: CachedDay[];
  /** Set when GFOS was needed but failed and the cache answered instead. */
  error: unknown;
}

export interface ClockStatus {
  clockedIn: boolean;
  /** HH:MM of the open clock-in, null when clocked out. */
  since: string | null;
  today: GfosDay | null;
  fetchedAt: string | null;
  source: 'gfos' | 'local';
  lastError: string | null;
  stale?: true;
}

export interface CachedClientOptions {
  /** Contact GFOS for every requested day, still falling back to the cache when it is not reachable. */
  alwaysRefresh?: boolean;
  now?: () => Date;
}

export function describeGfosError(error: unknown): string {
  if (error instanceof GfosUnreachableError) {
    return 'GFOS not reachable — VPN connected?';
  }
  if (error instanceof GfosAuthError) {
    return `GFOS login failed: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Zeitkonto shows a new punch only after 5 to 15 seconds. Until then, adds the punch that GFOS
 * just confirmed to the intervals read from it. Returns `intervals` itself when it already has the punch.
 */
export function applyPunch(intervals: Interval[], punch: Punch): Interval[] {
  const open = intervals.at(-1)?.out === null;
  if (punch.direction === 'in') {
    return open ? intervals : [...intervals, { in: punch.time, out: null }];
  }
  return open ? [...intervals.slice(0, -1), { ...intervals.at(-1)!, out: punch.time }] : intervals;
}

/**
 * A final day does not change in GFOS any more: it was read after it ended, and it has neither
 * GFOS notes nor an open interval (both mean a correction is still due).
 */
export function isFinal(entry: CacheEntry | undefined, date: string, today: string): boolean {
  if (!entry || entry.source !== 'gfos' || date >= today || localDate(new Date(entry.fetchedAt)) <= date) {
    return false;
  }
  return entry.day === null || (entry.day.notes.length === 0 && entry.day.intervals.every((interval) => interval.out !== null));
}

export function cacheDir(): string {
  return join(stateDir(), 'days');
}

function cacheFilePath(year: string): string {
  return join(cacheDir(), `${year}.json`);
}

/** A missing or unreadable file counts as empty; the next write replaces it. */
export async function readCacheFile(year: string): Promise<CacheFile> {
  try {
    const file = JSON.parse(await readFile(cacheFilePath(year), 'utf8')) as CacheFile;
    if (file.version === 1 && file.days && typeof file.days === 'object') {
      return { version: 1, lastError: file.lastError ?? null, days: file.days };
    }
  } catch {
    // ENOENT or invalid JSON
  }
  return { version: 1, lastError: null, days: {} };
}

async function writeCacheFile(year: string, file: CacheFile): Promise<void> {
  const path = cacheFilePath(year);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2) + '\n');
  await rename(tmp, path);
  // Replaced by this cache; versions before it kept today's state there.
  await unlink(join(stateDir(), 'status.json')).catch(() => undefined);
}

/** Read-modify-write of the given years under their file locks (taken in year order, so no deadlocks). */
async function updateYears(years: string[], update: (files: Map<string, CacheFile>) => void): Promise<void> {
  const sorted = [...new Set(years)].sort();
  await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
  const releases: (() => Promise<void>)[] = [];
  try {
    for (const year of sorted) {
      releases.push(
        await lock(cacheFilePath(year), { realpath: false, stale: 30_000, retries: { retries: 120, minTimeout: 100, maxTimeout: 1000 } }),
      );
    }
    const files = new Map<string, CacheFile>();
    for (const year of sorted) {
      files.set(year, await readCacheFile(year));
    }
    update(files);
    for (const year of sorted) {
      await writeCacheFile(year, files.get(year)!);
    }
  } finally {
    for (const release of releases.reverse()) {
      await release();
    }
  }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + days));
}

function datesBetween(from: string, to: string): string[] {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function lastDayOfMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}`;
}

function emptyDay(date: string): GfosDay {
  return {
    date,
    type: 'unknown',
    rawType: '',
    intervals: [],
    actualHours: null,
    targetHours: null,
    balanceDay: null,
    balanceTotal: null,
    absenceReason: null,
    notes: [],
  };
}

export class CachedGfosClient {
  private readonly alwaysRefresh: boolean;
  private readonly now: () => Date;

  constructor(
    private readonly client: GfosClient,
    options: CachedClientOptions = {},
  ) {
    this.alwaysRefresh = options.alwaysRefresh ?? process.env.TIMEBOOKING_ALWAYS_REFRESH === '1';
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Days from startDate to endDate (inclusive). With `refresh`, a GFOS failure is thrown; otherwise
   * the cache answers and `error` is set. Throws as well when a past day has no cached data.
   */
  async getDays(startDate: string, endDate: string, options: { refresh?: boolean } = {}): Promise<DaysResult> {
    const refresh = options.refresh ?? false;
    const now = this.now();
    const today = localDate(now);
    const dates = datesBetween(startDate, endDate);
    const cached = await this.readEntries(dates);
    const needed = dates.filter((date) => refresh || this.alwaysRefresh || !isFinal(cached.get(date), date, today));

    const fetched = new Set<string>();
    let error: unknown = null;
    for (const month of [...new Set(needed.map((date) => date.slice(0, 7)))]) {
      const from = `${month}-01`;
      const monthEnd = lastDayOfMonth(month);
      const until = endDate > today ? endDate : today;
      const to = monthEnd < until ? monthEnd : until;
      try {
        const days = await this.client.getDays(from, to);
        await this.store(from, to, days, now);
        datesBetween(from, to).forEach((date) => fetched.add(date));
      } catch (failure) {
        await this.recordError(failure);
        if (refresh) {
          throw failure;
        }
        // GFOS is unreachable for all months alike; the cache answers the rest.
        error = failure;
        break;
      }
    }

    const entries = await this.readEntries(dates);
    // A past day the cache has never seen would silently look like a day without work. Today and
    // future days have no final data anyway; they are left out, and `error` says why.
    if (error !== null && needed.some((date) => date < today && !entries.has(date))) {
      throw error;
    }
    const days: CachedDay[] = [];
    for (const date of dates) {
      const entry = entries.get(date);
      if (entry?.day) {
        const stale = needed.includes(date) && !fetched.has(date);
        days.push({ ...entry.day, fetchedAt: entry.fetchedAt, source: entry.source, ...(stale ? { stale: true as const } : {}) });
      }
    }
    return { days, error };
  }

  /** Today's clock state; today is always read from GFOS, the cache answers when it is not reachable. */
  async getClockStatus(): Promise<ClockStatus & { error: unknown }> {
    const today = localDate(this.now());
    const { days, error } = await this.getDays(today, today);
    const day = days[0] ?? null;
    const entry = (await this.readEntries([today])).get(today);
    const file = await readCacheFile(today.slice(0, 4));
    const last = day?.intervals.at(-1);
    const clockedIn = last !== undefined && last.out === null;
    const { fetchedAt: _fetchedAt, source: _source, stale: _stale, ...plain } = day ?? emptyDay(today);
    return {
      clockedIn,
      since: clockedIn ? last!.in : null,
      today: day ? plain : null,
      fetchedAt: entry?.fetchedAt ?? null,
      source: entry?.source ?? 'gfos',
      lastError: file.lastError?.message ?? null,
      ...(error !== null ? { stale: true as const } : {}),
      error,
    };
  }

  /**
   * Stamps in GFOS, records the confirmed punch for today and reads today again. A failed stamp is
   * recorded as the last error and thrown; a failed read afterwards is returned as `error`.
   */
  async stamp(direction: StampDirection): Promise<StampResult & { error: unknown }> {
    let result: StampResult;
    try {
      result = await this.client.stamp(direction);
    } catch (failure) {
      await this.recordError(failure);
      throw failure;
    }
    await this.recordPunch({ direction, time: result.time });
    const today = localDate(this.now());
    const { error } = await this.getDays(today, today);
    return { ...result, error };
  }

  requestCorrection(request: CorrectionRequest): Promise<void> {
    return this.client.requestCorrection(request);
  }

  private async readEntries(dates: string[]): Promise<Map<string, CacheEntry>> {
    const entries = new Map<string, CacheEntry>();
    for (const year of new Set(dates.map((date) => date.slice(0, 4)))) {
      const file = await readCacheFile(year);
      for (const date of dates) {
        if (file.days[date]) {
          entries.set(date, file.days[date]);
        }
      }
    }
    return entries;
  }

  private async store(from: string, to: string, days: GfosDay[], now: Date): Promise<void> {
    const today = localDate(now);
    const byDate = new Map(days.map((day) => [day.date, day]));
    const currentYear = today.slice(0, 4);
    await updateYears([from.slice(0, 4), to.slice(0, 4), currentYear], (files) => {
      for (const date of datesBetween(from, to)) {
        const file = files.get(date.slice(0, 4))!;
        const day = byDate.get(date) ?? null;
        const punch = file.days[date]?.localPunch;
        // Until the Zeitkonto shows today's confirmed punch, keep it applied.
        if (date === today && punch) {
          const base = day ?? emptyDay(date);
          const intervals = applyPunch(base.intervals, punch);
          if (intervals !== base.intervals) {
            file.days[date] = { day: { ...base, intervals }, fetchedAt: now.toISOString(), source: 'local', localPunch: punch };
            continue;
          }
        }
        file.days[date] = { day, fetchedAt: now.toISOString(), source: 'gfos' };
      }
      files.get(currentYear)!.lastError = null;
    });
  }

  private async recordPunch(punch: Punch): Promise<void> {
    const now = this.now();
    const today = localDate(now);
    await updateYears([today.slice(0, 4)], (files) => {
      const file = files.get(today.slice(0, 4))!;
      const base = file.days[today]?.day ?? emptyDay(today);
      file.days[today] = {
        day: { ...base, intervals: applyPunch(base.intervals, punch) },
        fetchedAt: now.toISOString(),
        source: 'local',
        localPunch: punch,
      };
      file.lastError = null;
    });
  }

  private async recordError(error: unknown): Promise<void> {
    const now = this.now();
    const year = localDate(now).slice(0, 4);
    await updateYears([year], (files) => {
      files.get(year)!.lastError = { message: describeGfosError(error), at: now.toISOString() };
    });
  }
}
