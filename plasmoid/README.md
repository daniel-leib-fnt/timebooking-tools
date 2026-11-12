# Timebooking plasmoid

KDE Plasma 6 panel widget that shows whether you are clocked in at GFOS and today's net working time.

- No stamps today (no cache file, or no entry for today): `-:--` in black.
- Clocked in: green, counting up (`H:MM`).
- Clocked out after stamping today: red, static (`H:MM`), blinking permanently.
- Warning icon when the cache has a `lastError`, today has no data yet, or the last refresh failed; the tooltip shows the error, today's intervals and when they were read from GFOS.
- Left click opens the popup: net time, today's stamps and one button, "Clock in" or "Clock out" depending on the state. A click on the panel never stamps.
- Opening the popup refreshes from GFOS. The button is enabled only while GFOS confirmed the state within the last minute without error, because a stale state would send the wrong direction (GFOS stamps alternate). The popup stays open after a stamp and shows the confirmed result or the error.
- The context menu offers "Refresh from GFOS".
- Texts are German when the system locale starts with `de`, else English (`texts` in `main.qml`).

Net time uses the same break rule as `src/worktime.ts` (ported to `contents/ui/worktime.js`, in seconds instead of minutes); `src/worktime-plasmoid.test.ts` fails when the two differ.

## Data flow

The widget never talks to GFOS itself. Through the Plasma5Support `executable` engine it:

- reads the CLI's day cache `${XDG_STATE_HOME:-$HOME/.local/state}/timebooking/days/<yyyy>.json` (current year) with `cat` every 10 s, so every CLI or MCP call that reads GFOS (also `timebooking status` in a console) shows up within 10 s,
- runs `timebooking status` only when the popup opens and from the context menu; stamping runs `timebooking clock-in|clock-out`, which reads today afterwards. There is no periodic refresh, so the widget causes no GFOS traffic while the VPN is down. It ignores stdout; a non-zero exit code shows stderr as the error, and the CLI records failures in the file's `lastError`.

Today is the entry `days["<yyyy-mm-dd>"]`: `day.intervals`, `fetchedAt` and `source` (`"local"` while a punch GFOS confirmed is not in the Zeitkonto yet). Clocked in means the last interval has no `out`. `timebooking` must be on the `PATH` of `plasmashell`.

## Install for testing

```sh
kpackagetool6 -t Plasma/Applet -i plasmoid    # first install
kpackagetool6 -t Plasma/Applet -u plasmoid    # after changes
kpackagetool6 -t Plasma/Applet -r com.github.daniel-leib-fnt.timebooking   # remove
```

Then add "Timebooking" to a panel. After an upgrade, restart Plasma (`systemctl --user restart plasma-plasmashell`) to load the new QML.

## Try it without touching GFOS

`plasmoidviewer` is in `plasma-sdk`. Use a throwaway state directory and a fake `timebooking` script earlier on `PATH`, so clicks never change the real attendance record:

```sh
tmp=$(mktemp -d); mkdir -p "$tmp/state/timebooking/days" "$tmp/bin"
printf '#!/bin/sh\necho "$*" >> "%s/calls.log"\n' "$tmp" > "$tmp/bin/timebooking"; chmod +x "$tmp/bin/timebooking"
cat > "$tmp/state/timebooking/days/$(date +%Y).json" <<EOF
{"version":1,"lastError":null,"days":{"$(date +%F)":{"fetchedAt":"$(date -Iseconds)","source":"gfos","day":{"date":"$(date +%F)","type":"work","rawType":"LES","intervals":[{"in":"07:30","out":"12:00"},{"in":"12:30","out":null}],"actualHours":null,"targetHours":null,"balanceDay":null,"balanceTotal":null,"absenceReason":null,"notes":[]}}}}
EOF
PATH="$tmp/bin:$PATH" XDG_STATE_HOME="$tmp/state" nix shell nixpkgs#kdePackages.plasma-sdk -c plasmoidviewer -a ./plasmoid
```

Edit the cache file to switch states; the widget picks changes up within 10 s.
