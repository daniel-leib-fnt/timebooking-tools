import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { GfosDay } from './types';
import { localDate, monthRanges, parseHours, parseZeitkonto } from './zeitkonto';

// Pages captured from GFOS, trimmed to a few days, with synthetic times and hours. Tests run from dist/gfos; the fixtures stay in the source tree.
function parseFixture(year: number, month: number): GfosDay[] {
  const file = join(__dirname, '..', '..', 'src', 'gfos', 'fixtures', `zeitkonto-${year}-${String(month).padStart(2, '0')}.html`);
  return parseZeitkonto(readFileSync(file, 'utf8'), year, month);
}

const days = [...parseFixture(2026, 4), ...parseFixture(2026, 6), ...parseFixture(2026, 10), ...parseFixture(2026, 11)];
const day = (date: string) => days.find((d) => d.date === date)!;

test('keeps one entry per dated row and skips month summaries', () => {
  assert.deepEqual(
    days.map((d) => d.date),
    [
      '2026-04-01',
      '2026-04-03',
      '2026-04-07',
      '2026-04-10',
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
      '2026-06-08',
      '2026-06-30',
      '2026-10-30',
      '2026-10-31',
      '2026-11-09',
      '2026-11-10',
    ],
  );
});

test('reads a work day with all totals', () => {
  assert.deepEqual(day('2026-04-07'), {
    date: '2026-04-07',
    type: 'work',
    rawType: 'LES',
    intervals: [{ in: '07:30', out: '16:30' }],
    actualHours: 8.5,
    targetHours: 8,
    balanceDay: 0.5,
    balanceTotal: 13,
    absenceReason: null,
    notes: [],
  });
});

test('collects several intervals of one day and takes the totals from Tagessumme', () => {
  const d = day('2026-06-01');
  assert.deepEqual(d.intervals, [
    { in: '07:55', out: '07:58' },
    { in: '08:00', out: '16:45' },
  ]);
  assert.equal(d.actualHours, 8.3);
  assert.equal(d.balanceDay, 0.3);
  assert.equal(d.balanceTotal, 12.55);
});

test('keeps absence days without Kommen and reads the absence reason', () => {
  assert.equal(day('2026-06-08').absenceReason, 'Urlaub');
  assert.equal(day('2026-04-03').absenceReason, 'Feiertag');
  const flexDay = day('2026-06-05');
  assert.equal(flexDay.type, 'absence');
  assert.equal(flexDay.absenceReason, 'Gleitzeitabbau');
  assert.deepEqual(flexDay.intervals, []);
  assert.equal(flexDay.balanceDay, -8);
});

test('a worked day with a partial absence stays a work day with the absence reason', () => {
  const d = day('2026-04-10');
  assert.equal(d.type, 'work');
  assert.equal(d.absenceReason, 'Gleitzeitabbau');
  assert.equal(d.balanceDay, -2);
});

test('puts GFOS hints into notes', () => {
  const missingOut = day('2026-04-01');
  assert.deepEqual(missingOut.intervals, [{ in: '13:20', out: null }]);
  assert.deepEqual(missingOut.notes, ['Gehtmeldung fehlt (Kommen um 13:20).']);
  assert.deepEqual(day('2026-06-03').notes, ['10.50 Std. Anwesenheitszeit überschritten. Anwesenheitszeitgrenze von 10.00 Std.']);
});

test('ignores the texts of account postings', () => {
  assert.deepEqual(day('2026-06-30').notes, []);
  assert.equal(day('2026-06-30').balanceTotal, 6.8);
  assert.equal(day('2026-10-31').type, 'posting');
});

test("today's open interval has out=null and no totals yet", () => {
  const d = day('2026-11-10');
  assert.deepEqual(d.intervals, [{ in: '07:30', out: null }]);
  assert.equal(d.actualHours, null);
  assert.deepEqual(d.notes, []);
});

test('parseHours reads signed decimal hours', () => {
  assert.equal(parseHours('-04.10'), -4.1);
  assert.equal(parseHours('1,5'), 1.5);
  assert.equal(parseHours(''), null);
});

test('monthRanges splits by calendar month without time zone shifts', () => {
  assert.deepEqual(monthRanges('2026-10-31', '2026-12-01'), [
    { year: 2026, month: 10, from: '2026-10-31', to: '2026-10-31' },
    { year: 2026, month: 11, from: '2026-11-01', to: '2026-11-30' },
    { year: 2026, month: 12, from: '2026-12-01', to: '2026-12-01' },
  ]);
  assert.equal(localDate(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
});
