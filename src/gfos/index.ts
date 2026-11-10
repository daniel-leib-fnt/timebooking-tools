export * from './types';
import { requestCorrection, stamp } from './actions';
import { withSession } from './session';
import { ClockState, GfosClient, GfosClientOptions } from './types';
import { fetchDays, localDate } from './zeitkonto';

export function createGfosClient(options: GfosClientOptions = {}): GfosClient {
  const getDays = (startDate: string, endDate: string) => withSession(options, (session) => fetchDays(session, startDate, endDate));

  return {
    getDays,
    async getClockState(): Promise<ClockState> {
      const date = localDate(new Date());
      const today = (await getDays(date, date))[0] ?? null;
      const last = today?.intervals.at(-1);
      const open = last !== undefined && last.out === null;
      return { clockedIn: open, since: open ? `${date}T${last.in}:00` : null, today };
    },
    stamp: (direction) => stamp(options, direction),
    requestCorrection: (request) => requestCorrection(options, request),
  };
}
