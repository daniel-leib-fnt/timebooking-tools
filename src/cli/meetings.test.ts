process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Meeting } from '../calendar';
import { formatMeetings } from './meetings';

// Invented entries.
const base: Meeting = {
  start: '2026-10-26T09:30:00+01:00',
  end: '2026-10-26T09:45:00+01:00',
  allDay: false,
  summary: 'Team Daily',
  status: null,
  busyStatus: 'BUSY',
  transparent: false,
  organizer: 'Erika Example',
  recurring: true,
  description: null,
};

test('groups entries by day with times, organizer and markers', () => {
  const text = formatMeetings([
    base,
    {
      ...base,
      start: '2026-10-26T14:00:00+01:00',
      end: '2026-10-26T15:00:00+01:00',
      summary: 'Review',
      organizer: null,
      busyStatus: 'TENTATIVE',
    },
    {
      ...base,
      start: '2026-10-27T13:00:00+01:00',
      end: '2026-10-27T13:30:00+01:00',
      summary: 'Canceled: Sync',
      status: 'CANCELLED',
      busyStatus: 'FREE',
      transparent: true,
    },
  ]);
  assert.equal(
    text,
    [
      '2026-10-26 Mon',
      '  09:30–09:45  Team Daily  (Erika Example)',
      '  14:00–15:00  Review  [tentative]',
      '2026-10-27 Tue',
      '  13:00–13:30  Canceled: Sync  (Erika Example)  [cancelled, free]',
    ].join('\n'),
  );
});

test('shows all-day entries and their last day', () => {
  const vacation = { ...base, allDay: true, summary: 'Out of office', organizer: null, busyStatus: 'OOF' };
  assert.equal(
    formatMeetings([
      { ...vacation, start: '2026-10-29', end: '2026-10-30' },
      { ...vacation, start: '2026-11-02', end: '2026-11-07' },
    ]),
    [
      '2026-10-29 Thu',
      '  all day      Out of office  [out of office]',
      '2026-11-02 Mon',
      '  all day until 2026-11-06  Out of office  [out of office]',
    ].join('\n'),
  );
});

test('says so when there are no entries', () => {
  assert.equal(formatMeetings([]), 'No meetings.');
});
