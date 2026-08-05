/**
 * Booking Wizard API — talks to BookingsController + MenuPackagesController.
 *
 * Endpoint inventory:
 *   POST   /api/Bookings                            → create Draft
 *   GET    /api/Bookings/{id}                        → full detail
 *   POST   /api/Bookings/{id}/menu-items             → add dish line
 *   POST   /api/Bookings/{id}/menu-trays             → add tray line
 *   POST   /api/Bookings/{id}/rentals                → add rental line
 *   POST   /api/Bookings/{id}/services               → add service line
 *   POST   /api/Bookings/{id}/package-selections      → choose slot items
 *   GET    /api/Bookings/{id}/package-selections      → current selections
 *   POST   /api/Bookings/{id}/submit                 → Draft → Pending
 *   GET    /api/Bookings/{id}/history                → revision snapshots (admin)
 *   GET    /api/MenuPackages/{id}/template            → slots + eligible items
 */

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

// ── Error class ────────────────────────────────────────────────────────

export class BookingApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'BookingApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Matches the backend BookingType enum (Models/Booking.cs).
 * RentalService is equipment-only: event-dated and deposit-based like FullService,
 * but it doesn't consume a calendar event slot and reserves on 5% of its total.
 */
export type BookingTypeName = 'FullService' | 'FoodDelivery' | 'RentalService';

/** Display labels, so every screen names the types the same way. */
export const BOOKING_TYPE_LABELS: Record<BookingTypeName, string> = {
  FullService: 'Full Service',
  FoodDelivery: 'Food Delivery',
  RentalService: 'Rental Service',
};

/** Matches BookingCreateDto on the backend. */
export interface BookingCreatePayload {
  customerId: string;
  bookingType: BookingTypeName;
  eventDate: string;          // "YYYY-MM-DD"
  startTime: string;          // "HH:mm:ss"
  endDate?: string | null;
  endTime?: string | null;
  eventType?: string | null;  // "Wedding" | "Corporate" | ...
  venueAddress: string;
  guestCount?: number | null;
  menuPackageId?: string | null;
  contactNumber?: string | null;
}

/** Matches BookingUpdateDto on the backend. */
export interface BookingUpdatePayload {
  bookingName: string;
  eventDate: string;          // "YYYY-MM-DD"
  startTime: string;          // "HH:mm:ss"
  endDate?: string | null;
  endTime?: string | null;
  eventType?: string | null;
  venueAddress: string;
  guestCount?: number | null;
  menuPackageId?: string | null;
  contactNumber?: string | null;
}

/** Matches BookingResponseDto. */
export interface BookingResponse {
  id: string;
  bookingName: string;
  customerId: string;
  bookingType: string;
  eventDate: string;
  startTime: string;
  endDate: string | null;
  endTime: string | null;
  eventType: string | null;
  venueAddress: string;
  contactNumber: string | null;
  guestCount: number | null;
  status: string;
  depositStatus: string;
  totalAmount: number;
  menuPackageId: string | null;
  cancellationRequested: boolean;
  cancellationRequestReason: string | null;
  createdAt: string;
  /** Internal staff note. Always null for a customer — the server only fills it for admins. */
  adminNote: string | null;
}

/** Matches BookingDetailDto — returned by GET /api/Bookings/{id}. */
export interface BookingDetailResponse {
  booking: BookingResponse;
  package: { id: string; packageName: string; basePrice: number; inclusions: string[] } | null;
  rentals: { lineId: string; rentalItemId: string; itemName: string; quantity: number; unitPrice: number; subtotal: number; deliveryStatus: string }[];
  services: { lineId: string; serviceItemId: string; serviceName: string; quantity: number; unitCost: number; totalCost: number }[];
  menuItems: { itemId: string; itemName: string; quantity: number; capturedPrice: number; lineTotal: number }[];
  menuTrays: { trayId: string; trayName: string; quantity: number; capturedPrice: number; lineTotal: number }[];
}

