/**
 * Status → badge colour, for the maps more than one admin surface reads.
 *
 * WHY EVERY ENTRY IS A SINGLE COLOUR. StatusBadge derives its wash and its
 * hairline from one value with color-mix, so a map never names a fill and an ink
 * separately — see StatusBadge.tsx.
 *
 * WHY THE RAMP AND NOT --primary / --accent. Those two were the original choice
 * and it did not survive a re-skin: under the teal palette --accent was a bronze,
 * under the plum direction a rose that collided with --danger, and under the
 * green direction it is the forest #1B7C3D that collides with --status-paid.
 * Either way Pending stopped being separable from Confirmed, and Confirmed on
 * --primary rendered as near-black body text rather than as a status. The
 * --status-* ramp exists precisely so these stay separable; see index.css.
 *
 * WHY THE INK VARIANTS. StatusBadge lays the colour on a 12% tint of ITSELF, and
 * that ground costs about 0.8:1 — measured, not assumed. Against it --warning
 * came out at 4.27 and --danger at 4.01, so Pending and Cancelled were failing AA
 * while every ramp role beside them passed. --warning-ink and --danger-ink are
 * the tokens for text on their own tint; the ramp roles need no such variant
 * because they were tuned as text to begin with. Draft moves off --text-dim for
 * the same reason: 3.97 in dark mode.
 */

export type ResStatus = 'Draft' | 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';

export const RES_STATUS: Record<ResStatus, { label: string; color: string }> = {
  Draft: { label: 'Draft', color: 'var(--text-secondary)' },
  Pending: { label: 'Pending', color: 'var(--warning-ink)' },
  Confirmed: { label: 'Confirmed', color: 'var(--status-paid)' },
  Completed: { label: 'Completed', color: 'var(--status-info)' },
  Cancelled: { label: 'Cancelled', color: 'var(--danger-ink)' },
};

/**
 * Booking.DepositStatus → badge colour.
 *
 * Deliberately NOT the Payment record's status map, despite both being "payment"
 * colours: that one is keyed by Pending/Success/Failed/PartiallyRefunded/Refunded
 * and shares not one key with DepositStatus. Reusing it would silently fall
 * through to the grey default on every booking row.
 */
export type DepositStatusKey = 'Unpaid' | 'Reserved' | 'Partial' | 'Paid';

export const DEPOSIT_STATUS: Record<DepositStatusKey, { label: string; color: string }> = {
  Unpaid: { label: 'Unpaid', color: 'var(--status-unpaid)' },
  Reserved: { label: 'Reserved', color: 'var(--status-info)' },
  Partial: { label: 'Partial', color: 'var(--status-partial)' },
  Paid: { label: 'Paid', color: 'var(--status-paid)' },
};

/** Enum order, for sorting the Payment Status column by progress rather than alphabet. */
export const DEPOSIT_STATUS_ORDER: DepositStatusKey[] = ['Unpaid', 'Reserved', 'Partial', 'Paid'];

export const depositStatusMeta = (status: string) =>
  DEPOSIT_STATUS[status as DepositStatusKey] ?? { label: status, color: 'var(--text-secondary)' };
