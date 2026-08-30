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
  /**
   * Event-type-specific details. The server rejects fields that don't belong to the
   * chosen eventType (see EventDetailRules), so send only the applicable set — the
   * helper `eventDetailFieldsFor` below says which that is.
   */
  groomName?: string | null;
  brideName?: string | null;
  celebrantName?: string | null;
  celebrantSex?: string | null;
  celebrantAge?: number | null;
  eventName?: string | null;
  motif?: string | null;
  theme?: string | null;
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
  groomName?: string | null;
  brideName?: string | null;
  celebrantName?: string | null;
  celebrantSex?: string | null;
  celebrantAge?: number | null;
  eventName?: string | null;
  motif?: string | null;
  theme?: string | null;
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
  /**
   * Who created it: 'Customer' (self-service) or 'WalkIn' (an admin, on their behalf).
   * Read-only — set once at creation and never accepted on input.
   */
  source: 'Customer' | 'WalkIn';
  totalAmount: number;
  menuPackageId: string | null;
  cancellationRequested: boolean;
  cancellationRequestReason: string | null;
  createdAt: string;
  /** Internal staff note. Always null for a customer — the server only fills it for admins. */
  adminNote: string | null;

  // Event-type-specific details. Whichever set doesn't apply to `eventType` is null.
  groomName: string | null;
  brideName: string | null;
  celebrantName: string | null;
  celebrantSex: string | null;
  celebrantAge: number | null;
  eventName: string | null;

  motif: string | null;
  motifImageUrl: string | null;
  theme: string | null;
  themeImageUrl: string | null;

  /**
   * Resource-plan summary, for the admin list's "Edit Resources" affordance.
   *
   * null means EITHER no plan has been saved OR this particular response didn't load
   * it — only the list and detail reads populate it, never a mutation response. Treat
   * null as "unknown/none" and refetch rather than concluding a plan was deleted.
   */
  resourceAllocation: { isApproved: boolean; updatedAt: string } | null;

  /**
   * Customer and package display fields, joined into the list and detail reads.
   *
   * Same caveat as `resourceAllocation`: null means EITHER the value is genuinely
   * absent OR this particular response didn't load the join. Only the reads populate
   * them — every mutation response leaves them null, so re-render a row from the list
   * rather than from a confirm/cancel result if you need these cells to stay filled.
   *
   * `bookingName` already contains the customer's full name (the server generates it
   * as "{full name} - {event type}"), so prefer it for display; `customerName` is here
   * for callers that want the name unparsed.
   */
  customerName: string | null;
  customerEmail: string | null;
  packageName: string | null;
}

/** Which event-detail fields the server will accept for a given event type. */
export function eventDetailFieldsFor(
  eventType: string | null | undefined,
): 'couple' | 'celebrant' | 'named' | 'none' {
  if (eventType === 'Wedding') return 'couple';
  if (eventType === 'Birthday' || eventType === 'Debut') return 'celebrant';
  if (eventType === 'Corporate' || eventType === 'Others') return 'named';
  return 'none';
}

/**
 * Display names for the EventType enum.
 *
 * The enum value is not the label: `Others` shows as "Other" in the booking wizard,
 * and a raw enum should never reach a heading or subtitle.
 */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  Wedding: 'Wedding',
  Corporate: 'Corporate Event',
  Birthday: 'Birthday Party',
  Debut: 'Debut',
  Others: 'Other',
};

