/**
 * The customer dashboard's domain vocabulary: what an event is called, what a
 * booking's status derives to, and how money and dates are written on the
 * customer surfaces.
 *
 * Split out of CustomerDashboardPage so the modals in DashboardModals.tsx can use
 * it without importing from a page — the same components/ → pages/ inversion that
 * the admin side had, and it would have come straight back the moment those
 * modals moved.
 *
 * NOTE ON THE FORMATTERS. They deliberately do NOT reuse lib/format. The admin
 * `fmt` writes whole pesos and a short month because it is scanning tables; these
 * write centavos and a long month because a customer is reading an amount they
 * are about to pay and a date they are planning around. Same names, different
 * output — which is exactly why they must not be merged by their names alone.
 */
import React from 'react';
import {
  HeartHandshake, Truck, Package, CalendarDays,
  Cake, PartyPopper, Building2, } from 'lucide-react';
import type { BookingResponse as BookingResponseDto } from '../../api/bookingApi';

/**
 * An event type string → an EVENT_META key.
 *
 * The 'wedding' default is for an UNRECOGNISED event type, not for a missing one.
 * Callers must not hand it null and trust the answer — see bookingMeta, which
 * resolves event-less booking types before it ever gets here.
 */
export const normalizeType = (ty: string | null) => {
  if (!ty) return 'wedding';
  const l = ty.toLowerCase();
  if (l.includes('wed')) return 'wedding';
  if (l.includes('birth')) return 'birthday';
  if (l.includes('debut')) return 'debut';
  if (l.includes('corp')) return 'corporate';
  /* EventType.Others is a real, selectable enum member, not an unknown value.
     Without this branch it fell to the default below and a customer who booked
     "Other" was told on their own dashboard that they had a wedding. */
  if (l.includes('other')) return 'others';
  return 'wedding';
};


export const EVENT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  wedding: { label: 'Wedding Event', icon: <HeartHandshake size={16} /> },
  birthday: { label: 'Birthday Celebration', icon: <Cake size={16} /> },
  debut: { label: 'Debut Celebration', icon: <PartyPopper size={16} /> },
  corporate: { label: 'Corporate Event', icon: <Building2 size={16} /> },
  delivery: { label: 'Food Delivery', icon: <Truck size={16} /> },
  rental: { label: 'Equipment Rental', icon: <Package size={16} /> },
  others: { label: 'Special Event', icon: <CalendarDays size={16} /> },
};

/**
 * Booking types that carry NO eventType at all, and what to show in its place.
 *
 * A table rather than a chain of ternaries because this bug has now been found
 * twice. FoodDelivery fell through to normalizeType(null) → 'wedding' and every
 * delivery rendered as "Wedding Event"; that was patched with a single branch on
 * FoodDelivery. RentalService then gained a null eventType of its own — the
 * backend had been wrongly demanding one — and walked straight into the same
 * hole, because the branch named one type instead of describing the category.
 *
 * A new event-less booking type now needs a row here, and nothing can quietly
 * inherit a wedding by omission.
 */
const EVENTLESS_TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  FoodDelivery: EVENT_META.delivery,
  RentalService: EVENT_META.rental,
};

/**
 * The right EVENT_META entry for a booking.
 *
 * Event-less types resolve FIRST, by table. Only a booking that genuinely has an
 * eventType reaches normalizeType, whose 'wedding' default is then a sane answer
 * to "unrecognised event type" rather than a wrong answer to "no event type".
 */
export const bookingMeta = (booking: { bookingType: string; eventType: string | null }) =>
  EVENTLESS_TYPE_META[booking.bookingType] ??
  EVENT_META[normalizeType(booking.eventType)] ??
  EVENT_META.wedding;

/**
 * The statuses a customer actually sees, keyed so the filter dropdown can match on
 * something stable rather than on display text.
 *
 * Derived from `booking.status` + `booking.depositStatus` — never from the invoice.
 * The invoice was the wrong source twice over: its status is a different enum
 * (Draft/Sent/Reserved/PartiallyPaid/Overdue/Paid), so comparisons against deposit
 * words like "Unpaid" and "Partial" could never match, and a Confirmed booking with a
 * PartiallyPaid invoice fell through to the generic fallback and displayed
 * "Pending Approval". DepositStatus is always present and is computed by the server
 * from real payments, so it needs no admin action to be correct.
 */
export type BookingStatusKey =
  | 'draft'
  | 'awaiting_fee'
  | 'awaiting_confirmation'
  | 'confirmed_balance'
  | 'confirmed_paid'
  // Completed splits on payment exactly as confirmed does. A booking can legitimately
  // be Completed with money still owed — CompleteBookingAsync gates on the event's end
  // time having passed, not on the invoice being settled — so a single "Completed"
  // label would hide a real outstanding balance from both staff and customer.
  | 'completed_balance'
  | 'completed_paid'
  | 'cancelled';

