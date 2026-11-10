/**
 * Net working time of one day, as GFOS computes the Ist.
 *
 * The break rule mirrors GFOS (German ArbZG §4), verified against the GFOS Ist: more than 6 h require 30 min
 * break, and if the time is still above 9 h after that, 45 min in total. Gaps between intervals count as break
 * already taken; only the missing rest is deducted, and never so much that net drops below the threshold that
 * triggered the deduction. Example: 9:16 h gross without break gives 8:46 h, not 9:00 h.
 *
 * Self-contained on purpose: the Plasma widget ports this function to JavaScript one to one.
 */

const SIX_HOURS = 6 * 60;
const NINE_HOURS = 9 * 60;

/** HH:MM local time; out is null while the interval is open. */
export interface WorkInterval {
  in: string;
  out: string | null;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Net working minutes; an open interval counts until now. Intervals must be in chronological order. */
export function netMinutes(intervals: WorkInterval[], now: Date): number {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let gross = 0;
  let breakTaken = 0;
  let previousOut: number | null = null;
  for (const interval of intervals) {
    const start = toMinutes(interval.in);
    const end = interval.out === null ? nowMinutes : toMinutes(interval.out);
    gross += Math.max(0, end - start);
    if (previousOut !== null) {
      breakTaken += Math.max(0, start - previousOut);
    }
    previousOut = end;
  }

  let net = gross;
  let deducted = 0;
  if (net > SIX_HOURS) {
    deducted = Math.max(0, 30 - breakTaken);
    net = Math.max(SIX_HOURS, net - deducted);
  }
  if (net > NINE_HOURS) {
    net = Math.max(NINE_HOURS, net - Math.max(0, 45 - breakTaken - deducted));
  }
  return net;
}
