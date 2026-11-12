process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandMeetings } from './index';

// Synthetic feed in the shape Outlook publishes: Windows time zone id, busy status, a weekly series
// with one deleted and one moved occurrence. All names and times are invented.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example//Calendar//EN
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:daily-1
SUMMARY:Team Daily
DTSTART;TZID=W. Europe Standard Time:20261019T093000
DTEND;TZID=W. Europe Standard Time:20261019T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
EXDATE;TZID=W. Europe Standard Time:20261027T093000
ORGANIZER;CN=Erika Example:mailto:erika@example.com
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
BEGIN:VEVENT
UID:daily-1
RECURRENCE-ID;TZID=W. Europe Standard Time:20261028T093000
SUMMARY:Team Daily (moved)
DTSTART;TZID=W. Europe Standard Time:20261028T110000
DTEND;TZID=W. Europe Standard Time:20261028T111500
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
BEGIN:VEVENT
UID:review-1
SUMMARY:ABC-123 Design review
DESCRIPTION:Agenda: the plugin concept
DTSTART;TZID=W. Europe Standard Time:20261026T140000
DTEND;TZID=W. Europe Standard Time:20261026T150000
STATUS:TENTATIVE
X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
SUMMARY:Canceled: Sync
DTSTART;TZID=W. Europe Standard Time:20261027T130000
DTEND;TZID=W. Europe Standard Time:20261027T133000
STATUS:CANCELLED
X-MICROSOFT-CDO-BUSYSTATUS:FREE
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:vacation-1
SUMMARY:Out of office
DTSTART;VALUE=DATE:20261029
DTEND;VALUE=DATE:20261030
X-MICROSOFT-CDO-BUSYSTATUS:OOF
END:VEVENT
END:VCALENDAR
`;

const brief = (startDate: string, endDate: string) =>
  expandMeetings(ICS, startDate, endDate).map((m) => `${m.start} ${m.end} ${m.summary}`);

test('expands a weekly series across the switch to winter time', () => {
  assert.deepEqual(brief('2026-10-23', '2026-10-26'), [
    '2026-10-23T09:30:00+02:00 2026-10-23T09:45:00+02:00 Team Daily',
    '2026-10-26T09:30:00+01:00 2026-10-26T09:45:00+01:00 Team Daily',
    '2026-10-26T14:00:00+01:00 2026-10-26T15:00:00+01:00 ABC-123 Design review',
  ]);
});

test('drops excluded occurrences and applies moved ones', () => {
  assert.deepEqual(brief('2026-10-27', '2026-10-28'), [
    '2026-10-27T13:00:00+01:00 2026-10-27T13:30:00+01:00 Canceled: Sync',
    '2026-10-28T11:00:00+01:00 2026-10-28T11:15:00+01:00 Team Daily (moved)',
  ]);
});

test('lists all-day entries first with dates only', () => {
  const [vacation, daily] = expandMeetings(ICS, '2026-10-29', '2026-10-29');
  assert.equal(vacation.start, '2026-10-29');
  assert.equal(vacation.end, '2026-10-30');
  assert.equal(vacation.allDay, true);
  assert.equal(vacation.busyStatus, 'OOF');
  assert.equal(daily.summary, 'Team Daily');
});

test('reports status, busy status, transparency, organizer and description', () => {
  const [daily, review] = expandMeetings(ICS, '2026-10-26', '2026-10-26');
  assert.equal(daily.organizer, 'Erika Example');
  assert.equal(daily.recurring, true);
  assert.equal(review.status, 'TENTATIVE');
  assert.equal(review.busyStatus, 'TENTATIVE');
  assert.equal(review.description, 'Agenda: the plugin concept');
  assert.equal(review.recurring, false);
  const [cancelled] = expandMeetings(ICS, '2026-10-27', '2026-10-27').filter((m) => m.status === 'CANCELLED');
  assert.equal(cancelled.transparent, true);
  assert.equal(cancelled.busyStatus, 'FREE');
});

test('returns nothing outside the range', () => {
  assert.deepEqual(brief('2026-10-10', '2026-10-18'), []);
});