export interface DerivedBookingStatus {
  key: BookingStatusKey;
  label: string;
  color: string;
}

/**
 * Ramp roles only — the same rule RES_STATUS and PAYMENT_STATUS follow in
 * AdminDashboardPage, and for the same reason recorded there: --accent is the
 * forest that collides with --status-paid, and --primary renders as near-black
 * body text rather than a status. This map was the last place still using them.
 *
 * --success was worse than inconsistent: it is not defined anywhere. StatusBadge
 * builds its background and border with color-mix() from the colour it is given,
 * so an unknown token invalidated all three declarations at once and a "Paid"
 * badge rendered as borderless inherited text.
 *
 * The colour carries the MONEY state and the label carries the lifecycle, which
 * is why awaiting_confirmation and confirmed_balance share a hue: both are
 * part-paid, and their labels already say which is confirmed.
 *
 * Every value clears 4.5:1 against the 12% tint of itself that StatusBadge lays
 * down — measured, because that tint costs about 0.8 and it is what rules out
 * --warning (4.27) and plain --danger (4.01) here. Cancelled therefore takes
 * --danger-ink, which exists for exactly this and measures 5.60 / 5.39, and
 * Draft takes --text-secondary rather than --text-dim, which failed at 3.97 in
 * dark mode.
 */
export const DERIVED_STATUS: Record<BookingStatusKey, { label: string; color: string }> = {
  draft: { label: 'Draft — Not Submitted', color: 'var(--text-secondary)' },
  awaiting_fee: { label: 'Awaiting Reservation Fee', color: 'var(--status-unpaid)' },
  // Money is on file but the date is NOT secured yet — a walk-in deliberately doesn't
  // auto-confirm, so calling this "Confirmed" would promise a slot nobody has held.
  awaiting_confirmation: { label: 'Payment Received — Awaiting Confirmation', color: 'var(--status-partial)' },
  confirmed_balance: { label: 'Confirmed · Awaiting Balance', color: 'var(--status-partial)' },
  confirmed_paid: { label: 'Confirmed · Fully Paid', color: 'var(--status-paid)' },
  // Not a success colour: the event happened, but there is money outstanding and the
  // row should not read as finished business. --status-unpaid is literally that role.
  completed_balance: { label: 'Completed · Balance Due', color: 'var(--status-unpaid)' },
  completed_paid: { label: 'Completed · Paid', color: 'var(--status-info)' },
  cancelled: { label: 'Cancelled', color: 'var(--danger-ink)' },
};

/** Every label the filter can offer, in the order a booking travels through them. */
export const BOOKING_STATUS_ORDER: BookingStatusKey[] = [
  'draft', 'awaiting_fee', 'awaiting_confirmation',
  'confirmed_balance', 'confirmed_paid',
  'completed_balance', 'completed_paid', 'cancelled',
];

/**
 * Pure and invoice-free, so the same answer is available anywhere a booking is —
 * the card, the detail modal, and (next) the status filter.
 */
export function derivedStatusOf(booking: BookingResponseDto): DerivedBookingStatus {
  const status = (booking.status ?? '').toLowerCase();
  const deposit = (booking.depositStatus ?? '').toLowerCase();

  // Lifecycle first: Cancelled and Completed are admin-asserted facts about the event
  // and must never be overridden by how much has been paid. Payment only ever refines
  // the label WITHIN a lifecycle state — it never moves a booking out of one, so a
  // fully-paid booking still reads as Completed, and an unpaid one still reads as
  // Completed rather than being demoted back to Confirmed.
  const key: BookingStatusKey =
    status.includes('cancel') ? 'cancelled'
      : status === 'completed' ? (deposit === 'paid' ? 'completed_paid' : 'completed_balance')
      : status === 'draft' ? 'draft'
      : status === 'confirmed'
        // Confirmed with nothing on file shouldn't happen (ConfirmBookingAsync refuses
        // while Unpaid) but can arise after a full refund — read it as "balance owed"
        // rather than inventing a state.
        ? (deposit === 'paid' ? 'confirmed_paid' : 'confirmed_balance')
        // Pending, and anything unrecognised: the question is simply whether the
        // reservation fee has landed.
        : deposit === 'unpaid' ? 'awaiting_fee'
          : 'awaiting_confirmation';

  return { key, ...DERIVED_STATUS[key] };
}

export const fmt = (n: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

export const fmtDate = (iso: string) => {

  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
};

/**
 * "14:30:00" → "2:30 PM". The API sends TimeOnly as HH:mm:ss, which isn't a date, so
 * it's parsed positionally rather than through Date(). Null/absent renders as an
 * em dash (a FoodDelivery order has no end time at all).
 */
export const fmtTime = (hms: string | null | undefined) => {
  if (!hms) return '—';
  const [h, m] = hms.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};
