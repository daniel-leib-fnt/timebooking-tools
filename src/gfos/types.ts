/** Public contract of the GFOS library, shared by the CLI and the MCP server. */

export type StampDirection = 'in' | 'out';

/** Day type as shown in the GFOS Zeitkonto: LES (worked), ABW (absence), NAZ (account posting). */
export type DayType = 'work' | 'absence' | 'posting' | 'unknown';

export interface Interval {
  /** Clock-in time, HH:MM local time. */
  in: string;
  /** Clock-out time, HH:MM local time; null while clocked in or when the out punch is missing. */
  out: string | null;
}

export interface GfosDay {
  /** YYYY-MM-DD */
  date: string;
  type: DayType;
  /** Raw Typ column, e.g. "LES", "ABW", "NAZ". */
  rawType: string;
  intervals: Interval[];
  /** Ist in decimal hours as computed by GFOS (breaks already deducted); null if not shown. */
  actualHours: number | null;
  /** Soll in decimal hours. */
  targetHours: number | null;
  /** SaldoTag in decimal hours. */
  balanceDay: number | null;
  /** SaldoGes in decimal hours. */
  balanceTotal: number | null;
  /** Absence reason, e.g. "Urlaub", "Feiertag", "Gleitzeitabbau". */
  absenceReason: string | null;
  /** Error hints shown by GFOS, e.g. "Gehtmeldung fehlt". */
  notes: string[];
}

export interface ClockState {
  clockedIn: boolean;
  /** ISO 8601 local date-time of the open clock-in punch, null when clocked out. */
  since: string | null;
  today: GfosDay | null;
}

export interface StampResult {
  direction: StampDirection;
  /** HH:MM as confirmed by GFOS. */
  time: string;
}

export interface CorrectionRequest {
  /** YYYY-MM-DD */
  date: string;
  direction: StampDirection;
  /** HH:MM */
  time: string;
  comment?: string;
}

export interface GfosClient {
  getDays(startDate: string, endDate: string): Promise<GfosDay[]>;
  getClockState(): Promise<ClockState>;
  stamp(direction: StampDirection): Promise<StampResult>;
  requestCorrection(request: CorrectionRequest): Promise<void>;
}

export interface GfosClientOptions {
  /** Log requests and session reuse decisions to stderr. */
  debug?: boolean;
}

/** GFOS host not reachable (typically: VPN not connected). */
export class GfosUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GfosUnreachableError';
  }
}

/** Login rejected or credentials missing. */
export class GfosAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GfosAuthError';
  }
}
