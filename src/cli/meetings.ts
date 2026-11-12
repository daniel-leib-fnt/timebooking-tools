import { fetchMeetings, Meeting } from '../calendar';
import { addDays, localDate } from './dates';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Markers for entries a booking would treat differently from a plain busy meeting. */
function markers(meeting: Meeting): string[] {
  const result: string[] = [];
  if (meeting.status === 'CANCELLED') {
    result.push('cancelled');
  }
  if (meeting.status === 'TENTATIVE' || meeting.busyStatus === 'TENTATIVE') {
    result.push('tentative');
  }
  if (meeting.busyStatus === 'FREE' || meeting.transparent) {
    result.push('free');
  }
  if (meeting.busyStatus === 'OOF') {
    result.push('out of office');
  }
  if (meeting.busyStatus === 'WORKINGELSEWHERE') {
    result.push('working elsewhere');
  }
  return result;
}

function timeSpan(meeting: Meeting): string {
  if (!meeting.allDay) {
    return `${meeting.start.slice(11, 16)}–${meeting.end.slice(11, 16)}`;
  }
  const last = localDate(addDays(parseLocalDate(meeting.end), -1));
  return last === meeting.start ? 'all day' : `all day until ${last}`;
}

/** Plain-text listing grouped by day; days without entries are left out. */
export function formatMeetings(meetings: Meeting[]): string {
  if (meetings.length === 0) {
    return 'No meetings.';
  }
  const lines: string[] = [];
  let day = '';
  for (const meeting of meetings) {
    const date = meeting.start.slice(0, 10);
    if (date !== day) {
      day = date;
      lines.push(`${date} ${WEEKDAYS[parseLocalDate(date).getDay()]}`);
    }
    const flags = markers(meeting);
    const organizer = meeting.organizer ? `  (${meeting.organizer})` : '';
    const suffix = flags.length > 0 ? `  [${flags.join(', ')}]` : '';
    lines.push(`  ${timeSpan(meeting).padEnd(11)}  ${meeting.summary}${organizer}${suffix}`);
  }
  return lines.join('\n');
}

export async function meetings(
  range: { from: string; to: string },
  options: { json: boolean },
  fetch: (from: string, to: string) => Promise<Meeting[]> = fetchMeetings,
): Promise<void> {
  const entries = await fetch(range.from, range.to);
  console.log(options.json ? JSON.stringify(entries, null, 2) : formatMeetings(entries));
}
