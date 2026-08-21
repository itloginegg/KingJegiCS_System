/**
 * Admin Payments API — talks to PaymentsController (Owner/Assistant actions).
 *
 * Endpoint inventory:
 *   GET  /api/Payments/recent?take=N        → newest customer payments w/ context
 *   GET  /api/Payments/refund-requests      → open refund requests review queue
 *   POST /api/Payments/{id}/confirm         → Pending -> Success
 *   POST /api/Payments/{id}/reject          → Pending -> Failed
 *   POST /api/Payments/{id}/refund          → full/partial refund
 *   POST /api/Payments/{id}/deny-refund     → deny an open refund request
 */

import type { PaymentRecord } from './bookingApi';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class PaymentApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'PaymentApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ── Types ──────────────────────────────────────────────────────────────

/** Matches AdminPaymentListItemDto — returned by GET /api/Payments/recent. */
export interface AdminPaymentRecord {
  id: string;
  invoiceId: string;
  amountPaid: number;
  refundedAmount: number;
  paymentDateTime: string;
  method: string;
  status: string;
  transactionReference: string | null;
  gatewayProvider: string | null;
  refundRequested: boolean;
  bookingId: string;
  bookingName: string;
  /** 'FullService' | 'FoodDelivery' | 'RentalService' — drives the Payments type filter. */
  bookingType: string;
  eventType: string | null;
  eventDate: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
}

/** Matches RefundRequestQueueItemDto — one open refund request with booking context. */
export interface RefundRequestQueueItem {
  paymentId: string;
  amountPaid: number;
  refundableRemaining: number;
  requestedAmount: number;
  reason: string | null;
  requestedAt: string | null;
  bookingId: string;
  bookingName: string;
  bookingStatus: string;
  cancellationRequested: boolean;
}

// ── Internal helper ────────────────────────────────────────────────────

async function request<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    const options: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${token}` },
    };
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new PaymentApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new PaymentApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    let message: string | null = null;
    try {
      const parsed = (await res.json()) as { message?: string };
      if (typeof parsed.message === 'string') message = parsed.message;
    } catch {
      /* non-JSON error body */
    }
    throw new PaymentApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Most recent customer payments across all bookings, newest first.
 *
 * `date` ("YYYY-MM-DD") narrows to a single day server-side, before the take cap.
 * Filtering the returned page in the browser instead would report an empty day for
 * any date older than the newest `take` payments.
 */
export function getRecentPayments(
  token: string,
  take = 50,
  date?: string | null,
): Promise<AdminPaymentRecord[]> {
  const qs = new URLSearchParams({ take: String(take) });
  if (date) qs.set('date', date);
  return request<AdminPaymentRecord[]>(`/api/Payments/recent?${qs}`, 'GET', token);
}

/** Open refund requests awaiting the owner's decision. */
export function fetchRefundRequests(token: string): Promise<RefundRequestQueueItem[]> {
  return request<RefundRequestQueueItem[]>('/api/Payments/refund-requests', 'GET', token);
}

/** Confirm a Pending payment actually arrived (Pending -> Success). */
export function confirmPayment(token: string, paymentId: string): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/api/Payments/${paymentId}/confirm`, 'POST', token);
}

/** Reject a Pending payment (wrong amount, never arrived, duplicate) -> Failed. */
export function rejectPayment(token: string, paymentId: string): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/api/Payments/${paymentId}/reject`, 'POST', token);
}

/** Refund an amount from a payment; omit amount for the full remaining balance. */
export function refundPayment(token: string, paymentId: string, amount?: number): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/api/Payments/${paymentId}/refund`, 'POST', token, {
    amount: amount ?? null,
  });
}

/** Deny an open refund request with a reason the customer can see. */
export function denyRefund(token: string, paymentId: string, reason: string): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/api/Payments/${paymentId}/deny-refund`, 'POST', token, { reason });
}