/** Enum → label, falling back to the raw value for anything unmapped. */
export function eventTypeLabel(eventType: string | null | undefined): string | null {
  if (!eventType) return null;
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

/** Matches BookingDetailDto — returned by GET /api/Bookings/{id}. */
/**
 * The rental delivery lifecycle, mirroring Models/DeliveryStatus.
 *
 * Legal moves, enforced by Rentalservice.UpdateDeliveryStatusAsync — the UI must not
 * offer anything outside this set, or the request comes back 400:
 *   Pending   -> Delivered
 *   Delivered -> Returned | Damaged
 *   Damaged   -> Returned   (repaired or written off)
 * Returned is terminal.
 */
export type DeliveryStatusName = 'Pending' | 'Delivered' | 'Returned' | 'Damaged';

/** The moves the returns desk can make from each status. Drives which buttons render. */
export const DELIVERY_NEXT_STATUSES: Record<DeliveryStatusName, DeliveryStatusName[]> = {
  Pending: ['Delivered'],
  Delivered: ['Returned', 'Damaged'],
  Damaged: ['Returned'],
  Returned: [],
};

/** One rental line still awaiting an admin action. Matches OutstandingRentalLineDto. */
export interface OutstandingRentalLine {
  rentalId: string;
  bookingId: string;
  customerName: string;
  eventDate: string;
  endDate: string | null;
  rentalItemId: string;
  itemName: string;
  quantity: number;
  deliveryStatus: DeliveryStatusName;
  damageNote: string | null;
}

export interface BookingDetailResponse {
  booking: BookingResponse;
  package: { id: string; packageName: string; basePrice: number; inclusions: string[] } | null;
  rentals: { lineId: string; rentalItemId: string; itemName: string; quantity: number; unitPrice: number; subtotal: number; deliveryStatus: DeliveryStatusName; damageNote: string | null }[];
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
/** Matches CashPaymentResultDto — what logging cash changed, in one response. */
export interface CashPaymentResult {
  payment: PaymentRecord;
  bookingId: string;
  /** The booking's status AFTER the payment. Walk-ins stay Pending by design. */
  bookingStatus: string;
  /** Off 'Unpaid' once the reservation fee is covered — this is what gates Confirm. */
  depositStatus: string;
  invoiceGrandTotal: number;
  invoicePaidTotal: number;
}

/**
 * Owner/Assistant: log cash and verify it in one call.
 *
 * Distinct from the generic record-a-payment endpoint, which leaves the payment
 * Pending for someone to verify later — a step that makes sense for a bank transfer
 * but not for cash in an admin's hand. Because this runs the deposit sync
 * immediately, the booking's Confirm button becomes usable straight away; the
 * returned depositStatus is what the caller should re-render from.
 */
export function recordCashPayment(
  token: string,
  payload: { invoiceId: string; amountPaid: number; transactionReference?: string | null; paymentDateTime?: string | null },
): Promise<CashPaymentResult> {
  return request<CashPaymentResult>('/api/Payments/cash', 'POST', token, {
    invoiceId: payload.invoiceId,
    amountPaid: payload.amountPaid,
    transactionReference: payload.transactionReference?.trim() || null,
    paymentDateTime: payload.paymentDateTime ?? null,
  });
}

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

// ── Rental returns / check-in ──────────────────────────────────────────

/**
 * Owner/Assistant: every rental line still needing an action, across all bookings —
 * Pending, Delivered or Damaged, ordered by event date. Returned lines are done and
 * do not appear.
 */
export function getOutstandingRentals(token: string): Promise<OutstandingRentalLine[]> {
  return request<OutstandingRentalLine[]>('/api/Bookings/rentals/outstanding', 'GET', token);
}

/**
 * Move a rental line along its lifecycle. `damageNote` is required by the backend when
 * `status` is 'Damaged' and ignored otherwise.
 *
 * Returning a line is what frees its stock for other bookings; Damaged keeps holding the
 * stock until the line is resolved, so a broken item can't quietly become bookable again.
 */
export function updateRentalDeliveryStatus(
  token: string,
  bookingId: string,
  rentalId: string,
  status: DeliveryStatusName,
  damageNote?: string,
): Promise<{ id: string; itemName: string; quantity: number; deliveryStatus: DeliveryStatusName; damageNote: string | null }> {
  return request(
    `/api/Bookings/${bookingId}/rentals/${rentalId}/delivery-status`,
    'PUT',
    token,
    { deliveryStatus: status, damageNote: damageNote ?? null },
  );
}

// ── Event resource allocation (admin) ──────────────────────────────────
//
// Operational planning: which rental items and services are held for one event.
// Carries no price and never touches the booking total or invoice — which is exactly
// why, unlike the priced rentals/services lines, it can be edited on a Confirmed
// booking. It DOES consume rental stock. See Bookingresourceallocation.cs for the
// full rationale.

/** Matches BookingResourcesDto. */
export interface BookingResources {
  bookingId: string;
  eventType: string | null;
  guestCount: number | null;
  isApproved: boolean;
  approvedAt: string | null;
  updatedAt: string | null;
  /**
   * The plan: which specific rental items and services are held for this event. An
   * empty list is a real state ("nothing assigned yet").
   */
  lines: AllocationLine[];
  /** Active rental items available to assign, with remaining stock for this booking's dates. */
  rentalCatalog: AllocationCatalogItem[];
  /** Active services available to assign. Services carry no stock. */
  serviceCatalog: AllocationCatalogItem[];
}

/** One saved assignment. Matches AllocationLineDto. */
export interface AllocationLine {
  id: string;
  kind: 'Rental' | 'Service';
  itemId: string;
  name: string;
  quantity: number;
  /** Remaining stock EXCLUDING this booking's own hold. null for services. */
  available: number | null;
}

/** A pickable catalog row. Matches AllocationCatalogItemDto. */
export interface AllocationCatalogItem {
  id: string;
  name: string;
  category: string | null;
  available: number | null;
  /**
   * What the SystemSettings guest-count ratios imply for this item — the replacement
   * for the old per-section SUGGEST buttons. null when no ratio applies to the item
   * (linens, lights, an ambiguously named table, an unrecognised service) or the
   * booking has no guest count; the SUGGEST control is hidden in that case rather than
   * offering a meaningless 0.
   */
  suggestedQuantity: number | null;
}

/** One requested assignment. Exactly one id is set. Matches SaveAllocationLineDto. */
export interface SaveAllocationLine {
  rentalItemId?: string | null;
  serviceItemId?: string | null;
  quantity: number;
}

/** The plan-level sign-off plus the assignments. Matches SaveResourceAllocationDto. */
export interface SaveResourcesPayload {
  /** Approves the RESOURCE PLAN. Does not change the booking's status. */
  isApproved: boolean;
  /**
   * The COMPLETE desired set of assignments — the server replaces the plan's lines
   * with exactly these. Omit to leave existing lines untouched; send [] to clear them.
   */
  lines?: SaveAllocationLine[];
}

/** Read a booking's resource plan and the suggestion for it. Owner/Assistant only. */
export function getBookingResources(
  token: string,
  bookingId: string,
): Promise<BookingResources> {
  return request<BookingResources>(`/api/Bookings/${bookingId}/resources`, 'GET', token);
}

/** Create or replace a booking's resource plan. Owner/Assistant only. */
export function saveBookingResources(
  token: string,
  bookingId: string,
  payload: SaveResourcesPayload,
): Promise<BookingResources> {
  return request<BookingResources>(`/api/Bookings/${bookingId}/resources`, 'PUT', token, payload);
}

// ── Motif & theme reference images ─────────────────────────────────────

/**
 * Uploads a reference image, replacing any previous one for that field.
 *
 * Multipart rather than JSON, so it can't go through `request` — that helper sets a
 * JSON Content-Type, and a multipart body needs the browser to set the header itself
 * (it has to append the boundary token, which we can't know here).
 */
async function uploadBookingImage(
  token: string,
  bookingId: string,
  kind: 'motif' | 'theme',
  file: File,
): Promise<BookingResponse> {
  const form = new FormData();
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Bookings/${bookingId}/${kind}-image`, {
      method: 'POST',
      // Deliberately no Content-Type — see above.
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
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
  return (await res.json()) as BookingResponse;
}

export function uploadMotifImage(token: string, bookingId: string, file: File) {
  return uploadBookingImage(token, bookingId, 'motif', file);
}

export function uploadThemeImage(token: string, bookingId: string, file: File) {
  return uploadBookingImage(token, bookingId, 'theme', file);
}

/**
 * Client-side guard mirroring ImageUploadHelper.ValidateImage, so an oversized or
 * wrong-typed file is refused before it is uploaded rather than after. The server
 * still enforces both — this is for feedback speed, not security.
 */
export const REFERENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REFERENCE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateReferenceImage(file: File): string | null {
  if (!REFERENCE_IMAGE_TYPES.includes(file.type)) {
    return 'Please choose a JPG, PNG, or WebP image.';
  }
  if (file.size > REFERENCE_IMAGE_MAX_BYTES) {
    return 'That image is larger than 5 MB. Please choose a smaller file.';
  }
  return null;
}
