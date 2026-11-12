import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fetchMeetings } from '../calendar/index.js';
import { CachedGfosClient, createGfosClient, describeGfosError, GfosDay, GfosUnreachableError } from '../gfos/index.js';

// Read-only on purpose: stamping and corrections change the attendance record and stay CLI-only.

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a valid date');

const dateRangeSchema = {
  startDate: dateSchema.describe('Start date, YYYY-MM-DD'),
  endDate: dateSchema.describe('End date, YYYY-MM-DD (inclusive)'),
};

const cachedRangeSchema = {
  ...dateRangeSchema,
  refresh: z
    .boolean()
    .optional()
    .describe('Read every day from GFOS instead of the local cache; fails when GFOS is not reachable (needs the VPN). Default false.'),
};

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** JSON result; when the cache answered because GFOS failed, a warning comes first. */
function cachedResult(value: unknown, error: unknown): ToolResult {
  const result = jsonResult(value);
  if (error !== null) {
    result.content.unshift({
      type: 'text',
      text: `Warning: ${describeGfosError(error)} Days marked "stale": true are the cached state of their "fetchedAt".`,
    });
  }
  return result;
}

async function runTool(action: () => Promise<unknown | ToolResult>): Promise<ToolResult> {
  try {
    const value = await action();
    return isToolResult(value) ? value : jsonResult(value);
  } catch (err: unknown) {
    if (err instanceof GfosUnreachableError) {
      return errorResult(`GFOS is not reachable (${err.message}). Check that the VPN is connected.`);
    }
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as ToolResult).content);
}

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function hasIssue(day: GfosDay, today: string): boolean {
  const hasOpenInterval = day.intervals.some((interval) => interval.out === null);
  return day.notes.length > 0 || (day.date < today && hasOpenInterval);
}

export async function startMcpServer(): Promise<void> {
  const client = new CachedGfosClient(createGfosClient());
  const server = new McpServer({ name: 'timebooking', version: '0.1.0' });

  // @ts-expect-error MCP SDK Zod inference causes TS2589; runtime behavior is correct
  server.registerTool(
    'get_days',
    {
      description:
        'Fetch the GFOS time account per day for a date range: day type, clock-in/clock-out intervals, ' +
        'actual and target hours, daily and total balance, absence reason and GFOS error notes. ' +
        'Days without a GFOS row (weekends, nothing booked) are left out. Final past days come from a local cache, ' +
        'so this works without the VPN; today and days not final yet are read from GFOS when it is reachable. ' +
        'Each day has "fetchedAt" (when it was read from GFOS; balances are a snapshot of that time), ' +
        '"source" ("local" while a confirmed punch is not in the Zeitkonto yet) and "stale": true when GFOS was not reachable.',
      inputSchema: cachedRangeSchema,
    },
    async ({ startDate, endDate, refresh }) =>
      startDate > endDate
        ? errorResult('startDate must be before or equal to endDate.')
        : runTool(async () => {
            const { days, error } = await client.getDays(startDate, endDate, { refresh });
            return cachedResult(days, error);
          }),
  );

  server.registerTool(
    'get_clock_state',
    {
      description:
        "Return whether the user is currently clocked in, since when (HH:MM), and today's GFOS day, read from GFOS. " +
        'When GFOS is not reachable, the cached state is returned with "stale": true and "fetchedAt".',
    },
    async () =>
      runTool(async () => {
        const { error, ...status } = await client.getClockStatus();
        return cachedResult(status, error);
      }),
  );

  server.registerTool(
    'get_issues',
    {
      description:
        'Return only the days in a date range that need a GFOS correction: days with GFOS error notes ' +
        '(e.g. missing clock-out) and past days with an open interval. Same shape and cache rules as get_days.',
      inputSchema: cachedRangeSchema,
    },
    async ({ startDate, endDate, refresh }) => {
      if (startDate > endDate) {
        return errorResult('startDate must be before or equal to endDate.');
      }
      return runTool(async () => {
        const today = localToday();
        const { days, error } = await client.getDays(startDate, endDate, { refresh });
        return cachedResult(
          days.filter((day) => hasIssue(day, today)),
          error,
        );
      });
    },
  );

  server.registerTool(
    'get_meetings',
    {
      description:
        'Fetch the calendar entries of a date range from the published ICS feed, recurrences expanded, in local time: ' +
        'start, end, all-day flag, summary, status (TENTATIVE, CANCELLED), Outlook busy status (BUSY, TENTATIVE, FREE, OOF), ' +
        'transparency, organizer and the start of the description. Does not need the VPN.',
      inputSchema: dateRangeSchema,
    },
    async ({ startDate, endDate }) =>
      startDate > endDate ? errorResult('startDate must be before or equal to endDate.') : runTool(() => fetchMeetings(startDate, endDate)),
  );

  await server.connect(new StdioServerTransport());
}
