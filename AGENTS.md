<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Last updated: 2026-11-10 | Last verified: 2026-11-10 -->

# AGENTS.md

CLI, MCP server and KDE Plasma 6 widget for the gfos.Workforce time tracking system. This repository is **public**.

## Public repository: no personal or sensitive data

Everything committed here is world-readable, including the git history. Rewriting published history is expensive, so check before every commit.

| Never commit                                                                                               | Use instead                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Real attendance data: clock-in/out times, hours, balances, vacation days, absence reasons of a real person | Invented values that keep the edge case being tested                                                               |
| GFOS pages captured from a live account without scrubbing                                                  | Fixtures with every time, hour, balance and vacation count replaced by synthetic values (see `src/gfos/fixtures/`) |
| Personalnummer, Mandant/Werk of a real account in examples                                                 | `12345`, generic examples                                                                                          |
| Internal hostnames, IPs, VPN details, the employer's GFOS URL                                              | `https://gfos.example.com/gfos`; the URL is configured via `GFOS_URL`, there is no default                         |
| Passwords, session files (`session.json`), cookies, `PARAM` or `ViewState` tokens                          | Secret Service (`secret-tool`), `$XDG_STATE_HOME/timebooking/` (outside the repo)                                  |
| Stamp logs (`stamps.jsonl`), `status.json`, `--debug` output                                               | Hand-written samples                                                                                               |
| Personal paths (`/home/<user>/…`), private emails, ticket keys                                             | Relative paths, placeholders                                                                                       |

- Before committing, review `git diff --cached` for the items above. A new fixture from GFOS must be scrubbed first; state that its values are synthetic in its header comment.
- If sensitive data was already committed or pushed: stop and tell the user. Do not try to fix it with a follow-up commit; it stays in history.

## Commands

Node is not on the system PATH; use the dev shell (`nix develop`) or prefix with `nix shell nixpkgs#nodejs_22 -c`.

| Task          | Command                                                     |
| ------------- | ----------------------------------------------------------- |
| Install       | `npm install`                                               |
| Build         | `npm run build` (tsc → `dist/`)                             |
| Typecheck     | `npx tsc --noEmit`                                          |
| Test (all)    | `npm test` (builds, then `node --test 'dist/**/*.test.js'`) |
| Test (single) | `npx tsc && node --test dist/gfos/zeitkonto.test.js`        |
| Format        | `npm run format` (prettier, config in `.prettierrc.json`)   |
| Format check  | `npm run format:check`                                      |
| Nix package   | `nix build .#default`, `nix build .#plasmoid`               |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run format:check` and `npm test` on every push to `main` and every pull request. There is no linter. Tests run from `dist/`; fixtures are read from `src/gfos/fixtures/`.

`.prettierignore` excludes the fixtures (parser input, must stay byte-identical to the captured structure) and `plasmoid/contents/ui/worktime.js` (QML JavaScript with `.pragma library`, which prettier cannot parse).

When `package-lock.json` changes, update `npmDepsHash` in `nix/package.nix` (`nix shell nixpkgs#prefetch-npm-deps -c prefetch-npm-deps package-lock.json`).

## File Map

```
src/gfos/       shared GFOS library (session, login, Zeitkonto parser, stamp/correction actions); public contract in types.ts
src/calendar/   calendar entries from a published ICS feed, recurrences expanded (ical.js)
src/cli/        `timebooking` CLI (args, commands, local state files)
src/mcp/        MCP server on stdio (`timebooking mcp`), read-only tools
src/worktime.ts net working time incl. German break rule (ArbZG §4)
src/status.ts   status file format shared with the widget
plasmoid/       KDE Plasma 6 widget (QML); talks only to the CLI, never to GFOS
nix/            package, plasmoid and Home Manager module (programs.timebooking)
```

## Key Decisions

- CLI and MCP server are thin entry points over `src/gfos/`; GFOS logic belongs in the library.
- MCP tools are read-only. Clock-in/out and correction requests stay CLI-only, because they change the attendance record.
- The widget never contacts GFOS; it runs `timebooking` and reads `status.json`.
- The widget never stamps on a panel click: stamping needs the popup button and a state GFOS confirmed within the last minute, because GFOS stamps alternate and a stale state sends the wrong direction.
- The Zeitkonto shows a stamp only 6 to 16 s after it was made; after a confirmed stamp the CLI applies the punch itself (`applyPunch` in `src/cli/commands.ts`).
- Account settings come from environment variables (`GFOS_URL`, `GFOS_MANDANT`, `GFOS_ORG_EINHEIT`, `GFOS_PERSONALNUMMER`); the password comes from the Secret Service (`service=gfos`), `GFOS_PASSWORT` is only a fallback.
- The calendar feed URL carries a secret token: it comes from the Secret Service (`service=calendar-ics`), `CALENDAR_ICS_URL` is only a fallback. The calendar does not go through GFOS and does not need the VPN.

## Boundaries

### Always

- Add or update tests for parser and worktime changes; show `npm test` output before claiming done. A break rule change goes into both `src/worktime.ts` and `plasmoid/contents/ui/worktime.js`; `src/worktime-plasmoid.test.ts` compares them.
- Run `npm run format` before committing; CI fails on unformatted files.
- Conventional Commits: `type(scope): subject`.
- Testing the widget or CLI manually: use a throwaway `XDG_STATE_HOME` and a fake `timebooking` (see `plasmoid/README.md`), so the real attendance record is never touched.

### Ask first

- Running `clock-in`, `clock-out` or `correct` against a real GFOS account.
- Adding dependencies.
- Rewriting git history or force-pushing.

### Never

- Commit the data listed in "Public repository" above.
- Edit `dist/` or `node_modules/`.

## Terminology

| Term                                       | Means                                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Zeitkonto                                  | GFOS time account page, one row per punch/absence/posting per day |
| Kommen / Gehen                             | Clock-in / clock-out                                              |
| Ist / Soll                                 | Actual / target hours                                             |
| SaldoTag / SaldoGes                        | Daily / cumulative balance                                        |
| LES / ABW / NAZ                            | Day types: worked, absence, account posting                       |
| Personalnummer, Mandant, OrgEinheit (Werk) | GFOS login identifiers                                            |
