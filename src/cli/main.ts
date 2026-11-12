#!/usr/bin/env node
import { createGfosClient } from '../gfos';
import { GfosClient, GfosClientOptions, GfosUnreachableError } from '../gfos/types';
import { CliArgs, HELP, parseCliArgs, UsageError } from './args';
import { correct, describeError, stamp, status, sync } from './commands';
import { meetings } from './meetings';

/** `createClient` is a parameter so a fake client can be injected for manual testing. */
export async function run(argv: string[], createClient: (options: GfosClientOptions) => GfosClient = createGfosClient): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv, new Date());
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\nRun "timebooking --help" for usage.`);
      return 1;
    }
    throw error;
  }

  const { command } = args;
  if (command.name === 'help') {
    console.log(HELP);
    return 0;
  }
  if (command.name === 'mcp') {
    // Loaded lazily so the other commands do not pull in the MCP SDK.
    const { startMcpServer } = await import('../mcp/server');
    await startMcpServer();
    return 0;
  }
  if (command.name === 'meetings') {
    // The calendar does not go through GFOS, so no GFOS client and no VPN are needed.
    try {
      await meetings(command, { json: command.json });
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  try {
    const client = createClient({ debug: args.debug });
    switch (command.name) {
      case 'clock-in':
        await stamp(client, 'in', { notify: command.notify });
        break;
      case 'clock-out':
        await stamp(client, 'out', { notify: command.notify });
        break;
      case 'status':
        await status(client, { json: command.json });
        break;
      case 'sync':
        await sync(client, command);
        break;
      case 'correct':
        await correct(client, command.request);
        break;
    }
    return 0;
  } catch (error) {
    console.error(describeError(error));
    if (args.debug && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return error instanceof GfosUnreachableError ? 2 : 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
