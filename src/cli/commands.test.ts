import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPunch } from './commands';

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
