import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctionFields } from './actions';
import { errorMessages, growlMessages } from './session';

test('correctionFields fills the Kommen or Gehen time of the "Fehlende Buchung" form', () => {
  assert.deepEqual(correctionFields({ date: '2026-04-01', direction: 'out', time: '17:30', comment: 'vergessen' }), {
    'awkor10Form:typ': 'Kommen/Gehen',
    'awkor10Form:xtKortag:calendar_input': '01.04.2026',
    'awkor10Form:startTime': '',
    'awkor10Form:endTime': '17:30',
    'awkor10Form:fieldKommentar': 'vergessen',
  });
  assert.equal(correctionFields({ date: '2026-04-01', direction: 'in', time: '08:00' })['awkor10Form:startTime'], '08:00');
  assert.throws(() => correctionFields({ date: '1.4.2026', direction: 'in', time: '08:00' }));
});

// The empty growls are copied from a live page; the message contents are hand-written, because
// no stamp or correction was ever submitted.
const growls = [
  '$(function(){PrimeFaces.cw("Growl","growlError",{id:"form:xtAlert_error",sticky:false,life:15000,escape:true,keepAlive:false,msgs:[]});});',
  '$(function(){PrimeFaces.cw("Growl","growlWarning",{id:"form:xtAlert_warning",sticky:false,life:15000,escape:true,keepAlive:false,msgs:[{summary:"Achtung",detail:"Bitte pr\\u00fcfen",severity:\'warn\'}]});});',
  '$(function(){PrimeFaces.cw("Growl","growlInfo",{id:"form:xtAlert_info",sticky:false,life:15000,escape:true,keepAlive:false,msgs:[{summary:"Kommen um 07:30 gebucht",detail:"Kommen um 07:30 gebucht",severity:\'info\'}]});});',
].join('\n');

test('growlMessages reads the messages from the growl widget configuration', () => {
  assert.deepEqual(growlMessages(growls), [
    { severity: 'warning', text: 'Achtung Bitte prüfen' },
    { severity: 'info', text: 'Kommen um 07:30 gebucht' },
  ]);
  assert.equal(errorMessages(growls), '');
  assert.equal(
    errorMessages('PrimeFaces.cw("Growl","growlError",{id:"x",msgs:[{summary:"Zeit ung\\xfcltig",severity:\'error\'}]});'),
    'Zeit ungültig',
  );
});
