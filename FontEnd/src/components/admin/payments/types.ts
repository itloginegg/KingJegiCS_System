import type { AdminPaymentRecord, RefundRequestQueueItem } from '../../../api/paymentAdminApi';

/**
 * Every PaymentMethod the backend enum can produce, with a badge colour.
 *
 * All seven are covered rather than the four the mockup showed — an enum value with
 * no entry would otherwise render as an unstyled blank pill. Cash is a darkened green
 * on purpose: the light green from the spec fails contrast under white text.
 *
 * Colours are the pill background; the label is always white. Every one clears 4.5:1
 * against white at badge text size — verified, not eyeballed. Maya is a step darker
 * than a natural brand teal for exactly that reason (#0e9594 measured only 3.66:1).
 */
export const METHOD_COLORS: Record<string, string> = {
  Cash: '#157f3d',
  GCash: '#1a73c7',
  Maya: '#0b7d7c',
  BankTransfer: '#4f46b8',
  CreditCard: '#8b3fa0',
  Online: '#b4531a',
  Others: '#5c6670',
};

/** Neutral slate for anything the enum grows later. Never renders blank. */
export const METHOD_FALLBACK_COLOR = METHOD_COLORS.Others;

/** "BankTransfer" → "Bank Transfer". The API sends PascalCase with no separators. */
export const methodLabel = (method: string) =>
  method.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

export const methodColor = (method: string) =>
  METHOD_COLORS[method] ?? METHOD_FALLBACK_COLOR;

/** Remaining refundable balance. Not on the DTO — derived, like the backend's NotMapped property. */
export const refundableRemaining = (p: AdminPaymentRecord) =>
  p.amountPaid - p.refundedAmount;

/**
 * Whether the Refund action can run, and if not, why.
 *
 * Mirrors all three server guards in Paymentservice.RefundAsync so the reason is
 * visible before the click rather than arriving as a 400 after it. The refund-request
 * guard is the one that trips most often: the server refuses to move money that the
 * customer never asked for.
 */
export function refundBlockedReason(p: AdminPaymentRecord): string | null {
  if (p.status !== 'Success' && p.status !== 'PartiallyRefunded') {
    return `Only a successful payment can be refunded — this one is ${p.status}.`;
  }
  if (!p.refundRequested) {
    return 'The customer has not requested a refund on this payment.';
  }
  if (refundableRemaining(p) <= 0) {
    return 'This payment has already been fully refunded.';
  }
  return null;
}

export type PaymentSortKey =
  | 'invoiceId'
  | 'customerName'
  | 'paymentDateTime'
  | 'amountPaid'
  | 'method'
  | 'status';

export type SortDir = 'asc' | 'desc';

export interface PaymentSortState {
  key: PaymentSortKey;
  dir: SortDir;
}

/** Row actions, each wired to a handler that already exists on AdminDashboardPage. */
export interface PaymentRowActions {
  /** Pending → Success. `runPaymentAction(id, 'confirm')` */
  onConfirm: (payment: AdminPaymentRecord) => void;
  /** Pending → Failed. `runPaymentAction(id, 'reject')` */
  onReject: (payment: AdminPaymentRecord) => void;
  /** Opens the refund confirm modal. Never calls the endpoint directly. */
  onRefund: (payment: AdminPaymentRecord) => void;
  /** Opens the deny-reason prompt for an open refund request. */
  onDenyRefund: (payment: AdminPaymentRecord) => void;
}

/** The open refund request for a payment, when there is one. */
export type RefundRequestLookup = (paymentId: string) => RefundRequestQueueItem | undefined;
