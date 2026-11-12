import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPunch } from '../gfos/cache';
import { notificationTexts } from './commands';

const morning = { in: '08:00', out: '12:00' };

test('applyPunch opens an interval for a clock-in the Zeitkonto does not show yet', () => {
  assert.deepEqual(applyPunch([morning], { direction: 'in', time: '12:30' }), [morning, { in: '12:30', out: null }]);
  assert.deepEqual(applyPunch([], { direction: 'in', time: '08:00' }), [{ in: '08:00', out: null }]);
});

test('applyPunch closes the open interval for a clock-out the Zeitkonto does not show yet', () => {
  assert.deepEqual(applyPunch([morning, { in: '12:30', out: null }], { direction: 'out', time: '17:00' }), [
    morning,
    { in: '12:30', out: '17:00' },
  ]);
});

test('applyPunch keeps intervals that already contain the punch', () => {
  const open = [morning, { in: '12:30', out: null }];
  assert.deepEqual(applyPunch(open, { direction: 'in', time: '12:30' }), open);
  assert.deepEqual(applyPunch([morning], { direction: 'out', time: '12:00' }), [morning]);
});

test('notificationTexts follows the locale', () => {
  assert.equal(notificationTexts('out', { LANG: 'de_DE.UTF-8' }).done, 'Ausgestempelt');
  assert.equal(notificationTexts('in', { LANG: 'de_DE.UTF-8' }).at('08:00'), 'um 08:00');
  assert.equal(notificationTexts('in', { LANG: 'en_US.UTF-8', LC_ALL: 'de_DE.UTF-8' }).failed, 'Einstempeln fehlgeschlagen');
  assert.equal(notificationTexts('in', { LANG: 'en_US.UTF-8' }).done, 'Clocked in');
  assert.equal(notificationTexts('out', {}).failed, 'Clock-out failed');
});
