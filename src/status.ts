/**
 * Status file written by the CLI and read by the Plasma widget.
 * Location: $XDG_STATE_HOME/timebooking/status.json (default ~/.local/state/timebooking/status.json).
 */

import { Interval } from './gfos/types';

export interface StatusFile {
  version: 1;
  /** ISO 8601 date-time of the last write. */
  updatedAt: string;
  /** YYYY-MM-DD the intervals belong to. */
  date: string;
  clockedIn: boolean;
  /** Today's intervals, HH:MM local time; the last one has out=null while clocked in. */
  intervals: Interval[];
  /** "gfos" when confirmed by GFOS, "local" when the last action could not reach GFOS. */
  source: 'gfos' | 'local';
  lastError: string | null;
}
