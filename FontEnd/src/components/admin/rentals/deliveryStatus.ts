/**
 * Display maps for a rental line's delivery status, shared by the Rentals tab's
 * returns desk and the booking-detail modal, which offer the same actions.
 * Which moves are allowed is DELIVERY_NEXT_STATUSES in bookingApi, mirroring the
 * backend state machine; these only say how each status looks and reads.
 */
import type { DeliveryStatusName } from '../../../api/bookingApi';

/**
 * The three end states an admin actually reads at a glance:
 *   Pending   — grey, still with us, hasn't gone out
 *   Delivered — amber, out on an event
 *   Damaged   — red, out and needs maintenance before it can go anywhere
 * Returned never appears here; those lines leave the desk.
 */
export const DELIVERY_STATUS_STYLE: Record<DeliveryStatusName, { color: string; label: string }> = {
  Pending: { color: 'var(--text-dim)', label: 'Not yet out' },
  Delivered: { color: 'var(--warning)', label: 'Out' },
  Damaged: { color: 'var(--danger)', label: 'Needs maintenance' },
  Returned: { color: 'var(--status-paid)', label: 'Back in stock' },
};

export const DELIVERY_ACTION_LABEL: Record<DeliveryStatusName, string> = {
  Delivered: 'Mark Delivered',
  Returned: 'Return',
  Damaged: 'Mark Damaged',
  Pending: 'Reset to Pending',
};
