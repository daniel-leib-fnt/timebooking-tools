// Net working time rule; must stay identical to src/worktime.ts in the CLI.
.pragma library

const SIX_HOURS = 6 * 3600;
const NINE_HOURS = 9 * 3600;

// "HH:MM" on the day of `now` -> seconds since local midnight.
function toSeconds(hhmm) {
    const parts = hhmm.split(":");
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60;
}

// intervals: [{in: "HH:MM", out: "HH:MM" | null}], sorted; an open interval counts until `now`.
// Returns net seconds.
function netSeconds(intervals, now) {
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    let gross = 0;
    let taken = 0;
    let prevOut = null;
    for (const iv of intervals) {
        const start = toSeconds(iv.in);
        const end = iv.out ? toSeconds(iv.out) : nowSec;
        gross += Math.max(0, end - start);
        if (prevOut !== null) {
            taken += Math.max(0, start - prevOut);
        }
        prevOut = end;
    }

    // 30 min above 6 h; 45 min in total if still above 9 h after that. Never below the triggering threshold.
    let net = gross;
    let deducted = 0;
    if (net > SIX_HOURS) {
        deducted = Math.max(0, 30 * 60 - taken);
        net = Math.max(SIX_HOURS, net - deducted);
    }
    if (net > NINE_HOURS) {
        net = Math.max(NINE_HOURS, net - Math.max(0, 45 * 60 - taken - deducted));
    }
    return net;
}

// seconds -> "H:MM".
function format(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + ":" + (m < 10 ? "0" : "") + m;
}