/** Matches the template endpoint response. */
export interface TemplateSlot {
  slotId: string;
  label: string;
  chooseCount: number;
  eligibleItems: { id: string; itemName: string; itemCategory: string; courseCategory: string }[];
}

export interface PackageTemplateResponse {
  packageId: string;
  packageName: string;
  description: string;
  basePrice: number;
  minPax: number;
  maxPax: number;
  inclusions: string[];
  fixedItems: { id: string; itemName: string; itemCategory: string; courseCategory: string }[];
  slots: TemplateSlot[];
}

/** Matches BookingPackageSelectionDto on the backend. */
export interface PackageSelectionResponse {
  slotId: string;
  slotLabel: string;
  menuItemId: string;
  menuItemName: string;
}

/** Matches PaymentResponseDto — one recorded payment against an invoice. */
export interface PaymentRecord {
  id: string;
  invoiceId: string;
  amountPaid: number;
  refundedAmount: number;
  refundableRemaining: number;
  paymentDateTime: string;
  method: string;
  status: string;
  transactionReference: string | null;
  refundRequested: boolean;
  refundRequestedAmount: number | null;
  refundRequestReason: string | null;
  refundRequestDecision: string | null;
}


export interface PaymentMilestoneDto {
  label: string;
  dueDate: string;
  amountDue: number;
  cumulativeDue: number;
  paidToDate: number;
  status: string; // 'Paid' | 'Overdue' | 'Upcoming'
}

export interface PaymentScheduleDto {
  bookingId: string;
  grandTotal: number;
  paidTotal: number;
  balance: number;
  milestones: PaymentMilestoneDto[];
}

export interface InvoiceResponseDto {
  id: string;
  bookingId: string;
  issueDate: string;
  dueDate: string;
  foodTotal: number;
  rentalTotal: number;
  serviceTotal: number;
  taxAmount: number;
  grandTotal: number;
  status: string;
  paidTotal: number;
}

