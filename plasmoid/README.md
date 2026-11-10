# Timebooking plasmoid

KDE Plasma 6 panel widget that shows whether you are clocked in at GFOS and today's net working time.

- Clocked in: green, counting up (`H:MM`).
- Not clocked in: red, static (`H:MM`), blinking permanently.
- Warning icon when the status is only local (`source: "local"`) or has `lastError`; the tooltip shows the error, today's intervals and the last update time.
- Left click: `timebooking clock-out --notify` when clocked in, otherwise `timebooking clock-in --notify`. The time is dimmed while the command runs.
- Middle click opens the full view (intervals, Clock in / Clock out buttons); the context menu offers the same actions plus "Refresh from GFOS".

Net time uses the same break rule as `src/worktime.ts` (ported to `contents/ui/worktime.js`, in seconds instead of minutes); keep both in sync.

## Data flow

The widget never talks to GFOS itself. Through the Plasma5Support `executable` engine it:

- reads `${XDG_STATE_HOME:-$HOME/.local/state}/timebooking/status.json` with `cat` every 30 s,
- runs `timebooking status --json` every 5 min (and at start) to refresh that file from GFOS; failures are ignored, the file keeps its last state.

A status file with a `date` other than today counts as not clocked in with no intervals. `timebooking` must be on the `PATH` of `plasmashell`.

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
tmp=$(mktemp -d); mkdir -p "$tmp/state/timebooking" "$tmp/bin"
printf '#!/bin/sh\necho "$*" >> "%s/calls.log"\n' "$tmp" > "$tmp/bin/timebooking"; chmod +x "$tmp/bin/timebooking"
cat > "$tmp/state/timebooking/status.json" <<EOF
{"version":1,"updatedAt":"$(date -Iseconds)","date":"$(date +%F)","clockedIn":true,"intervals":[{"in":"07:30","out":"12:00"},{"in":"12:30","out":null}],"source":"gfos","lastError":null}
EOF
PATH="$tmp/bin:$PATH" XDG_STATE_HOME="$tmp/state" nix shell nixpkgs#kdePackages.plasma-sdk -c plasmoidviewer -a ./plasmoid
```

Edit the status file to switch states; the widget picks changes up within 30 s.
