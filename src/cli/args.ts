import { parseArgs } from 'node:util';
import { CorrectionRequest } from '../gfos/types';
import { addDays, localDate } from './dates';

export type Command =
  | { name: 'clock-in' | 'clock-out'; notify: boolean }
  | { name: 'status'; json: boolean }
  | { name: 'sync'; from: string; to: string }
  | { name: 'correct'; request: CorrectionRequest }
  | { name: 'mcp' }
  | { name: 'help' };

export interface CliArgs {
  command: Command;
  debug: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const HELP = `Usage: timebooking [--debug] <command> [options]

Commands:
  clock-in [--notify]             Stamp "in" in GFOS
  clock-out [--notify]            Stamp "out" in GFOS
  status [--json]                 Show the current clock state and today's net working time
  sync [--from DATE] [--to DATE]  Backfill punches from GFOS into the stamp log (default: last 14 days)
  correct <DATE> <in|out> <HH:MM> [--comment TEXT]
                                  Request a correction of a missing or wrong punch
  mcp                             Start the MCP server on stdio

Options:
  --debug   Log GFOS requests to stderr
  --help    Show this help

Exit codes: 0 ok, 1 error, 2 GFOS not reachable.
Files: $XDG_STATE_HOME/timebooking/status.json, stamp log $TIMEBOOKING_STAMP_LOG
(default $XDG_STATE_HOME/timebooking/stamps.jsonl).`;

const OPTIONS = {
  debug: { type: 'boolean' },
  help: { type: 'boolean' },
  notify: { type: 'boolean' },
  json: { type: 'boolean' },
  from: { type: 'string' },
  to: { type: 'string' },
  comment: { type: 'string' },
} as const;

type OptionName = keyof typeof OPTIONS;

const COMMAND_OPTIONS: Record<Command['name'], OptionName[]> = {
  'clock-in': ['notify'],
  'clock-out': ['notify'],
  status: ['json'],
  sync: ['from', 'to'],
  correct: ['comment'],
  mcp: [],
  help: [],
};

const COMMAND_ARGUMENTS: Record<Command['name'], number> = {
  'clock-in': 0,
  'clock-out': 0,
  status: 0,
  sync: 0,
  correct: 3,
  mcp: 0,
  help: 0,
};

function isCommandName(name: string): name is Command['name'] {
  return Object.hasOwn(COMMAND_OPTIONS, name);
}

function parseDate(value: string, what: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!date || localDate(date) !== value) {
    throw new UsageError(`Invalid ${what} "${value}", expected YYYY-MM-DD.`);
  }
  return value;
}

function parseTime(value: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new UsageError(`Invalid time "${value}", expected HH:MM.`);
  }
  return value;
}

/** Parses argv without the node and script entries; `today` sets the default sync range. */
export function parseCliArgs(argv: string[], today: Date): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const debug = values.debug ?? false;
  if (values.help || positionals.length === 0) {
    return { command: { name: 'help' }, debug };
  }

  const [name, ...rest] = positionals;
  if (!isCommandName(name)) {
    throw new UsageError(`Unknown command "${name}".`);
  }
  const allowed: OptionName[] = ['debug', 'help', ...COMMAND_OPTIONS[name]];
  const invalid = (Object.keys(values) as OptionName[]).find((option) => !allowed.includes(option));
  if (invalid) {
    throw new UsageError(`Option --${invalid} is not valid for ${name}.`);
  }
  if (rest.length !== COMMAND_ARGUMENTS[name]) {
    throw new UsageError(`${name} expects ${COMMAND_ARGUMENTS[name]} argument(s), got ${rest.length}.`);
  }

  switch (name) {
    case 'clock-in':
    case 'clock-out':
      return { command: { name, notify: values.notify ?? false }, debug };
    case 'status':
      return { command: { name, json: values.json ?? false }, debug };
    case 'sync': {
      const from = parseDate(values.from ?? localDate(addDays(today, -14)), '--from');
      const to = parseDate(values.to ?? localDate(today), '--to');
      if (from > to) {
        throw new UsageError(`--from ${from} is after --to ${to}.`);
      }
      return { command: { name, from, to }, debug };
    }
    case 'correct': {
      const [date, direction, time] = rest;
      if (direction !== 'in' && direction !== 'out') {
        throw new UsageError(`Invalid direction "${direction}", expected in or out.`);
      }
      const request: CorrectionRequest = { date: parseDate(date, 'date'), direction, time: parseTime(time) };
      if (values.comment !== undefined) {
        request.comment = values.comment;
      }
      return { command: { name, request }, debug };
    }
    case 'mcp':
    case 'help':
      return { command: { name }, debug };
  }
}
