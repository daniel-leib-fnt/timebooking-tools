/** Calendar entries from a published ICS feed (e.g. Outlook), with recurrences expanded. */

import { execFileSync } from 'node:child_process';
import ICAL from 'ical.js';

export interface Meeting {
  /** Local ISO time with offset, e.g. 2026-01-05T09:00:00+01:00; for all-day entries the date only. */
  start: string;
  /** Exclusive end, same format as `start`. */
  end: string;
  allDay: boolean;
  summary: string;
  /** iCalendar STATUS: CONFIRMED, TENTATIVE, CANCELLED, or null when absent. */
  status: string | null;
  /** Outlook's X-MICROSOFT-CDO-BUSYSTATUS: BUSY, TENTATIVE, FREE, OOF, WORKINGELSEWHERE, or null when absent. */
  busyStatus: string | null;
  /** TRANSP:TRANSPARENT, i.e. the entry does not block time. */
  transparent: boolean;
  organizer: string | null;
  recurring: boolean;
  /** First 500 characters of the description, or null. */
  description: string | null;
}

export class CalendarConfigError extends Error {}

const DESCRIPTION_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The ICS URL from `secret-tool lookup service calendar-ics`, falling back to CALENDAR_ICS_URL. */
export function loadIcsUrl(): string {
  const url = lookupSecret() || process.env.CALENDAR_ICS_URL;
  if (!url) {
    throw new CalendarConfigError(
      'No calendar URL found. Store it with `secret-tool store --label="Calendar ICS" service calendar-ics` or set CALENDAR_ICS_URL.',
    );
  }
  return url.trim();
}

function lookupSecret(): string | null {
  try {
    return execFileSync('secret-tool', ['lookup', 'service', 'calendar-ics'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
  } catch {
    // Not found (exit code 1), secret-tool missing or no Secret Service running.
    return null;
  }
}

export async function fetchMeetings(startDate: string, endDate: string, url = loadIcsUrl()): Promise<Meeting[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Calendar feed answered HTTP ${response.status}.`);
  }
  return expandMeetings(await response.text(), startDate, endDate);
}

/** Entries overlapping the local days startDate..endDate (inclusive), sorted by start. */
export function expandMeetings(ics: string, startDate: string, endDate: string): Meeting[] {
  const rangeStart = localMidnight(startDate);
  const rangeEnd = new Date(localMidnight(endDate).getTime() + DAY_MS);
  const calendar = new ICAL.Component(ICAL.parse(ics));
  for (const zone of calendar.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(zone);
  }

  const events = calendar.getAllSubcomponents('vevent').map((component) => new ICAL.Event(component));
  const masters = new Map<string, ICAL.Event>();
  for (const event of events) {
    if (!event.isRecurrenceException()) {
      masters.set(event.uid, event);
    }
  }
  const orphans: ICAL.Event[] = [];
  for (const event of events) {
    if (event.isRecurrenceException()) {
      const master = masters.get(event.uid);
      if (master?.isRecurring()) {
        master.relateException(event);
      } else {
        orphans.push(event);
      }
    }
  }

  const meetings: Meeting[] = [];
  const add = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurring: boolean) => {
    if (start.toJSDate() < rangeEnd && end.toJSDate() > rangeStart) {
      meetings.push(toMeeting(event, start, end, recurring));
    }
  };

  for (const event of [...masters.values(), ...orphans]) {
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate, event.isRecurrenceException());
      continue;
    }
    // Moved occurrences may start up to a day away from their recurrence id; the overlap check in `add` decides.
    const stopAt = rangeEnd.getTime() + DAY_MS;
    const iterator = event.iterator();
    for (let next = iterator.next(); next && next.toJSDate().getTime() < stopAt; next = iterator.next()) {
      const details = event.getOccurrenceDetails(next);
      add(details.item, details.startDate, details.endDate, true);
    }
  }
  return meetings.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function toMeeting(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurring: boolean): Meeting {
  const component = event.component;
  const text = (name: string): string | null => {
    const value = component.getFirstPropertyValue(name);
    return value == null ? null : String(value);
  };
  const organizer = component.getFirstProperty('organizer');
  const description = event.description?.trim();
  return {
    start: formatTime(start),
    end: formatTime(end),
    allDay: start.isDate,
    summary: event.summary ?? '',
    status: text('status')?.toUpperCase() ?? null,
    busyStatus: text('x-microsoft-cdo-busystatus')?.toUpperCase() ?? null,
    transparent: text('transp')?.toUpperCase() === 'TRANSPARENT',
    organizer: organizer ? String(organizer.getParameter('cn') ?? organizer.getFirstValue()).replace(/^mailto:/i, '') : null,
    recurring,
    description: description ? description.slice(0, DESCRIPTION_LIMIT) : null,
  };
}

function localMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatTime(time: ICAL.Time): string {
  if (time.isDate) {
    return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  }
  const d = time.toJSDate();
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`;
}

/** All-day entries first on their day. */
function sortKey(meeting: Meeting): string {
  return meeting.allDay ? `${meeting.start}T00:00:00-99` : meeting.start;
}
