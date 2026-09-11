/**
 * The handoff note the dashboard leaves for itself before sending the browser to
 * PayMongo, and which PaymentReturnPage reads when the gateway sends it back.
 *
 * In sessionStorage rather than in memory or in the URL: the round trip leaves
 * the origin entirely, so nothing in React survives it, and the return URLs are
 * configured server-side (PayMongoOptions.SuccessUrl / CancelUrl) and cannot
 * carry state the client picked. Session scope is deliberate — a payment left
 * half-finished should not still be pending in a tab opened tomorrow.
 *
 * Lives here rather than in PaymentReturnPage because the writer is the customer
 * dashboard's payment modal and the reader is the return page: a component
 * importing this from a page is the components/ -> pages/ inversion that the
 * admin side already had.
 */

/** What the dashboard stashes before handing the browser to the gateway. */
export interface PendingPayment {
  invoiceId: string;
  paymentId?: string | null;
}

export const PENDING_PAYMENT_KEY = 'kj_pending_payment';

export function readPendingPayment(): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPayment;
    return parsed && typeof parsed.invoiceId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  try {
    sessionStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch {
    /* private-mode storage failure is not worth surfacing */
  }
}
