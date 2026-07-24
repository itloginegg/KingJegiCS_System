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
 *   GET    /api/MenuPackages/{id}/template            → slots + eligible items
 */

const API_BASE_URL = (
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

/** Matches BookingCreateDto on the backend. */
export interface BookingCreatePayload {
  customerId: string;
  bookingType: 'FullService' | 'FoodDelivery';
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

export interface PackageSelectionResponse {
  slotId: string;
  slotLabel: string;
  itemId: string;
  itemName: string;
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
  eventType: string | null;
  eventDate: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
}

/** Owner/Assistant: most recent customer payments across all bookings, newest first. */
export function getRecentPayments(token: string, take = 50): Promise<AdminPaymentRecord[]> {
  return request<AdminPaymentRecord[]>(`/api/Payments/recent?take=${take}`, 'GET', token);
}

export function checkout(token: string, payload: CheckoutPayload): Promise<{ payment: any, checkoutUrl: string }> {
  return request<any>(`/api/Payments/checkout`, 'POST', token, payload);
}
