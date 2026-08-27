/**
 * Reports API — talks to ReportsController (Owner/Assistant only).
 *
 * Endpoint inventory:
 *   GET /api/Reports/monthly-sales?months=          → net collected sales per month
 *   GET /api/Reports/monthly-sales/summary?months=  → short AI read of the same window
 *
 * The two are separate calls on purpose: the figures must render immediately, while the
 * summary may take a round trip to Gemini or be unavailable entirely.
 */

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
}

/** Matches MonthlySalesSummaryDto. `generated` is false when the assistant was unavailable. */
export interface MonthlySalesSummary {
  summary: string;
  generated: boolean;
  generatedAt: string;
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

/** The AI read of the same window. Always resolves — check `generated` before trusting the prose. */
export function getMonthlySalesSummary(token: string, months = 6): Promise<MonthlySalesSummary> {
  return request<MonthlySalesSummary>(`/api/Reports/monthly-sales/summary?months=${months}`, token);
}
