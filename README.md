# timebooking-tools

CLI, MCP server and KDE Plasma widget for the [gfos.Workforce](https://www.gfos.com) time tracking system. CLI and MCP server are thin entry points over one shared GFOS library (`src/gfos/`).

## Build

```bash
npm install
npm run build
```

This provides the `timebooking` binary (`dist/cli/main.js`).

## CLI

| Command                                                         | Purpose                                             |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `timebooking clock-in [--notify]`                               | Stamp clock-in                                      |
| `timebooking clock-out [--notify]`                              | Stamp clock-out                                     |
| `timebooking status [--json]`                                   | Show the clock state and today's net working time   |
| `timebooking sync [--from DATE] [--to DATE]`                    | Backfill punches from GFOS into the local stamp log |
| `timebooking correct <DATE> <in\|out> <HH:MM> [--comment TEXT]` | Request a correction of a missing or wrong punch    |
| `timebooking mcp`                                               | Start the MCP server on stdio                       |

`timebooking --help` lists all options.

## Configuration

| Variable              | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `GFOS_URL`            | Base URL of the GFOS web application, e.g. `https://gfos.example.com/gfos` |
| `GFOS_MANDANT`        | Mandant, e.g. `FNT`                                                        |
| `GFOS_ORG_EINHEIT`    | OrgEinheit / Werk, e.g. `D`                                                |
| `GFOS_PERSONALNUMMER` | Personalnummer, e.g. `12345`                                               |
| `GFOS_PASSWORT`       | Password; fallback when the Secret Service has none                        |

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

The tools are read-only. Clocking in and out and corrections stay CLI-only because they change the attendance record.

| Tool              | Input                                            | Returns                                                                                                              |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `get_days`        | `startDate`, `endDate` (`YYYY-MM-DD`, inclusive) | One entry per day: type, clock-in/clock-out intervals, actual and target hours, balances, absence reason, GFOS notes |
| `get_clock_state` | none                                             | `clockedIn`, `since`, and today's day                                                                                |
| `get_issues`      | `startDate`, `endDate`                           | Only days that need a correction: days with GFOS notes (e.g. missing clock-out) and past days with an open interval  |
| `get_meetings`    | `startDate`, `endDate`                           | Calendar entries from the ICS feed, recurrences expanded: times, summary, status, busy status, organizer             |

## Plasma widget

`plasmoid/` contains a KDE Plasma 6 widget that shows whether you are clocked in and today's net working time.
