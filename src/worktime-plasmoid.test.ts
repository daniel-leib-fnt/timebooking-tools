import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { netMinutes, WorkInterval } from './worktime';

// The widget ports netMinutes to QML JavaScript (in seconds). Tests run from dist/; the widget stays in the source tree.
type NetSeconds = (intervals: WorkInterval[], now: Date) => number;
const source = readFileSync(join(__dirname, '..', 'plasmoid', 'contents', 'ui', 'worktime.js'), 'utf8').replace('.pragma library', '');
const netSeconds = new Function(`${source}\nreturn netSeconds;`)() as NetSeconds;

const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

test('the widget computes the same net time as the CLI', () => {
  const now = new Date('2026-11-10T23:30:00');
  // From 07:00, work 0 to 11 h gross with one break of 0 to 50 min after 4 h.
  for (const breakMinutes of [0, 10, 15, 20, 30, 40, 45, 50]) {
    for (let gross = 0; gross <= 11 * 60; gross++) {
      const intervals: WorkInterval[] =
        gross <= 240
          ? [{ in: '07:00', out: time(420 + gross) }]
          : [
              { in: '07:00', out: '11:00' },
              { in: time(660 + breakMinutes), out: time(420 + breakMinutes + gross) },
            ];
      assert.equal(Math.floor(netSeconds(intervals, now) / 60), netMinutes(intervals, now), JSON.stringify(intervals));
    }
  }
});

test('the widget counts an open interval until now like the CLI', () => {
  for (const nowTime of ['13:00', '13:31', '16:15', '16:46']) {
    const now = new Date(`2026-11-10T${nowTime}:00`);
    const intervals = [{ in: '07:00', out: null }];
    assert.equal(Math.floor(netSeconds(intervals, now) / 60), netMinutes(intervals, now), nowTime);
  }
});
