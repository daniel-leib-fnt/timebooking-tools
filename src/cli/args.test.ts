import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, UsageError } from './args';

const today = new Date(2026, 10, 10);
const parse = (...argv: string[]) => parseCliArgs(argv, today);

test('no arguments and --help show help', () => {
  assert.deepEqual(parse(), { command: { name: 'help' }, debug: false });
  assert.deepEqual(parse('status', '--help'), { command: { name: 'help' }, debug: false });
});

test('clock-in and clock-out with --notify and global --debug', () => {
  assert.deepEqual(parse('clock-in'), { command: { name: 'clock-in', notify: false }, debug: false });
  assert.deepEqual(parse('--debug', 'clock-out', '--notify'), {
    command: { name: 'clock-out', notify: true },
    debug: true,
  });
});

test('status --json', () => {
  assert.deepEqual(parse('status', '--json').command, { name: 'status', json: true });
});

test('sync defaults to the last 14 days', () => {
  assert.deepEqual(parse('sync').command, { name: 'sync', from: '2026-10-27', to: '2026-11-10', refresh: false });
});

test('sync with explicit range', () => {
  assert.deepEqual(parse('sync', '--from', '2026-01-01', '--to', '2026-01-31', '--refresh').command, {
    name: 'sync',
    from: '2026-01-01',
    to: '2026-01-31',
    refresh: true,
  });
});

test('sync rejects invalid dates and reversed ranges', () => {
  assert.throws(() => parse('sync', '--from', '2026-02-30'), UsageError);
  assert.throws(() => parse('sync', '--from', '10.11.2026'), UsageError);
  assert.throws(() => parse('sync', '--from', '2026-11-10', '--to', '2026-11-01'), UsageError);
});

test('correct with comment', () => {
  assert.deepEqual(parse('correct', '2026-11-09', 'out', '17:30', '--comment', 'forgot to stamp').command, {
    name: 'correct',
    request: { date: '2026-11-09', direction: 'out', time: '17:30', comment: 'forgot to stamp' },
  });
});

test('correct without comment has no comment field', () => {
  assert.deepEqual(parse('correct', '2026-11-09', 'in', '08:00').command, {
    name: 'correct',
    request: { date: '2026-11-09', direction: 'in', time: '08:00' },
  });
});

test('correct validates its arguments', () => {
  assert.throws(() => parse('correct', '2026-11-09', 'kommen', '08:00'), UsageError);
  assert.throws(() => parse('correct', '2026-11-09', 'in', '24:00'), UsageError);
  assert.throws(() => parse('correct', '2026-11-09', 'in', '8:00'), UsageError);
  assert.throws(() => parse('correct', '2026-11-09', 'in'), UsageError);
});

test('mcp', () => {
  assert.deepEqual(parse('mcp').command, { name: 'mcp' });
});

test('rejects unknown commands, unknown options and options of other commands', () => {
  assert.throws(() => parse('stempeln'), UsageError);
  assert.throws(() => parse('status', '--verbose'), UsageError);
  assert.throws(() => parse('clock-in', '--json'), UsageError);
  assert.throws(() => parse('status', 'extra'), UsageError);
});

test('meetings defaults to today, a single --from shows that day', () => {
  assert.deepEqual(parse('meetings').command, { name: 'meetings', from: '2026-11-10', to: '2026-11-10', json: false });
  assert.deepEqual(parse('meetings', '--from', '2026-11-03').command, {
    name: 'meetings',
    from: '2026-11-03',
    to: '2026-11-03',
    json: false,
  });
});

test('meetings with range and --json', () => {
  assert.deepEqual(parse('meetings', '--from', '2026-11-02', '--to', '2026-11-06', '--json').command, {
    name: 'meetings',
    from: '2026-11-02',
    to: '2026-11-06',
    json: true,
  });
  assert.throws(() => parse('meetings', '--from', '2026-11-06', '--to', '2026-11-02'), UsageError);
  assert.throws(() => parse('meetings', '--notify'), UsageError);
});

test('days defaults to today without refresh', () => {
  assert.deepEqual(parse('days').command, { name: 'days', from: '2026-11-10', to: '2026-11-10', json: false, refresh: false });
});

test('days with range, --json and --refresh', () => {
  assert.deepEqual(parse('days', '--from', '2026-11-02', '--to', '2026-11-06', '--json', '--refresh').command, {
    name: 'days',
    from: '2026-11-02',
    to: '2026-11-06',
    json: true,
    refresh: true,
  });
  assert.throws(() => parse('status', '--refresh'), UsageError);
});
