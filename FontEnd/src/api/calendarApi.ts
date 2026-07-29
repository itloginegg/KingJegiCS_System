/**
 * Calendar API — talks to CalendarDaysController.
 *
 * Endpoint inventory:
 *   GET /api/CalendarDays?from=&to=  → real per-day lock state (anonymous)
 *   PUT /api/CalendarDays/lock       → manually lock/unlock a day (Owner/Assistant)
 *
 * The read is the single source of truth for "is this date available": it returns the
 * same numbers Calendarday.RecalculateLock() derives on the server, so no caller has to
 * invent a threshold of its own.
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class CalendarApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'CalendarApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches CalendarDayResponseDto on the backend. */
export interface CalendarDay {
  /** "YYYY-MM-DD". */
  date: string;
  maxCapacity: number;
  confirmedCount: number;
  /** True only when an admin explicitly locked the day. */
  isManuallyLocked: boolean;
  /** The derived flag: isManuallyLocked || confirmedCount >= maxCapacity. */
  isLocked: boolean;
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as any;
    if (typeof body.message === 'string') return body.message;
    return null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, method: string, token?: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const options: RequestInit = { method, headers: {} };
    if (token) options.headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new CalendarApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new CalendarApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new CalendarApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/**
 * Real calendar state for a date range (inclusive, max 400 days). Dates with no row
 * have never been booked and are simply absent — treat a miss as open and unlocked.
 * Anonymous: the landing page and the booking form both call this without a token.
 */
export function getCalendarDays(from: string, to: string): Promise<CalendarDay[]> {
  return request<CalendarDay[]>(
    `/api/CalendarDays?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    'GET',
  );
}

/**
 * Owner/Assistant: manually lock or unlock a day. Unlocking clears only the manual
 * flag — a day already at capacity stays locked, since the server re-derives isLocked.
 */
export function setDayLock(
  token: string,
  date: string,
  isManuallyLocked: boolean,
): Promise<CalendarDay> {
  return request<CalendarDay>('/api/CalendarDays/lock', 'PUT', token, { date, isManuallyLocked });
}

/** Convenience: builds a "YYYY-MM-DD" key the same way every calendar in the app does. */
export function toDateKey(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
