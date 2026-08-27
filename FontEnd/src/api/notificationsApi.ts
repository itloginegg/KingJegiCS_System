/**
 * Notifications API — talks to NotificationsController.
 *
 * Endpoint inventory:
 *   GET  /api/Notifications?take=      → the caller's feed + unread count
 *   POST /api/Notifications/{id}/read  → mark one read
 *   POST /api/Notifications/read-all   → mark everything read
 *
 * One route pair serves both audiences — the caller's role decides which feed comes
 * back (staff get the owner-directed alerts, a customer gets their own bookings'), so
 * neither dashboard has to branch on role to fetch.
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class NotificationApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'NotificationApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches NotificationResponseDto. Title/Body are derived server-side from the kind. */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  bookingId: string | null;
  bookingName: string | null;
  sentAt: string;
  readAt: string | null;
  /**
   * The specific entity this is about, when there is one — the payment for
   * payment/refund kinds, the message for chat kinds, the line for BookingItemAdded.
   * Null for kinds that route on `bookingId` instead. See notificationTarget().
   */
  targetId: string | null;
}

/**
 * Where clicking a notification should take you. Kept here, next to the DTO it reads,
 * so both dashboards route identically instead of each growing its own switch.
 *
 *   booking  → the Bookings tab, with that booking's detail open (uses `bookingId`)
 *   payment  → the Payments tab, expanded on `targetId` when present
 *   chat     → the support conversation
 *   none     → no navigation; the notification is informational (reminders, digests)
 */
export type NotificationTarget = 'booking' | 'payment' | 'chat' | 'none';

const BOOKING_KINDS = [
  'BookingCreated',
  'BookingCompleted',
  'BookingCancelled',
  'BookingCancelledStaff',
  'BookingCancellationRequested',
  'BookingConfirmed',
  'BookingItemAdded',
];

const PAYMENT_KINDS = [
  'PaymentRecorded',
  'PaymentConfirmed',
  'PaymentDueSoon',
  'PaymentOverdue',
  'PaymentOverdueDigest',
  'RefundRequested',
  'RefundApproved',
  'RefundDenied',
];

const CHAT_KINDS = ['SupportMessageFromCustomer', 'SupportMessageFromStaff'];

export function notificationTarget(n: AppNotification): NotificationTarget {
  if (CHAT_KINDS.includes(n.kind)) return 'chat';
  // A booking kind with no bookingId can't be routed to, so don't pretend it can.
  if (BOOKING_KINDS.includes(n.kind)) return n.bookingId ? 'booking' : 'none';
  if (PAYMENT_KINDS.includes(n.kind)) return 'payment';
  // RentalLowStock and anything added later: no meaningful destination yet.
  return 'none';
}

/** Matches NotificationFeedDto. */
export interface NotificationFeed {
  unreadCount: number;
  items: AppNotification[];
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

async function request<T>(path: string, method: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new NotificationApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new NotificationApiError(
      'Your session has expired. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new NotificationApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** The caller's notifications, newest first, with the unread count for the bell badge. */
export function getNotifications(token: string, take = 30): Promise<NotificationFeed> {
  return request<NotificationFeed>(`/api/Notifications?take=${take}`, 'GET', token);
}

/** Marks one notification read. */
export function markNotificationRead(token: string, id: string): Promise<void> {
  return request<void>(`/api/Notifications/${id}/read`, 'POST', token);
}

/** Marks every unread notification in the caller's feed read. */
export function markAllNotificationsRead(token: string): Promise<{ markedRead: number }> {
  return request<{ markedRead: number }>('/api/Notifications/read-all', 'POST', token);
}
