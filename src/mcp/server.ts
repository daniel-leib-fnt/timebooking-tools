import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createGfosClient, GfosDay, GfosUnreachableError } from '../gfos/index.js';

// Read-only on purpose: stamping and corrections change the attendance record and stay CLI-only.

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a valid date');

const dateRangeSchema = {
  startDate: dateSchema.describe('Start date, YYYY-MM-DD'),
  endDate: dateSchema.describe('End date, YYYY-MM-DD (inclusive)'),
};

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function runTool(action: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return jsonResult(await action());
  } catch (err: unknown) {
    if (err instanceof GfosUnreachableError) {
      return errorResult(`GFOS is not reachable (${err.message}). Check that the VPN is connected.`);
    }
    return errorResult(err instanceof Error ? err.message : String(err));
  }
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
  const client = createGfosClient();
  const server = new McpServer({ name: 'timebooking', version: '0.1.0' });

  // @ts-expect-error MCP SDK Zod inference causes TS2589; runtime behavior is correct
  server.registerTool(
    'get_days',
    {
      description:
        'Fetch the GFOS time account per day for a date range: day type, clock-in/clock-out intervals, ' +
        'actual and target hours, daily and total balance, absence reason and GFOS error notes.',
      inputSchema: dateRangeSchema,
    },
    async ({ startDate, endDate }) =>
      startDate > endDate
        ? errorResult('startDate must be before or equal to endDate.')
        : runTool(() => client.getDays(startDate, endDate))
  );

  server.registerTool(
    'get_clock_state',
    {
      description: 'Return whether the user is currently clocked in, since when, and today\'s GFOS day.',
    },
    async () => runTool(() => client.getClockState())
  );

  server.registerTool(
    'get_issues',
    {
      description:
        'Return only the days in a date range that need a GFOS correction: days with GFOS error notes ' +
        '(e.g. missing clock-out) and past days with an open interval. Same shape as get_days.',
      inputSchema: dateRangeSchema,
    },
    async ({ startDate, endDate }) => {
      if (startDate > endDate) {
        return errorResult('startDate must be before or equal to endDate.');
      }
      return runTool(async () => {
        const today = localToday();
        return (await client.getDays(startDate, endDate)).filter((day) => hasIssue(day, today));
      });
    }
  );

  await server.connect(new StdioServerTransport());
}
