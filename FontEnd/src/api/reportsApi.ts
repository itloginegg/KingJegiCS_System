/**
 * Reports API — talks to ReportsController (Owner/Assistant only).
 *
 * Endpoint inventory:
 *   GET /api/Reports/monthly-sales?months=          → net collected sales per month
 *   GET /api/Reports/monthly-sales/summary?months=  → short AI read of the same window
 *   GET /api/Reports/demand-forecast?horizon=       → booking demand history + forecast
 *
 * The two are separate calls on purpose: the figures must render immediately, while the
 * summary may take a round trip to Gemini or be unavailable entirely.
 */

import { notifyUnauthorized } from '../lib/authEvents';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class ReportsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ReportsApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches MonthlySalesPointDto. Net = gross − refunds, i.e. money actually held. */
export interface MonthlySalesPoint {
  year: number;
  month: number;
  label: string;
  gross: number;
  refunds: number;
  net: number;
  paymentCount: number;
  bookingCount: number;
}

/** Matches MonthlySalesReportDto. */
export interface MonthlySalesReport {
  from: string;
  to: string;
  totalGross: number;
  totalRefunds: number;
  totalNet: number;
  totalPayments: number;
  bestMonthNet: number;
  bestMonthLabel: string | null;
  /** First→last month change as a fraction (0.12 = +12%); null when the first month is zero. */
  netChangeRatio: number | null;
  months: MonthlySalesPoint[];
  /** What earned the window's money, highest net first. Lines add up to totalNet. */
  topPackages: PackageSales[];
}

/**
 * Matches PackageSalesDto. `isPackage` is false for the groups of bookings made without a
 * package ("Custom event (no package)", "Food delivery", "Equipment rental").
 */
export interface PackageSales {
  name: string;
  isPackage: boolean;
  bookings: number;
  net: number;
  /** Fraction of the window's net, 0–1; null when nothing was collected. */
  share: number | null;
}

/** Matches MonthlySalesSummaryDto. `generated` is false when the assistant was unavailable. */
export interface MonthlySalesSummary {
  summary: string;
  generated: boolean;
  generatedAt: string;
}

/**
 * Matches DemandForecastPointDto. History months carry `actual`, `movingAverage` and
 * `fitted`; forecast months carry `forecast`, its `low`–`high` range and `onTheBooks`
 * (bookings already made for that month). Counts are events, by event date.
 */
export interface DemandForecastPoint {
  year: number;
  month: number;
  label: string;
  isForecast: boolean;
  actual: number | null;
  movingAverage: number | null;
  fitted: number | null;
  forecast: number | null;
  low: number | null;
  high: number | null;
  onTheBooks: number;
}

/**
 * Matches DemandForecastDto. `confidence` is 'none' when there are under three finished
 * months of history, in which case every `forecast` is null and `method` says why.
 */
export interface DemandForecast {
  historyFrom: string | null;
  historyTo: string | null;
  historyMonths: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  method: string;
  trendPerMonth: number | null;
  typicalError: number | null;
  /** Calendar month numbers (1–12), busiest first. Empty until a year of history exists. */
  peakMonths: number[];
  months: DemandForecastPoint[];
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

async function request<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ReportsApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    /* 401 only: the token is dead, so AuthProvider ends the session. A 403 is a
       live token without the rights for this call and must not sign anyone out. */
    if (res.status === 401) notifyUnauthorized();
    throw new ReportsApiError(
      'Only an Owner or Assistant account may view sales reports. Sign in again to continue.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ReportsApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

/** Net collected sales for the last `months` whole months, ending with the current one. */
export function getMonthlySales(token: string, months = 6): Promise<MonthlySalesReport> {
  return request<MonthlySalesReport>(`/api/Reports/monthly-sales?months=${months}`, token);
}

/** Booking demand history and a forecast for the next `horizon` months, starting with this one. */
export function getDemandForecast(token: string, horizon = 3): Promise<DemandForecast> {
  return request<DemandForecast>(`/api/Reports/demand-forecast?horizon=${horizon}`, token);
}

/** The AI read of the same window. Always resolves — check `generated` before trusting the prose. */
export function getMonthlySalesSummary(token: string, months = 6): Promise<MonthlySalesSummary> {
  return request<MonthlySalesSummary>(`/api/Reports/monthly-sales/summary?months=${months}`, token);
}
