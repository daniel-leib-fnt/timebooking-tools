/** Parser for the GFOS Zeitkonto table (awau21-war, tbody#form:tagesdata_data). */

import * as cheerio from 'cheerio';
import { clean, GfosSession } from './session';
import { DayType, GfosDay } from './types';

type Column = 'date' | 'type' | 'in' | 'out' | 'actual' | 'target' | 'balanceDay' | 'balanceTotal' | 'reason';

/** Header texts (lowercased, letters only) of the Zeitkonto columns. */
const HEADERS: Record<string, Column> = {
  datum: 'date',
  typ: 'type',
  kommen: 'in',
  gehen: 'out',
  ist: 'actual',
  soll: 'target',
  saldotag: 'balanceDay',
  saldoges: 'balanceTotal',
  noabbez: 'reason',
};

/**
 * Column positions when the header cannot be read. GFOS renders one leading column before
 * Datum; the rest follows the export order Datum, Änder.Kennz., Typ, Zeitpar., Kommen, Gehen,
 * Ist, Soll, SaldoTag, SaldoGes, VAC, NOAB/Bez.
 */
const DEFAULT_COLUMNS: Record<Column, number> = {
  date: 1,
  type: 3,
  in: 5,
  out: 6,
  actual: 7,
  target: 8,
  balanceDay: 9,
  balanceTotal: 10,
  reason: 12,
};

const DAY_TYPES: Record<string, DayType> = { LES: 'work', ABW: 'absence', NAZ: 'posting' };

function readColumns($: cheerio.CheerioAPI): Record<Column, number> {
  const columns: Partial<Record<Column, number>> = {};
  $('[id="form:tagesdata"] thead th').each((index, th) => {
    const column =
      HEADERS[
        clean($(th).text())
          .toLowerCase()
          .replace(/[^a-zäöü]/g, '')
      ];
    if (column && columns[column] === undefined) columns[column] = index;
  });
  return Object.keys(HEADERS).length === Object.keys(columns).length ? (columns as Record<Column, number>) : DEFAULT_COLUMNS;
}

/** Parses GFOS decimal hours such as "08.00", "-04.10" or "1,5"; null for empty cells. */
export function parseHours(text: string): number | null {
  const match = clean(text).match(/^([+-]?)(\d+)(?:[.,](\d+))?$/);
  if (!match) return null;
  const value = Number(`${match[2]}.${match[3] ?? '0'}`);
  return match[1] === '-' ? -value : value;
}

function parseTime(text: string): string | null {
  const match = clean(text).match(/^(\d{1,2}):(\d{2})$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

/**
 * Parses the Zeitkonto result page of one month. The Datum column only holds "DD Wd", so the
 * caller passes the month the page was queried for.
 *
 * Row kinds: a dated row starts a day; rows without date belong to the day above (several
 * intervals, an absence part, account postings); "Tagessumme" carries the totals of a
 * multi-row day; "Vormonatssummen" and "Monatssummen" are skipped.
 */
export function parseZeitkonto(html: string, year: number, month: number): GfosDay[] {
  const $ = cheerio.load(html);
  const col = readColumns($);
  const days: GfosDay[] = [];
  let day: GfosDay | null = null;

  $('[id="form:tagesdata_data"] > tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length <= col.reason) return;
    const cell = (column: Column) => clean($(cells[col[column]]).text());
    const dateText = cell('date');

    if (/summe/i.test(dateText)) {
      if (/^tagessumme/i.test(dateText) && day) setTotals(day, cell);
      if (/^monatssumme/i.test(dateText)) day = null;
      return;
    }

    const dayMatch = dateText.match(/^(\d{1,2})\b/);
    if (dayMatch) {
      day = {
        date: `${year}-${String(month).padStart(2, '0')}-${dayMatch[1].padStart(2, '0')}`,
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
      setTotals(day, cell);
      days.push(day);
    }
    if (!day) return;
    addRow(day, cell('type'), cell('in'), cell('out'), cell('reason'));
  });

  return days;
}

function setTotals(day: GfosDay, cell: (column: Column) => string): void {
  day.actualHours = parseHours(cell('actual'));
  day.targetHours = parseHours(cell('target'));
  day.balanceDay = parseHours(cell('balanceDay'));
  day.balanceTotal = parseHours(cell('balanceTotal'));
}

function addRow(day: GfosDay, rawType: string, inText: string, outText: string, reason: string): void {
  const type = DAY_TYPES[rawType] ?? 'unknown';
  // A worked part wins over an absence part (e.g. half a day Gleitzeitabbau); postings never
  // define the day unless they are its only rows.
  if (!day.rawType || (type === 'work' && day.type !== 'work')) {
    day.rawType = rawType;
    day.type = type;
  }

  const clockIn = parseTime(inText);
  if (clockIn) day.intervals.push({ in: clockIn, out: parseTime(outText) });

  if (!reason) return;
  if (type === 'absence') day.absenceReason ??= reason;
  else if (type !== 'posting' && !day.notes.includes(reason)) day.notes.push(reason);
}

/** Menu id of "Zeitkonto" in main.xhtml; it shows awau21-war in the iframe. */
const ZEITKONTO_MENU = '2_0';

/**
 * Loads the Zeitkonto days between two dates (YYYY-MM-DD, inclusive). GFOS is queried month by
 * month because the Datum column carries no month.
 */
export async function fetchDays(session: GfosSession, startDate: string, endDate: string): Promise<GfosDay[]> {
  const days: GfosDay[] = [];
  for (const { year, month, from, to } of monthRanges(startDate, endDate)) {
    // A search posted from a result page returns the previous result again, so each month starts from the menu.
    const searchPage = await session.openMenu(ZEITKONTO_MENU);
    const page = await session.post(searchPage, 'form', {
      'form:suchenseite:smand:input': session.account.mandant,
      'form:suchenseite:swerk:input': session.account.werk,
      'form:suchenseite:spers:input': session.account.personalnummer,
      'form:suchenseite:datumVon:calendar_input': toGermanDate(from),
      'form:suchenseite:datumBis:calendar_input': toGermanDate(to),
      'form:buttonBar:btnSelect:link': 'form:buttonBar:btnSelect:link',
    });
    days.push(...parseZeitkonto(page.html, year, month).filter((day) => day.date >= from && day.date <= to));
  }
  return days;
}

/** Splits a date range into per-month ranges; pure string/calendar arithmetic, no time zones involved. */
export function monthRanges(startDate: string, endDate: string): { year: number; month: number; from: string; to: string }[] {
  const ranges = [];
  let [year, month] = startDate.split('-').map(Number);
  while (`${year}-${pad(month)}` <= endDate.slice(0, 7)) {
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${pad(month)}-01` < startDate ? startDate : `${year}-${pad(month)}-01`;
    const to = `${year}-${pad(month)}-${pad(lastDay)}` > endDate ? endDate : `${year}-${pad(month)}-${pad(lastDay)}`;
    ranges.push({ year, month, from, to });
    month = month === 12 ? 1 : month + 1;
    if (month === 1) year++;
  }
  return ranges;
}

/** Local calendar date as YYYY-MM-DD (toISOString() would shift it to UTC). */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toGermanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local time as HH:MM. */
export function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
