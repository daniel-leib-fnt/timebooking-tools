process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { CachedGfosClient, isFinal, readCacheFile } from './cache';
import { GfosClient, GfosDay, GfosUnreachableError, StampDirection } from './types';

// Invented attendance data.
function day(date: string, intervals: GfosDay['intervals'], notes: string[] = []): GfosDay {
  return {
    date,
    type: 'work',
    rawType: 'LES',
    intervals,
    actualHours: 8,
    targetHours: 8,
    balanceDay: 0,
    balanceTotal: 1.5,
    absenceReason: null,
    notes,
  };
}

class FakeGfos implements GfosClient {
  reachable = true;
  calls: string[] = [];
  days = new Map<string, GfosDay>();
  stampTime = '17:00';

  async getDays(startDate: string, endDate: string): Promise<GfosDay[]> {
    this.calls.push(`${startDate}..${endDate}`);
    if (!this.reachable) throw new GfosUnreachableError('ENOTFOUND');
    return [...this.days.values()].filter((d) => d.date >= startDate && d.date <= endDate);
  }
  async getClockState(): Promise<never> {
    throw new Error('not used by the cache');
  }
  async stamp(direction: StampDirection) {
    if (!this.reachable) throw new GfosUnreachableError('ENOTFOUND');
    return { direction, time: this.stampTime, messages: [] };
  }
  async requestCorrection(): Promise<void> {}
}

let gfos: FakeGfos;
let now: Date;
const client = (alwaysRefresh = false) => new CachedGfosClient(gfos, { alwaysRefresh, now: () => now });

beforeEach(() => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'timebooking-cache-'));
  gfos = new FakeGfos();
  gfos.days.set('2026-11-09', day('2026-11-09', [{ in: '08:00', out: '16:30' }]));
  gfos.days.set('2026-11-10', day('2026-11-10', [{ in: '08:15', out: '17:00' }]));
  now = new Date(2026, 10, 11, 9, 0);
});

test('reads whole months up to today, then answers final days from the cache', async () => {
  const first = await client().getDays('2026-11-09', '2026-11-10');
  assert.deepEqual(gfos.calls, ['2026-11-01..2026-11-11']);
  assert.deepEqual(
    first.days.map((d) => d.date),
    ['2026-11-09', '2026-11-10'],
  );
  assert.equal(first.error, null);

  gfos.calls = [];
  const second = await client().getDays('2026-11-02', '2026-11-10');
  assert.deepEqual(gfos.calls, []);
  assert.equal(second.days.length, 2);
  assert.equal(second.days[0].fetchedAt, now.toISOString());
  // Days without a GFOS row are cached as null, so they are not read again.
  assert.equal((await readCacheFile('2026')).days['2026-11-07'].day, null);
});

test('reads today, days read before they ended, and days needing a correction again', async () => {
  gfos.days.set('2026-11-11', day('2026-11-11', [{ in: '08:00', out: null }]));
  await client().getDays('2026-11-11', '2026-11-11');
  gfos.calls = [];
  await client().getDays('2026-11-11', '2026-11-11');
  assert.deepEqual(gfos.calls, ['2026-11-01..2026-11-11'], 'today is always read');

  // The next day, 2026-11-11 was read while it was still running: not final.
  now = new Date(2026, 10, 12, 9, 0);
  gfos.calls = [];
  await client().getDays('2026-11-11', '2026-11-11');
  assert.deepEqual(gfos.calls, ['2026-11-01..2026-11-12']);

  // Read after it ended, but the clock-out is missing: not final either.
  gfos.calls = [];
  await client().getDays('2026-11-11', '2026-11-11');
  assert.deepEqual(gfos.calls, ['2026-11-01..2026-11-12']);
});

test('isFinal needs a read after the day ended, no notes and no open interval', () => {
  const entry = (fetchedAt: string, d: GfosDay | null) => ({ day: d, fetchedAt, source: 'gfos' as const });
  const closed = day('2026-11-09', [{ in: '08:00', out: '16:00' }]);
  assert.equal(isFinal(entry('2026-11-10T08:00:00.000Z', closed), '2026-11-09', '2026-11-11'), true);
  assert.equal(isFinal(entry('2026-11-09T15:00:00.000Z', closed), '2026-11-09', '2026-11-11'), false);
  assert.equal(isFinal(entry('2026-11-10T08:00:00.000Z', day('2026-11-09', [], ['Gehtmeldung fehlt'])), '2026-11-09', '2026-11-11'), false);
  assert.equal(isFinal(entry('2026-11-10T08:00:00.000Z', null), '2026-11-09', '2026-11-11'), true);
  assert.equal(isFinal(undefined, '2026-11-09', '2026-11-11'), false);
  assert.equal(isFinal(entry('2026-11-12T08:00:00.000Z', closed), '2026-11-11', '2026-11-11'), false, 'today is never final');
});

