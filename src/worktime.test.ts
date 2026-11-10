import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netMinutes } from './worktime';

const at = (time: string) => new Date(`2026-11-10T${time}:00`);

test('no intervals is zero', () => {
  assert.equal(netMinutes([], at('12:00')), 0);
});

test('up to 6 h gross needs no break', () => {
  assert.equal(netMinutes([{ in: '08:00', out: '14:00' }], at('18:00')), 360);
});

test('open interval counts until now', () => {
  assert.equal(netMinutes([{ in: '08:00', out: null }], at('10:15')), 135);
});

test('just over 6 h without break is capped at 6 h', () => {
  assert.equal(netMinutes([{ in: '08:00', out: '14:10' }], at('18:00')), 360);
});

test('over 6 h without break deducts 30 min', () => {
  assert.equal(netMinutes([{ in: '08:00', out: '15:00' }], at('18:00')), 390);
});

test('gaps count as break already taken', () => {
  const intervals = [
    { in: '08:00', out: '12:00' },
    { in: '12:20', out: '15:20' },
  ];
  // gross 7:00, 20 min taken, 10 min deducted
  assert.equal(netMinutes(intervals, at('18:00')), 410);
});

test('enough break taken deducts nothing', () => {
  const intervals = [
    { in: '08:00', out: '12:00' },
    { in: '12:30', out: '16:00' },
  ];
  assert.equal(netMinutes(intervals, at('18:00')), 450);
});

test('over 9 h requires 45 min in total', () => {
  const intervals = [
    { in: '07:00', out: '12:00' },
    { in: '12:30', out: '17:30' },
  ];
  // gross 10:00, 30 min taken, 15 min deducted
  assert.equal(netMinutes(intervals, at('18:00')), 585);
});

// The following cases reproduce the Ist that GFOS computed for the same gross time.

test('the 9 h threshold applies after the 30 min break', () => {
  // gross 9:16, GFOS Ist 8.77 h
  assert.equal(netMinutes([{ in: '08:00', out: '17:16' }], at('20:00')), 526);
});

test('the second deduction is capped at 9 h', () => {
  // gross 9:38, GFOS Ist 9.00 h
  assert.equal(netMinutes([{ in: '08:00', out: '17:38' }], at('20:00')), 540);
});

test('well over 9 h deducts 45 min', () => {
  // gross 9:54, GFOS Ist 9.15 h
  assert.equal(netMinutes([{ in: '08:00', out: '17:54' }], at('20:00')), 549);
});

test('open interval after a break', () => {
  const intervals = [
    { in: '08:00', out: '12:00' },
    { in: '12:45', out: null },
  ];
  assert.equal(netMinutes(intervals, at('16:00')), 435);
});
