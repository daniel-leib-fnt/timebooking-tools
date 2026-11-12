# timebooking-tools

CLI, MCP server and KDE Plasma widget for the [gfos.Workforce](https://www.gfos.com) time tracking system. CLI and MCP server are thin entry points over one shared GFOS library (`src/gfos/`).

## Setup

### Requirements

- Linux with a Secret Service provider (KeePassXC with Secret Service integration, GNOME Keyring or KWallet) and `secret-tool` (libsecret) for the passwords.
- Network access to GFOS (often VPN only) for the GFOS commands and tools. The calendar feed does not go through GFOS.
- Optional: `notify-send` (libnotify) for `--notify`, KDE Plasma 6 for the widget.
- Manual setup only: Node.js 22 and pnpm. npm is refused.

### With Nix (flake and Home Manager)

Add the flake as an input and import its Home Manager module:

```nix
# flake.nix
inputs.timebooking-tools = {
  url = "github:daniel-leib-fnt/timebooking-tools";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

```nix
# Home Manager configuration (`inputs` passed via extraSpecialArgs)
{ inputs, ... }:
{
  imports = [ inputs.timebooking-tools.homeManagerModules.default ];

  programs.timebooking = {
    enable = true;
    url = "https://gfos.example.com/gfos";
    mandant = "EXAMPLE";
    orgEinheit = "D";
    personalnummer = "12345";
    # stampLog = "/path/to/stamps.jsonl"; # default: $XDG_STATE_HOME/timebooking/stamps.jsonl
    # alwaysRefresh = true; # read every day from GFOS instead of the day cache (see "Day cache")
  };
}
```

The module installs the `timebooking` binary, wrapped with the account settings (so the widget sees them too, without session variables), and the Plasma widget. After switching, add "Timebooking" to a panel. To update, run `nix flake update timebooking-tools` and switch again.

For development, `nix develop` provides Node.js 22 and pnpm; the commands are listed in `AGENTS.md`.

Without Home Manager, `nix run github:daniel-leib-fnt/timebooking-tools -- status` runs the CLI directly; set the variables from [Configuration](#configuration) yourself.

### Manually

```bash
git clone https://github.com/daniel-leib-fnt/timebooking-tools.git
cd timebooking-tools
pnpm install --frozen-lockfile
pnpm build
```

Put a wrapper on your `PATH`, e.g. `~/.local/bin/timebooking`, that sets the variables from [Configuration](#configuration) and starts the CLI:

```bash
#!/bin/sh
export GFOS_URL=https://gfos.example.com/gfos GFOS_MANDANT=EXAMPLE GFOS_ORG_EINHEIT=D GFOS_PERSONALNUMMER=12345
exec node /path/to/timebooking-tools/dist/cli/main.js "$@"
```

Make it executable (`chmod +x`). The widget runs `timebooking` from `plasmashell`, which does not read shell profiles, so the wrapper must be on the session `PATH` and carry the variables itself. Install the widget with `kpackagetool6 -t Plasma/Applet -i plasmoid` (see `plasmoid/README.md`).

### After either setup

1. Store the GFOS password, and the calendar feed URL if you use `get_meetings` (see [Configuration](#configuration)).
2. Check the GFOS access: `timebooking status` prints the clock state and today's net working time. Check the calendar feed: `timebooking meetings` lists today's entries.
3. Optional: register the MCP server with your MCP client (see [MCP server](#mcp-server)); for Claude Code: `claude mcp add --scope user timebooking -- timebooking mcp`.

## CLI

| Command                                                           | Purpose                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `timebooking clock-in [--notify]`                                 | Stamp clock-in                                                               |
| `timebooking clock-out [--notify]`                                | Stamp clock-out                                                              |
| `timebooking status [--json]`                                     | Show the clock state and today's net working time                            |
| `timebooking sync [--from DATE] [--to DATE] [--refresh]`          | Backfill punches from GFOS into the local stamp log                          |
| `timebooking days [--from DATE] [--to DATE] [--json] [--refresh]` | Show the GFOS days (default: today): punches, Ist, absence, notes, when read |
| `timebooking correct <DATE> <in\|out> <HH:MM> [--comment TEXT]`   | Request a correction of a missing or wrong punch                             |
| `timebooking meetings [--from DATE] [--to DATE] [--json]`         | List calendar entries from the ICS feed (default: today); no VPN needed      |
| `timebooking mcp`                                                 | Start the MCP server on stdio                                                |

`timebooking --help` lists all options.

## Configuration

| Variable                     | Description                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `GFOS_URL`                   | Base URL of the GFOS web application, e.g. `https://gfos.example.com/gfos`              |
| `GFOS_MANDANT`               | Mandant, e.g. `FNT`                                                                     |
| `GFOS_ORG_EINHEIT`           | OrgEinheit / Werk, e.g. `D`                                                             |
| `GFOS_PERSONALNUMMER`        | Personalnummer, e.g. `12345`                                                            |
| `GFOS_PASSWORT`              | Password; fallback when the Secret Service has none                                     |
| `TIMEBOOKING_ALWAYS_REFRESH` | `1`: read every requested day from GFOS instead of the day cache (Nix: `alwaysRefresh`) |

The password is looked up with `secret-tool lookup service gfos`. Store it once:

```bash
secret-tool store --label='GFOS' service gfos
```

`get_meetings` reads a published calendar feed (for example Outlook's "Publish calendar" ICS link). The URL contains a secret token, so it is looked up with `secret-tool lookup service calendar-ics`, with `CALENDAR_ICS_URL` as the fallback:

```bash
secret-tool store --label='Calendar ICS' service calendar-ics
```

Times are returned in the local time zone of the process (`TZ`).

The GFOS session is persisted in `$XDG_STATE_HOME/timebooking/session.json` and reused until it expires. GFOS is only reachable over the VPN.

## Day cache

Every day read from GFOS (by the CLI, the MCP server, and clock-in or clock-out) is cached in `$XDG_STATE_HOME/timebooking/days/<yyyy>.json`, one file per year, so past days can be read without the VPN. The widget reads today from the same file.

- GFOS is contacted for today, for days that are not final yet, with `--refresh` (MCP: `refresh: true`), and for every day when `TIMEBOOKING_ALWAYS_REFRESH=1`. A day is final when it was read after it ended and has neither GFOS notes nor an open interval.
- GFOS answers per calendar month, and a month costs the same whether one day or all are read, so a month with one missing day is read as a whole.
- Every day carries `fetchedAt`. Balances (`balanceTotal`) are a snapshot of that time.
- When GFOS is not reachable, the cached data is returned, days that needed GFOS are marked `stale`, the error goes to stderr (MCP: a warning before the data), and the exit code is 2. It fails without data only when a past day was never cached, and always with `--refresh`.
- Today is `source: "local"` while a punch GFOS confirmed is not visible in the Zeitkonto yet (it shows up after 5 to 15 seconds).
- A missing or unreadable file counts as empty and is rewritten.

## MCP server

```json
{
  "mcpServers": {
    "timebooking": {
      "command": "timebooking",
      "args": ["mcp"]
    }
  }
}
```

The tools are read-only. Clocking in and out and corrections stay CLI-only because they change the attendance record. `get_days`, `get_issues` and `get_clock_state` follow the rules of the [day cache](#day-cache).

| Tool              | Input                                                                | Returns                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_days`        | `startDate`, `endDate` (`YYYY-MM-DD`, inclusive), optional `refresh` | One entry per day with a GFOS row: type, clock-in/clock-out intervals, actual and target hours, balances, absence reason, GFOS notes, `fetchedAt`, `source`, `stale` |
| `get_clock_state` | none                                                                 | `clockedIn`, `since`, today's day, `fetchedAt`, `source`, `lastError`, `stale`                                                                                       |
| `get_issues`      | `startDate`, `endDate`, optional `refresh`                           | Only days that need a correction: days with GFOS notes (e.g. missing clock-out) and past days with an open interval                                                  |
| `get_meetings`    | `startDate`, `endDate`                                               | Calendar entries from the ICS feed, recurrences expanded: times, summary, status, busy status, organizer                                                             |

## Plasma widget

`plasmoid/` contains a KDE Plasma 6 widget that shows whether you are clocked in and today's net working time.
