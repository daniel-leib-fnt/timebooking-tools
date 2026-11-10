/**
 * GFOS write actions: stamps via the web terminal and correction requests ("Fehlende Buchung").
 *
 * Both forms were inspected read-only; the submissions themselves were never sent against live
 * GFOS, so the response handling (growl messages, confirmation step) is unverified.
 */

import * as cheerio from 'cheerio';
import { GfosMessage, GfosSession, growlMessages, Page, withSession } from './session';
import { CorrectionRequest, GfosClientOptions, StampDirection, StampResult } from './types';
import { localTime } from './zeitkonto';

/** Menu "Kommen/Gehen": web terminal awbil11-war, form "form" with one link per direction. */
const TERMINAL_MENU = '0_0';
const TERMINAL_BUTTONS: Record<StampDirection, string> = {
  in: 'form:buttonBar:btnKommen:link',
  out: 'form:buttonBar:btnGehen:link',
};

/** Menu "Korrekturbeleg > Fehlende Buchung": awkor10-war, form "awkor10Form", saved via AJAX. */
const CORRECTION_MENU = '1_0';
const CORRECTION_FORM = 'awkor10Form';
const CORRECTION_SAVE = 'awkor10Form:buttonBar:saveButton:link';
const CORRECTION_TIME_FIELDS: Record<StampDirection, string> = {
  in: 'awkor10Form:startTime',
  out: 'awkor10Form:endTime',
};

export function stamp(options: GfosClientOptions, direction: StampDirection): Promise<StampResult> {
  return withSession(options, async (session) => {
    const terminal = await session.openMenu(TERMINAL_MENU);
    const button = TERMINAL_BUTTONS[direction];
    const result = await session.post(terminal, 'form', { [button]: button });
    const messages = checkMessages(result, `${direction === 'in' ? 'Kommen' : 'Gehen'} stamp`, options);
    const time = messages.map((message) => message.text.match(/\b(\d{1,2}):(\d{2})\b/)).find(Boolean);
    return { direction, time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : localTime(new Date()) };
  });
}

export function requestCorrection(options: GfosClientOptions, request: CorrectionRequest): Promise<void> {
  const fields = correctionFields(request);
  return withSession(options, async (session) => {
    const form = await selectCorrectionDay(session, await session.openMenu(CORRECTION_MENU), fields);
    let result = await session.ajax(form, CORRECTION_FORM, CORRECTION_SAVE, fields);
    // GFOS may ask to confirm the time span: it renders the question into
    // awkor10Form:fieldZeitspanne and expects the save again with awkor10Form:fieldConfirm=1
    // (checkZeitspanne() in awkor10.js).
    const question = cheerio.load(result.html)('[id="awkor10Form:fieldZeitspanne"]').attr('value');
    if (question) {
      if (options.debug) console.error(`gfos: confirming "${question}"`);
      result = await session.ajax(result, CORRECTION_FORM, CORRECTION_SAVE, { ...fields, 'awkor10Form:fieldConfirm': '1' });
    }
    checkMessages(result, 'correction request', options);
  });
}

/** Form values of a correction request for one missing Kommen or Gehen punch. */
export function correctionFields(request: CorrectionRequest): Record<string, string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date)) throw new Error(`Invalid date ${request.date}, expected YYYY-MM-DD`);
  if (!/^\d{2}:\d{2}$/.test(request.time)) throw new Error(`Invalid time ${request.time}, expected HH:MM`);
  const [year, month, day] = request.date.split('-');
  return {
    'awkor10Form:typ': 'Kommen/Gehen',
    'awkor10Form:xtKortag:calendar_input': `${day}.${month}.${year}`,
    'awkor10Form:startTime': '',
    'awkor10Form:endTime': '',
    [CORRECTION_TIME_FIELDS[request.direction]]: request.time,
    'awkor10Form:fieldKommentar': request.comment ?? '',
  };
}

/** Selects the day like the date picker does (dateSelect), which loads that day's punches into the form. */
export async function selectCorrectionDay(session: GfosSession, page: Page, fields: Record<string, string>): Promise<Page> {
  const update = await session.ajax(page, CORRECTION_FORM, 'awkor10Form:xtKortag:calendar', fields, {
    render: 'awkor10Form:azbtTablePanel awkor10Form:planKontenTablePanel',
    event: 'dateSelect',
  });
  // Only the tables are re-rendered; keep the full form and take over the new ViewState.
  const viewState = cheerio.load(update.html)('input[name="javax.faces.ViewState"]').attr('value');
  if (!viewState) return page;
  const $ = cheerio.load(page.html);
  $('input[name="javax.faces.ViewState"]').attr('value', viewState);
  return { ...page, html: $.html() };
}

function checkMessages(page: Page, action: string, options: GfosClientOptions): GfosMessage[] {
  const messages = growlMessages(page.html);
  if (options.debug) {
    console.error(`gfos: ${action} response: ${messages.map((m) => `[${m.severity}] ${m.text}`).join(' ') || '(no message)'}`);
  }
  const errors = messages.filter((message) => message.severity === 'error');
  if (errors.length) throw new Error(`GFOS rejected the ${action}: ${errors.map((m) => m.text).join(' ')}`);
  return messages;
}