// ── Internal helpers ───────────────────────────────────────────────────

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as any;
    if (typeof body.message === 'string') return body.message;
    if (body.errors && typeof body.errors === 'object') {
      const firstKey = Object.keys(body.errors)[0];
      if (firstKey && Array.isArray(body.errors[firstKey]) && body.errors[firstKey].length > 0) {
        return body.errors[firstKey][0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
    throw new BookingApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new BookingApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new BookingApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ── Public API ─────────────────────────────────────────────────────────

/** Create a Draft booking (wizard Step 2). */
export function createBooking(
  token: string,
  payload: BookingCreatePayload,
): Promise<BookingResponse> {
  return request<BookingResponse>('/api/Bookings', 'POST', token, payload);
}

/** Update an existing Draft booking (wizard Step 2). */
export function updateBooking(
  token: string,
  id: string,
  payload: BookingUpdatePayload,
): Promise<BookingResponse> {
  return request<BookingResponse>(`/api/Bookings/${id}`, 'PUT', token, payload);
}

/** Get booking detail by ID. */
export function getBookingDetail(
  token: string,
  id: string,
): Promise<BookingDetailResponse> {
  return request<BookingDetailResponse>(`/api/Bookings/${id}`, 'GET', token);
}

/** Add a menu item line to a Draft booking. */
export function addMenuItem(
  token: string,
  bookingId: string,
  itemId: string,
  quantity: number,
): Promise<BookingResponse> {
  return request<BookingResponse>(
    `/api/Bookings/${bookingId}/menu-items`,
    'POST',
    token,
    { itemId, quantity },
  );
}

/** Add a menu tray line to a Draft booking. */
export function addMenuTray(
  token: string,
  bookingId: string,
  trayId: string,
  quantity: number,
): Promise<BookingResponse> {
  return request<BookingResponse>(
    `/api/Bookings/${bookingId}/menu-trays`,
    'POST',
    token,
    { trayId, quantity },
  );
}

/** Add a rental item line to a Draft booking. */
export function addRental(
  token: string,
  bookingId: string,
  rentalItemId: string,
  quantity: number,
): Promise<BookingResponse> {
  return request<BookingResponse>(
    `/api/Bookings/${bookingId}/rentals`,
    'POST',
    token,
    { rentalItemId, quantity },
  );
}

/** Add a service item line to a Draft booking. */
export function addService(
  token: string,
  bookingId: string,
  serviceItemId: string,
  quantity: number,
): Promise<BookingResponse> {
  return request<BookingResponse>(
    `/api/Bookings/${bookingId}/services`,
    'POST',
    token,
    { serviceItemId, quantity },
  );
}

/** Set the slot selections for a package slot. Replaces any prior choice for that slot. */
export function chooseSlotItems(
  token: string,
  bookingId: string,
  slotId: string,
  itemIds: string[],
): Promise<PackageSelectionResponse[]> {
  return request<PackageSelectionResponse[]>(
    `/api/Bookings/${bookingId}/package-selections`,
    'POST',
    token,
    { slotId, itemIds },
  );
}

/** Get current package slot selections for a booking. */
export function getPackageSelections(
  token: string,
  bookingId: string,
): Promise<PackageSelectionResponse[]> {
  return request<PackageSelectionResponse[]>(
    `/api/Bookings/${bookingId}/package-selections`,
    'GET',
    token,
  );
}

/** Submit a Draft booking → Pending. */
export function submitBooking(
  token: string,
  bookingId: string,
): Promise<BookingResponse> {
  return request<BookingResponse>(
    `/api/Bookings/${bookingId}/submit`,
    'POST',
    token,
  );
}

/** Fetch the package template (slots + eligible items) for the selection UI. */
export function getPackageTemplate(
  token: string,
  packageId: string,
): Promise<PackageTemplateResponse> {
  return request<PackageTemplateResponse>(
    `/api/MenuPackages/${packageId}/template`,
    'GET',
    token,
  );
}

/** Set the package for a booking. */
export function setBookingPackage(
  token: string,
  bookingId: string,
  menuPackageId: string | null,
): Promise<BookingResponse> {
  return request<BookingResponse>(
    `/api/Bookings/${bookingId}/package`,
    'POST',
    token,
    { menuPackageId },
  );
}

// ── Admin Actions ────────────────────────────────────────────────────────

export function getAllBookings(token: string, status?: string): Promise<BookingResponse[]> {
  const query = status && status !== 'all' ? `?status=${status}` : '';
  return request<BookingResponse[]>(`/api/Bookings${query}`, 'GET', token);
}

export function confirmBooking(token: string, bookingId: string): Promise<BookingResponse> {
  return request<BookingResponse>(`/api/Bookings/${bookingId}/confirm`, 'POST', token);
}

export function completeBooking(token: string, bookingId: string): Promise<BookingResponse> {
  return request<BookingResponse>(`/api/Bookings/${bookingId}/complete`, 'POST', token);
}

export function cancelBooking(token: string, bookingId: string): Promise<BookingResponse> {
  return request<BookingResponse>(`/api/Bookings/${bookingId}/cancel`, 'POST', token);
}

/**
 * Deletes an abandoned Draft booking. Draft-only server-side; anything further along
 * returns 400 and must be cancelled instead.
 */
export function deleteDraftBooking(token: string, bookingId: string): Promise<void> {
  return request<void>(`/api/Bookings/${bookingId}`, 'DELETE', token);
}

/**
 * Fire-and-forget variant for page unload. `keepalive` lets the browser finish the
 * request after the page starts tearing down, which a plain fetch won't — but it's
 * still best-effort, so the backend's DraftCleanupWorker is the real guarantee, not
 * this call. Never throws.
 */
export function deleteDraftBookingOnUnload(token: string, bookingId: string): void {
  try {
    void fetch(`${API_BASE_URL}/api/Bookings/${bookingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* unload-time failures are expected; the sweep cleans up */
  }
}

/**
 * Owner/Assistant: set or clear a booking's internal staff note. Send null/empty to
 * clear. Separate from updateBooking because that path is Draft-only, while a note is
 * most useful on a Confirmed booking.
 */
export function setBookingAdminNote(
  token: string,
  bookingId: string,
  note: string | null,
): Promise<BookingResponse> {
  return request<BookingResponse>(`/api/Bookings/${bookingId}/admin-note`, 'PUT', token, { note });
}

/**
 * Customer files a cancellation request for their CONFIRMED booking
 * (Draft/Pending bookings should use cancelBooking directly).
 */
export function requestCancellation(
  token: string,
  bookingId: string,
  reason?: string,
): Promise<{ message?: string }> {
  return request<{ message?: string }>(
    `/api/Bookings/${bookingId}/request-cancellation`,
    'POST',
    token,
    { reason: reason ?? null },
  );
}

/** Owner/Assistant: generate the invoice for a Confirmed booking. */
export function generateInvoice(
  token: string,
  bookingId: string,
  issueDate: string,
  dueDate: string,
): Promise<InvoiceResponseDto> {
  return request<InvoiceResponseDto>('/api/Invoices', 'POST', token, {
    bookingId, issueDate, dueDate,
  });
}

/** Owner/Assistant: mark a Draft invoice as Sent to the customer. */
export function sendInvoice(token: string, invoiceId: string): Promise<InvoiceResponseDto> {
  return request<InvoiceResponseDto>(`/api/Invoices/${invoiceId}/send`, 'POST', token);
}


// ── Payments and Invoices ──────────────────────────────────────────────

export function getPaymentSchedule(token: string, bookingId: string): Promise<PaymentScheduleDto> {
  return request<PaymentScheduleDto>(`/api/Bookings/${bookingId}/payment-schedule`, 'GET', token);
}

export function getInvoiceByBooking(token: string, bookingId: string): Promise<InvoiceResponseDto> {
  return request<InvoiceResponseDto>(`/api/Invoices/booking/${bookingId}`, 'GET', token);
}

export interface CheckoutPayload {
  invoiceId: string;
  amount: number;
}

/** Invoice by its own id (customers may only read their own booking's invoice). */
export function getInvoiceById(token: string, invoiceId: string): Promise<InvoiceResponseDto> {
  return request<InvoiceResponseDto>(`/api/Invoices/${invoiceId}`, 'GET', token);
}

/** All payments recorded against one invoice, oldest first. */
export function getPaymentsByInvoice(token: string, invoiceId: string): Promise<PaymentRecord[]> {
  return request<PaymentRecord[]>(`/api/Payments/invoice/${invoiceId}`, 'GET', token);
}

/** Customer files a refund request on their payment (omit amount = full remaining). */
export function requestRefund(
  token: string,
  paymentId: string,
  payload: { amount?: number; reason?: string } = {},
): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/api/Payments/${paymentId}/request-refund`, 'POST', token, {
    amount: payload.amount ?? null,
    reason: payload.reason ?? null,
  });
}

export function checkout(token: string, payload: CheckoutPayload): Promise<{ payment: any, checkoutUrl: string }> {
  return request<any>(`/api/Payments/checkout`, 'POST', token, payload);
}

// ── Revision history ───────────────────────────────────────────────────

/**
 * Matches BookingHistoryResponseDto. `snapshotJson` is the serialized BEFORE-state
 * of the booking, written by Bookingservice.WriteHistorySnapshotAsync ahead of every
 * mutating call — so revision N holds what the booking looked like *before* the
 * change that produced revision N+1. `changedById` is null when the customer or the
 * system made the change rather than an admin.
 */
export interface BookingHistoryEntry {
  id: string;
  bookingId: string;
  changedById: string | null;
  changeReason: string | null;
  revisionNumber: number;
  snapshotJson: string;
  snapshotAt: string;
}

/** Owner/Assistant: the append-only revision history for a booking, oldest first. */
export function getBookingHistory(token: string, bookingId: string): Promise<BookingHistoryEntry[]> {
  return request<BookingHistoryEntry[]>(`/api/Bookings/${bookingId}/history`, 'GET', token);
}