test('falls back to the cache when GFOS is not reachable', async () => {
  await client().getDays('2026-11-09', '2026-11-11');
  now = new Date(2026, 10, 12, 9, 0);
  gfos.reachable = false;

  const result = await client().getDays('2026-11-09', '2026-11-12');
  assert.ok(result.error instanceof GfosUnreachableError);
  // 11-09 and 11-10 are final; only the days that needed GFOS are stale.
  assert.deepEqual(
    result.days.map((d) => [d.date, d.stale ?? false]),
    [
      ['2026-11-09', false],
      ['2026-11-10', false],
    ],
  );
  assert.equal((await readCacheFile('2026')).lastError?.message, 'GFOS not reachable — VPN connected?');

  await assert.rejects(client().getDays('2026-11-09', '2026-11-10', { refresh: true }), GfosUnreachableError);
  await assert.rejects(client().getDays('2026-10-01', '2026-10-02'), GfosUnreachableError, 'nothing cached for October');

  // Nothing cached for today: left out, not an error of its own.
  const today = await client().getClockStatus();
  assert.equal(today.today, null);
  assert.equal(today.stale, true);
});

test('alwaysRefresh reads final days again but still falls back', async () => {
  await client().getDays('2026-11-09', '2026-11-09');
  gfos.calls = [];
  await client(true).getDays('2026-11-09', '2026-11-09');
  assert.deepEqual(gfos.calls, ['2026-11-01..2026-11-11']);

  gfos.reachable = false;
  const result = await client(true).getDays('2026-11-09', '2026-11-09');
  assert.equal(result.days[0].stale, true);
  assert.notEqual(result.error, null);
});

test('a successful read clears the last error', async () => {
  gfos.reachable = false;
  await assert.rejects(client().getDays('2026-11-09', '2026-11-09'));
  assert.notEqual((await readCacheFile('2026')).lastError, null);
  gfos.reachable = true;
  await client().getDays('2026-11-09', '2026-11-09');
  assert.equal((await readCacheFile('2026')).lastError, null);
});

test('keeps a confirmed punch applied until the Zeitkonto shows it', async () => {
  gfos.days.set('2026-11-11', day('2026-11-11', [{ in: '08:00', out: null }]));
  const result = await client().stamp('out');
  assert.equal(result.error, null);
  let status = await client().getClockStatus();
  assert.equal(status.source, 'local');
  assert.equal(status.clockedIn, false);
  assert.deepEqual(status.today?.intervals, [{ in: '08:00', out: '17:00' }]);

  gfos.days.set('2026-11-11', day('2026-11-11', [{ in: '08:00', out: '17:00' }]));
  status = await client().getClockStatus();
  assert.equal(status.source, 'gfos');
  assert.equal(status.lastError, null);
});

test('records a failed stamp as the last error and keeps today', async () => {
  gfos.days.set('2026-11-11', day('2026-11-11', [{ in: '08:00', out: null }]));
  await client().getDays('2026-11-11', '2026-11-11');
  gfos.reachable = false;
  await assert.rejects(client().stamp('out'), GfosUnreachableError);

  const status = await client().getClockStatus();
  assert.equal(status.clockedIn, true);
  assert.equal(status.since, '08:00');
  assert.equal(status.stale, true);
  assert.equal(status.lastError, 'GFOS not reachable — VPN connected?');
  assert.ok(status.error instanceof GfosUnreachableError);
});

test('writes one file per year and removes the old status file', async () => {
  const dir = join(process.env.XDG_STATE_HOME!, 'timebooking');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), '{}');
  now = new Date(2027, 0, 2, 9, 0);
  gfos.days.set('2026-12-31', day('2026-12-31', [{ in: '08:00', out: '12:00' }]));
  await client().getDays('2026-12-31', '2027-01-01');
  assert.deepEqual(gfos.calls, ['2026-12-01..2026-12-31', '2027-01-01..2027-01-02']);
  assert.equal((await readCacheFile('2026')).days['2026-12-31'].day?.intervals.length, 1);
  assert.equal((await readCacheFile('2027')).days['2027-01-01'].day, null);
  assert.equal(existsSync(join(dir, 'status.json')), false);
});

test('an unreadable cache file counts as empty', async () => {
  const dir = join(process.env.XDG_STATE_HOME!, 'timebooking', 'days');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026.json'), '{ not json');
  const result = await client().getDays('2026-11-09', '2026-11-09');
  assert.equal(result.days.length, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, '2026.json'), 'utf8')).version, 1);
});
