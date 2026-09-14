import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmt, fmtDate, fmtDateTime, fmtTime } from '../lib/format';
import { StatusBadge, FieldLabel } from '../components/admin/shared/StatusBadge';
import { RES_STATUS, type ResStatus } from '../components/admin/shared/statusMeta';

import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HubConnectionBuilder } from '@microsoft/signalr';
import {
  LayoutGrid, CalendarDays, Wallet, Package, Star,
  UtensilsCrossed, Tent, Wrench, ScrollText, Megaphone, Circle, CalendarClock,
  X, LogOut, Users,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { readSession } from '../lib/tokenStorage';
import { AdminPackagesTab } from './AdminPackagesTab';
import {
  getAllBookings,
  confirmBooking,
  completeBooking,
  cancelBooking,
  submitBooking,
  generateInvoice,
  getBookingDetail,
  getInvoiceByBooking,
  getOutstandingRentals,
  updateRentalDeliveryStatus,
  BookingApiError,
  BOOKING_TYPE_LABELS,
  DELIVERY_NEXT_STATUSES,
  type OutstandingRentalLine,
  type DeliveryStatusName,
  type CashPaymentResult,
  type BookingTypeName,
  type BookingResponse,
  type BookingDetailResponse,
  type InvoiceResponseDto,
} from '../api/bookingApi';
import { API_BASE_URL } from '../api/bookingApi';
import {
  getRecentPayments,
  fetchRefundRequests,
  confirmPayment,
  rejectPayment,
  refundPayment,
  denyRefund,
  PaymentApiError,
  type AdminPaymentRecord,
  type RefundRequestQueueItem,
} from '../api/paymentAdminApi';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notificationTarget,
  type AppNotification,
} from '../api/notificationsApi';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { BookingsTreeMenu } from '../components/admin/bookings/BookingsTreeMenu';
import type { BookingGroupKey, BookingRowActions } from '../components/admin/bookings/types';
import { CashPaymentModal } from '../components/admin/CashPaymentModal';
import { DraftItemsEditor } from '../components/admin/DraftItemsEditor';
import EventResourcesModal from '../components/admin/EventResourcesModal';
import { StaffPanel } from '../components/admin/StaffPanel';
import { ToastViewport, useToasts } from '../components/ui/Toasts';

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

/* Fallback identity; the signed-in admin account takes precedence. */
const FALLBACK_ADMIN = { name: 'Chris Paul', role: 'Administrator' };

/* ─────────────────────────────────────────────────────────────────────────
   Status maps & helpers
───────────────────────────────────────────────────────────────────────── */

/** Zero-pads a month/day for building a local "YYYY-MM-DD" without UTC drift. */
const pad2 = (n: number) => String(n).padStart(2, '0');

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

type Tab = 'overview' | 'bookings' | 'payments' | 'packages' | 'menus' | 'rentals' | 'services' | 'testimonials' | 'histories' | 'audit' | 'announcements' | 'staff' | 'placeholder';

/** The sidebar's "Booking Histories" link routes here rather than switching tabs in place. */
const HISTORIES_PATH = '/admin/booking-histories';

/**
 * Tabs that survive a refresh, as `?tab=`. Overview is the default and carries no
 * param, so a bare /admin stays clean.
 *
 * 'histories' is absent on purpose: it owns HISTORIES_PATH, a real pathname, and
 * giving it a second spelling would let the URL contradict itself.
 * 'placeholder' is absent because it means nothing without the in-memory name that
 * goes with it — restoring it from a URL would land on a blank panel.
 */
const URL_TABS = [
  'bookings', 'payments', 'packages', 'menus', 'rentals',
  'services', 'testimonials', 'audit', 'announcements', 'staff',
] as const;

const isUrlTab = (v: string | null): v is (typeof URL_TABS)[number] =>
  v !== null && (URL_TABS as readonly string[]).includes(v);

const RES_STATUS_VALUES = ['Draft', 'Pending', 'Confirmed', 'Completed', 'Cancelled'] as const;

const isResStatusParam = (v: string | null): v is ResStatus =>
  v !== null && (RES_STATUS_VALUES as readonly string[]).includes(v);

/* "Announcements" used to live here — it's a real tab now, backed by
   /api/Announcements. */
const PLACEHOLDER_ITEMS = ['Chat Support'];

import { PaymentsTab } from '../components/admin/payments/PaymentsTab';
import { AnnouncementsTab } from '../components/admin/announcements/AnnouncementsTab';
import { AuditLogTab } from '../components/admin/audit/AuditLogTab';
import { BookingsTab } from '../components/admin/bookings/BookingsTab';
import { MenusTab } from '../components/admin/menus/MenusTab';
import { OverviewTab } from '../components/admin/overview/OverviewTab';
import { RentalsTab } from '../components/admin/rentals/RentalsTab';
import { DELIVERY_ACTION_LABEL, DELIVERY_STATUS_STYLE } from '../components/admin/rentals/deliveryStatus';
import { ServiceItemsTab } from '../components/admin/services/ServiceItemsTab';
import { BookingHistoriesTab } from '../components/admin/histories/BookingHistoriesTab';
import { TestimonialsTab } from '../components/admin/testimonials/TestimonialsTab';
import { AdminSupportPanel } from '../components/admin/support/AdminSupportPanel';

export function AdminDashboardPage() {
  const { user: authUser, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const adminName = authUser?.name ?? FALLBACK_ADMIN.name;

  const [tab, setTab] = useState<Tab>('overview');
  const [placeholderName, setPlaceholderName] = useState(PLACEHOLDER_ITEMS[0]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* Sidebar accordion for Bookings. Lives here, not in the component, so it survives
     tab switches and can be forced open when a status arrives from the URL. */
  const [bookingsNavOpen, setBookingsNavOpen] = useState(false);
  /** Last status the admin chose, so returning to Bookings resumes where they left off. */
  const lastBookingStatus = useRef<'all' | ResStatus>('all');

  const [reservations, setReservations] = useState<BookingResponse[]>([]);

  const { toasts, notify, dismiss } = useToasts();

  const loadBookings = async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      const data = await getAllBookings(session.token);
      setReservations(data);
    } catch (err) {
      // Used to console.error only, which left the Bookings tab looking simply
      // empty when the fetch failed — indistinguishable from "no bookings".
      notify('error', err instanceof BookingApiError ? err.message : 'Could not load bookings. Please try again.');
    }
  };

  /* Pending-review count for the nav badge. The Testimonials tab owns the list and
     reports the count up; this stays 0 until the tab has loaded once, as before. */
  const [pendingTesti, setPendingTesti] = useState(0);

  /* notifications — the in-app feed over the worker's send ledger */
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);

  /* payments — live data from /api/Payments/recent + /api/Payments/refund-requests */
  const [payments, setPayments] = useState<AdminPaymentRecord[]>([]);
  const [refundQueue, setRefundQueue] = useState<RefundRequestQueueItem[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [paymentsAuthError, setPaymentsAuthError] = useState(false);
  const [paymentActionBusy, setPaymentActionBusy] = useState<string | null>(null);
  /* Bumped after any payment action so PaymentsTab reloads the day it is showing.
     A token rather than a callback: the page does not know which date that is. */
  const [paymentsRefresh, setPaymentsRefresh] = useState(0);
  /** Set when a notification should point the Payments tab at something. */
  const [paymentFocus, setPaymentFocus] = useState<{ search: string; date: string } | null>(null);

  const loadPayments = async () => {
    const session = readSession();
    if (!session) {
      setPaymentsError('You are not signed in. Sign in with an Owner or Assistant account to load payments.');
      setPaymentsAuthError(true);
      return;
    }
    setPaymentsLoading(true);
    setPaymentsError(null);
    setPaymentsAuthError(false);
    try {
      const [recent, queue] = await Promise.all([
        getRecentPayments(session.token),
        fetchRefundRequests(session.token),
      ]);
      setPayments(recent);
      setRefundQueue(queue);
    } catch (err) {
      if (err instanceof PaymentApiError) {
        setPaymentsError(err.message);
        setPaymentsAuthError(err.isAuthError);
      } else {
        setPaymentsError('Something went wrong while loading payments. Please try again.');
      }
    } finally {
      setPaymentsLoading(false);
    }
  };

  /* Owner decisions on a payment; refetches the list afterwards so totals stay honest. */
  /**
   * The Payments table's own fetch, scoped to one day server-side.
   *
   * Separate from loadPayments so narrowing the table to a date can't narrow the
   * array the Overview tiles and the refund queue read from.
   */

  const runPaymentAction = async (
    paymentId: string,
    action: 'confirm' | 'reject' | 'refund' | 'deny',
    extra?: { amount?: number; reason?: string },
  ) => {
    const session = readSession();
    if (!session) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setPaymentActionBusy(paymentId);
    try {
      if (action === 'confirm') {
        await confirmPayment(session.token, paymentId);
        notify('success', 'Payment confirmed — invoice and deposit updated.');
        // Confirming is where a manually-recorded (cash/transfer) payment actually
        // becomes real — there's no gateway redirect for those, so land the admin on
        // Payments to see the updated ladder. No-op when they're already there.
        openTab('payments');
      } else if (action === 'reject') {
        await rejectPayment(session.token, paymentId);
        notify('success', 'Payment rejected.');
      } else if (action === 'refund') {
        await refundPayment(session.token, paymentId, extra?.amount);
        notify('success', 'Refund issued.');
      } else {
        await denyRefund(session.token, paymentId, extra?.reason ?? '');
        notify('success', 'Refund request denied.');
      }
      /* loadPayments backs the Overview tiles and the refund queue, both of which
         live here. The day's rows live in PaymentsTab, so rather than reach into
         its state we bump a token it watches — the tab decides how to refresh
         itself, and this stays ignorant of the date it happens to be showing. */
      await loadPayments();
      setPaymentsRefresh((n) => n + 1);
    } catch (err) {
      notify(
        'error',
        err instanceof PaymentApiError ? err.message : 'The payment action failed. Please try again.',
      );
    } finally {
      setPaymentActionBusy(null);
    }
  };

  /* ── Invoice viewer ──
     This used to be a "Generate Invoice" button on Confirmed bookings, which could
     never succeed: Bookingservice.SubmitAsync already issues the invoice the moment a
     Draft becomes Pending, and Invoiceservice.GenerateAsync refuses a second one for
     the same booking. So every Confirmed booking already had an invoice, and the
     button threw "This booking already has an invoice." every single time.

     Viewing is what was actually needed, and it belongs on Pending — that's where the
     invoice first exists and where the customer is waiting to be billed. */
  /* Log Cash Payment — opened from the Bookings tab (next to Confirm) and from the
     Payments tab. Holds only the booking; the modal resolves the invoice itself. */
  const [cashTarget, setCashTarget] = useState<{ bookingId: string; bookingName: string } | null>(null);

  /**
   * Folds the cash result into local state so the Confirm button next to the button
   * that opened the modal becomes usable immediately.
   *
   * Patching rather than refetching is the point: the admin's cursor is already on
   * Confirm, and a full reload would move the list out from under them. `loadPayments`
   * still runs so the Payments tab shows the new row, but the booking's own
   * depositStatus is applied straight from the response.
   */
  const applyCashResult = (result: CashPaymentResult) => {
    setReservations((prev) => prev.map((b) =>
      b.id === result.bookingId
        ? { ...b, depositStatus: result.depositStatus, status: result.bookingStatus }
        : b));

    // Keep an open detail/invoice modal in step with the same booking.
    setDetailBooking((prev) =>
      prev && prev.booking.id === result.bookingId
        ? { ...prev, booking: { ...prev.booking, depositStatus: result.depositStatus, status: result.bookingStatus } }
        : prev);
    setInvoiceView((prev) =>
      prev && prev.booking.id === result.bookingId
        ? { ...prev, booking: { ...prev.booking, depositStatus: result.depositStatus, status: result.bookingStatus } }
        : prev);

    void loadPayments();
  };

  const [invoiceBusyId, setInvoiceBusyId] = useState<string | null>(null);
  const [invoiceView, setInvoiceView] = useState<
    { booking: BookingResponse; invoice: InvoiceResponseDto | null; detail: BookingDetailResponse | null } | null
  >(null);

  const openInvoiceFor = async (b: BookingResponse) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setInvoiceBusyId(b.id);
    try {
      // Both are optional to the view: a missing invoice is the edge case the modal
      // handles, and a failed detail fetch only costs the line breakdown, not the
      // captured totals that actually matter.
      let invoice: InvoiceResponseDto | null = null;
      try { invoice = await getInvoiceByBooking(session.token, b.id); } catch { /* none yet */ }

      let detail: BookingDetailResponse | null = null;
      try { detail = await getBookingDetail(session.token, b.id); } catch { /* lines omitted */ }

      setInvoiceView({ booking: b, invoice, detail });
    } finally {
      setInvoiceBusyId(null);
    }
  };

  /**
   * The fallback path, for a booking that reached Pending without an invoice.
   *
   * Expected to be dead code in practice — Submit is the only route to Pending and it
   * always generates one. If this starts firing, something upstream skipped invoice
   * generation and that's the bug worth chasing, not this button.
   */
  const generateMissingInvoice = async (b: BookingResponse) => {
    const session = readSession();
    if (!session?.token) return;
    setInvoiceBusyId(b.id);
    try {
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const issueDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      const invoice = await generateInvoice(session.token, b.id, issueDate, b.eventDate);
      setInvoiceView((prev) => (prev ? { ...prev, invoice } : prev));
      notify('success', `Invoice issued — due ${fmtDate(b.eventDate)}.`);
    } catch (err) {
      notify('error', err instanceof BookingApiError ? err.message : 'Could not issue the invoice.');
    } finally {
      setInvoiceBusyId(null);
    }
  };

  /* ── returns / check-in desk ──
     Stays on the page rather than in RentalsTab: the booking-detail modal, which
     can open over any tab, moves rental lines through the same actions. */
  const [outstandingRentals, setOutstandingRentals] = useState<OutstandingRentalLine[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [returnsFeedback, setReturnsFeedback] = useState<string | null>(null);
  /** Which line is mid-request, so only that row's buttons disable. */
  const [returnsBusyId, setReturnsBusyId] = useState<string | null>(null);
  /** The line being marked Damaged; the note modal is open while this is set. */
  const [damageTarget, setDamageTarget] = useState<OutstandingRentalLine | null>(null);
  const [damageNote, setDamageNote] = useState('');
  /** Bumped after a rental line changes status, so RentalsTab reloads stock counts. */
  const [rentalCatalogRefresh, setRentalCatalogRefresh] = useState(0);

  /* Which bookings rows show. Rendered by BookingsTab, owned here: the sidebar tree,
     the URL, Overview and the notification feed all write these, and they outlive
     a trip to another tab. */
  const [resFilter, setResFilter] = useState<'all' | ResStatus>('all');
  const [resTypeFilter, setResTypeFilter] = useState<'all' | BookingTypeName>('all');
  const [resSearch, setResSearch] = useState('');

  /** Booking whose Event Resources modal is open, or null. */
  const [resourcesResId, setResourcesResId] = useState<string | null>(null);

  /* The booking open in the Histories tab. Kept here, not in the tab, so it
     survives leaving the tab, and so the Bookings tab's "View history" row
     action can hand a booking over before the Histories tab has mounted. */
  const [historyBookingId, setHistoryBookingId] = useState<string | null>(null);

  /* admin detail view — read-only full picture of a Confirmed booking. Additive to
     the notes and contract features, which keep working unchanged. */
  const [detailBooking, setDetailBooking] = useState<BookingDetailResponse | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<InvoiceResponseDto | null>(null);
  const [detailBusyId, setDetailBusyId] = useState<string | null>(null);

  /**
   * Re-reads the open detail modal from the server.
   *
   * Used after every items edit: the total is recomputed server-side
   * (Bookingservice.RecomputeTotalAsync), so refetching is the only way to show a
   * figure that matches what Submit will freeze.
   */
  const refreshBookingDetail = async (bookingId: string) => {
    const session = readSession();
    if (!session?.token) return;
    try {
      setDetailBooking(await getBookingDetail(session.token, bookingId));
    } catch {
      // Leave the modal on its last good state; the caller already surfaced the error
      // that mattered (the failed edit), and blanking the panel would lose context.
    }
  };

  const openBookingDetail = async (b: BookingResponse) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setDetailBusyId(b.id);
    try {
      const detail = await getBookingDetail(session.token, b.id);
      let invoice: InvoiceResponseDto | null = null;
      try {
        invoice = await getInvoiceByBooking(session.token, b.id);
      } catch {
        // Not invoiced yet — the detail view just omits the money section.
      }
      setDetailBooking(detail);
      setDetailInvoice(invoice);
    } catch (err) {
      notify('error', err instanceof BookingApiError ? err.message : 'Could not load the booking details.');
    } finally {
      setDetailBusyId(null);
    }
  };

  /* contract generator state (item 2) — browser print, no server-side PDF */
  const [contractBooking, setContractBooking] = useState<BookingDetailResponse | null>(null);
  const [contractInvoice, setContractInvoice] = useState<InvoiceResponseDto | null>(null);
  const [contractBusyId, setContractBusyId] = useState<string | null>(null);

  /* The month the Overview calendar shows. Kept here rather than in OverviewTab so
     the calendar is still on that month after a trip to another tab. */
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  /* Sidebar badge counts. OverviewTab derives its own figures from the same arrays. */
  const pendingPayments = payments.filter((p) => p.status === 'Pending');
  const pendingRes = reservations.filter((r) => r.status === 'Pending');

  /* ── local mutations ── */
  const setResStatus = async (id: string, st: 'Confirmed' | 'Completed' | 'Cancelled') => {
    const session = readSession();
    if (!session?.token) return;
    try {
      let updated: BookingResponse;
      if (st === 'Confirmed') updated = await confirmBooking(session.token, id);
      else if (st === 'Completed') updated = await completeBooking(session.token, id);
      else updated = await cancelBooking(session.token, id);
      
      setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
      notify('success', `Booking ${st.toLowerCase()}.`);
    } catch (err: any) {
      notify('error', err.message || `Failed to set status to ${st}`);
    }
  };

  /* Move a Draft (e.g. from a customer's Plan-by-Budget) to Pending on the customer's
     behalf, so the normal Confirm → Invoice → Payment flow can begin. */
  const [submitBusyId, setSubmitBusyId] = useState<string | null>(null);
  const submitDraftFor = async (b: BookingResponse) => {
    const session = readSession();
    if (!session?.token) return;
    setSubmitBusyId(b.id);
    try {
      const updated = await submitBooking(session.token, b.id);
      setReservations((prev) => prev.map((r) => (r.id === b.id ? updated : r)));
      notify('success', `Draft submitted — "${b.bookingName}" is now Pending.`);
    } catch (err: any) {
      notify('error', err.message || 'Failed to submit this Draft.');
    } finally {
      setSubmitBusyId(null);
    }
  };

  /**
   * Switch tabs and record it in the URL, so refresh/back/bookmark all work.
   *
   * Tab changes PUSH a history entry; status changes within the Bookings tab replace
   * (see selectBookingStatus), so clicking through five statuses doesn't cost five
   * presses of Back to leave the page.
   */
  const openTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);

    const params = new URLSearchParams(searchParams);
    if (isUrlTab(t)) params.set('tab', t); else params.delete('tab');
    // The status filter belongs to the Bookings tab; carrying it elsewhere would
    // leave a stale param to be restored on the next visit.
    if (t !== 'bookings') params.delete('status');

    // Booking Histories owns a URL of its own; leaving it must drop that URL, or the
    // address bar would keep claiming we're on a page we've navigated away from.
    if (t !== 'histories' && location.pathname === HISTORIES_PATH) {
      navigate({ pathname: '/admin', search: params.toString() });
      return;
    }
    setSearchParams(params);
  };

  /**
   * The single writer for `resFilter`. Selects the Bookings tab, sets the status,
   * expands the sidebar group and closes the mobile drawer — every entry point goes
   * through here (sidebar children, the table's View All, and the three hand-offs
   * from Overview and the notification feed), so state and URL can't drift apart.
   */
  const selectBookingStatus = (next: 'all' | ResStatus) => {
    setResFilter(next);
    // Remembered separately from the URL: leaving the tab drops ?status=, so the URL
    // can't be what restores the last-used filter on the way back.
    lastBookingStatus.current = next;
    setBookingsNavOpen(true);
    setTab('bookings');
    setSidebarOpen(false);

    const params = new URLSearchParams(searchParams);
    params.set('tab', 'bookings');
    if (next === 'all') params.delete('status'); else params.set('status', next);

    if (location.pathname === HISTORIES_PATH) {
      navigate({ pathname: '/admin', search: params.toString() });
      return;
    }
    setSearchParams(params, { replace: true });
  };

  /** Every rental line still awaiting an action, for the returns desk. */
  const loadOutstandingRentals = async () => {
    const session = readSession();
    if (!session) {
      setReturnsError('You are not signed in. Sign in with an Owner or Assistant account to load returns.');
      return;
    }

    setReturnsLoading(true);
    setReturnsError(null);

    try {
      setOutstandingRentals(await getOutstandingRentals(session.token));
    } catch (err) {
      setReturnsError(
        err instanceof BookingApiError
          ? err.message
          : 'Unable to load outstanding rentals. Please try again.',
      );
    } finally {
      setReturnsLoading(false);
    }
  };

  /**
   * Moves one rental line along its lifecycle.
   *
   * The catalog is told to reload afterwards because returning a line changes that item's
   * quantityOut/stock — leaving the inventory table showing pre-return numbers would be
   * the kind of stale reading an admin then acts on.
   */
  const applyDeliveryStatus = async (
    line: OutstandingRentalLine,
    next: DeliveryStatusName,
    note?: string,
  ) => {
    const session = readSession();
    if (!session) {
      setReturnsError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }

    setReturnsBusyId(line.rentalId);
    setReturnsError(null);
    setReturnsFeedback(null);

    try {
      await updateRentalDeliveryStatus(session.token, line.bookingId, line.rentalId, next, note);

      // Returned lines drop off the desk entirely; the rest stay with a new status.
      setOutstandingRentals((prev) =>
        next === 'Returned'
          ? prev.filter((l) => l.rentalId !== line.rentalId)
          : prev.map((l) =>
              l.rentalId === line.rentalId
                ? { ...l, deliveryStatus: next, damageNote: note ?? l.damageNote }
                : l,
            ),
      );

      // Keep an open booking-detail modal in step. A no-op when it's closed or showing a
      // different booking, which is why both entry points can share this one path.
      setDetailBooking((prev) =>
        prev
          ? {
              ...prev,
              rentals: prev.rentals.map((r) =>
                r.lineId === line.rentalId
                  ? { ...r, deliveryStatus: next, damageNote: note ?? r.damageNote }
                  : r,
              ),
            }
          : prev,
      );

      setReturnsFeedback(
        next === 'Returned'
          ? `${line.quantity} × ${line.itemName} returned — stock is available again.`
          : next === 'Damaged'
            ? `${line.quantity} × ${line.itemName} flagged as damaged and held out of stock.`
            : `${line.quantity} × ${line.itemName} marked delivered.`,
      );

      // The Rentals tab owns the catalog; bumping this is how it hears to refetch.
      setRentalCatalogRefresh((n) => n + 1);
    } catch (err) {
      setReturnsError(
        err instanceof BookingApiError
          ? err.message
          : 'Unable to update the rental line. Please try again.',
      );
    } finally {
      setReturnsBusyId(null);
    }
  };

  /**
   * Turns a rental line on the open booking detail into the shape applyDeliveryStatus
   * expects, so the inline actions and the returns desk go through identical rules.
   */
  const detailLineToOutstanding = (
    line: BookingDetailResponse['rentals'][number],
  ): OutstandingRentalLine | null => {
    if (!detailBooking) return null;
    const b = detailBooking.booking;
    return {
      rentalId: line.lineId,
      bookingId: b.id,
      customerName: b.bookingName,
      eventDate: b.eventDate,
      endDate: b.endDate,
      rentalItemId: line.rentalItemId,
      itemName: line.itemName,
      quantity: line.quantity,
      deliveryStatus: line.deliveryStatus,
      damageNote: line.damageNote,
    };
  };

  const confirmDamage = async () => {
    if (!damageTarget || !damageNote.trim()) return;
    const target = damageTarget;
    setDamageTarget(null);
    await applyDeliveryStatus(target, 'Damaged', damageNote.trim());
    setDamageNote('');
  };

  /* ── notifications: loader ── */
  const loadNotifications = async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      const feed = await getNotifications(session.token);
      setNotifications(feed.items);
      setUnreadCount(feed.unreadCount);
    } catch {
      // A failed poll is not worth a toast — the bell just keeps its last state.
    }
  };

  /**
   * Clicking a notification marks it read AND navigates to what it's about.
   *
   * The admin dashboard has no per-booking detail modal (that's the customer side),
   * so a booking notification lands on the Bookings tab filtered down to that one
   * booking — the closest thing to "open this booking" the existing UI supports,
   * built from machinery that's already there rather than a new modal.
   */
  const openNotification = (n: AppNotification) => {
    void readNotification(n);
    setBellOpen(false);

    switch (notificationTarget(n)) {
      case 'booking':
        // 'all' because the booking may not match the current status filter.
        setResSearch(n.bookingName ?? '');
        selectBookingStatus('all');
        break;
      case 'payment':
        /* The old list expanded a row by payment id; the table has no expandable row,
           so the hand-off is a search instead — the same shape as the booking case.
           The date is reset to today because the table is scoped to a single day and a
           payment notification is, by definition, about one that just happened. */
        {
          const d = new Date();
          const todayIso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
          /* One object rather than five setters reaching into the tab: PaymentsTab
             applies it when the reference changes, so the page says WHAT to show
             and the tab decides how. */
          setPaymentFocus({ search: n.bookingName ?? '', date: todayIso });
        }
        openTab('payments');
        break;
      case 'chat':
        setPlaceholderName('Chat Support');
        openTab('placeholder');
        break;
      case 'none':
      default:
        break;
    }
  };

  const readNotification = async (n: AppNotification) => {
    if (n.readAt) return;
    const session = readSession();
    if (!session?.token) return;
    try {
      await markNotificationRead(session.token, n.id);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* leave it unread; the next poll will reconcile */
    }
  };

  const readAllNotifications = async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      await markAllNotificationsRead(session.token);
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
      setUnreadCount(0);
    } catch {
      notify('error', 'Could not mark notifications read.');
    }
  };

  /* ── contract generator (item 2) ── */

  /**
   * Opens the printable contract for a Confirmed booking. Everything it needs already
   * exists on GET /api/Bookings/{id}; the invoice is fetched alongside for the money
   * section and is optional — a booking that hasn't been invoiced yet still gets a
   * contract, just with the line totals only.
   */
  const openContract = async (b: BookingResponse) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setContractBusyId(b.id);
    try {
      const detail = await getBookingDetail(session.token, b.id);
      let invoice: InvoiceResponseDto | null = null;
      try {
        invoice = await getInvoiceByBooking(session.token, b.id);
      } catch {
        // No invoice yet (404) — the contract still stands on the booking's own totals.
      }
      setContractBooking(detail);
      setContractInvoice(invoice);
    } catch (err) {
      notify('error', err instanceof BookingApiError ? err.message : 'Could not build the contract.');
    } finally {
      setContractBusyId(null);
    }
  };

  /* Row counts per status for the bookings tree-menu. Counted off `reservations`, not
     BookingsTab's filtered rows, so the numbers don't collapse to the group you already
     picked. */
  const resCounts = useMemo(() => {
    const out: Record<BookingGroupKey, number> = {
      Draft: 0, Pending: 0, Confirmed: 0, Completed: 0, Cancelled: 0,
    };
    for (const r of reservations) {
      if (r.status in out) out[r.status as BookingGroupKey] += 1;
    }
    return out;
  }, [reservations]);

  /* The bookings table's action menu, wired to the handlers that already exist above.
     Every entry is a pass-through — the dropdown and the old button row drove the same
     calls, so nothing here changes what a click does. Edit Note and Cancel are added by
     BookingsTab, which owns the note editor and the reason prompt they open. */
  const bookingActions: Omit<BookingRowActions, 'onEditNote' | 'onCancel'> = {
    onSubmitDraft: (b) => void submitDraftFor(b),
    onOpenDetail: (b) => void openBookingDetail(b),
    onLogCash: (b) => setCashTarget({ bookingId: b.id, bookingName: b.bookingName }),
    onConfirm: (b) => void setResStatus(b.id, 'Confirmed'),
    onMarkCompleted: (b) => void setResStatus(b.id, 'Completed'),
    onOpenInvoice: (b) => void openInvoiceFor(b),
    onGenerateContract: (b) => void openContract(b),
    onAllocateResources: (b) => setResourcesResId(b.id),
    onViewHistory: (b) => { openTab('histories'); setHistoryBookingId(b.id); },
  };

  /* refetch every time the tab is opened so admin edits elsewhere show up */
  useEffect(() => {
    if (tab === 'overview' || tab === 'payments') void loadPayments();
    // Overview needs them too: the calendar cells, the day-detail modal and the
    // pending queue all read `reservations`, which used to stay empty until the
    // admin had visited the Bookings tab at least once.
    if (tab === 'overview' || tab === 'bookings' || tab === 'histories') void loadBookings();
    if (tab === 'rentals') void loadOutstandingRentals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* The bell is in the topbar, so its feed is loaded once for the whole session
     rather than per tab. */
  useEffect(() => {
    void loadNotifications();
  }, []);

  /* Live badge: the backend broadcasts "NotificationCreated" on /hubs/payment the
     moment any notification is written. The signal carries no payload on purpose —
     we refetch, so the server re-applies its own role scoping and we can never
     display a notification that isn't ours. Same hub the support panel and the
     customer dashboard already use; no new transport. */
  useEffect(() => {
    const conn = new HubConnectionBuilder()
      .withUrl(`${API_BASE_URL}/hubs/payment`)
      .withAutomaticReconnect()
      .build();

    conn.on('NotificationCreated', () => { void loadNotifications(); });

    conn.start().catch(() => {
      notify('info', 'Live notifications are unavailable. Open the bell to refresh manually.');
    });

    return () => { void conn.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The URL is the source of truth for which tab and status are showing, so refresh,
     Back and a pasted link all land where they say they will.

     Booking Histories is a real route (the sidebar has always linked to it — until
     now there was no matching <Route>, so the link bounced admins to the landing
     page) and wins over any ?tab=.

     Unknown or missing values fall back to overview/'all' rather than being trusted
     into state — a hand-edited ?status=Foo would otherwise strand the admin on a view
     with no rows and no obvious way out. */
  useEffect(() => {
    if (location.pathname === HISTORIES_PATH) {
      setTab('histories');
      return;
    }
    const t = searchParams.get('tab');
    setTab(isUrlTab(t) ? t : 'overview');

    const s = searchParams.get('status');
    setResFilter(isResStatusParam(s) ? s : 'all');
    if (isResStatusParam(s)) {
      // A deep link counts as choosing that status.
      lastBookingStatus.current = s;
      setBookingsNavOpen(true);
    }
  }, [location.pathname, searchParams]);

  /* Lucide at 1.75 stroke, not emoji. The old glyphs (▦ 🗓 ₱ 📦 ★ …) rendered as
     colour emoji on Windows and Android — they could not take currentColor, so the
     active nav item's icon stayed multicoloured against the active fill. */
  const NAV: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={18} strokeWidth={1.75} /> },
    { id: 'bookings', label: 'Bookings', icon: <CalendarDays size={18} strokeWidth={1.75} />, badge: pendingRes.length },
    { id: 'payments', label: 'Payments', icon: <Wallet size={18} strokeWidth={1.75} />, badge: pendingPayments.length },
    { id: 'packages', label: 'Packages', icon: <Package size={18} strokeWidth={1.75} /> },
    { id: 'testimonials', label: 'Testimonials', icon: <Star size={18} strokeWidth={1.75} />, badge: pendingTesti },
  ];

  const isRouteActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.45s ease both; }

        .adm-shell { min-height: 100vh; background: var(--bg-subtle); transition: background 0.4s; }
        .adm-main { margin-left: 250px; min-height: 100vh; display: flex; flex-direction: column; }

        /* ── sidebar ── */
        .adm-sidebar {
          position: fixed; top: 0; left: 0; z-index: 60;
          width: 250px; height: 100vh;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex; flex-direction: column;
          transition: transform 0.3s ease;
        }
        .adm-brand {
          padding: 1.5rem 1.4rem 1.2rem;
          border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 0.65rem;
        }
        .adm-brand-mark {
          width: 34px; height: 34px; flex-shrink: 0;
          border-radius: var(--r-lg);
          background: var(--accent-muted);
          border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 1.05rem; font-weight: 600;
          color: var(--accent);
        }
        .adm-drawer-close { display: none; }
        .adm-nav { flex: 1; padding: 1rem 0.8rem; display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; }
        .adm-nav-caption {
          padding: 0.4rem 0.9rem 0.3rem;
          font-family: var(--font-body); font-size: 0.5rem;
          letter-spacing: 0.3em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-nav-item {
          display: flex; align-items: center; gap: 0.7rem;
          width: 100%; text-align: left;
          padding: 0.66rem 0.9rem;
          border: 1px solid transparent; border-radius: var(--r-lg);
          background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.68rem;
          letter-spacing: 0.1em; text-transform: uppercase; font-weight: 500;
          color: var(--text-muted); text-decoration: none;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-nav-item:hover:not(.active) { background: var(--bg-subtle); color: var(--text-primary); }
        .adm-nav-item.active {
          background: var(--primary-muted);
          border-color: var(--border-accent);
          color: var(--primary);
        }
        .adm-nav-item:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

        /* ── bookings accordion in the sidebar ──
           Children reuse .adm-nav-item wholesale, so the active treatment is the same
           rule every other nav entry uses rather than a lookalike that drifts. Only
           the indent, the tree lines and the type scale are new. */
        .adm-nav-tree { display: flex; flex-direction: column; }
        .adm-nav-label { flex: 1; }
        .adm-nav-caret { flex-shrink: 0; color: var(--text-dim); }
        .adm-nav-item.active .adm-nav-caret { color: var(--primary); }

        .adm-nav-children {
          list-style: none; margin: 0.2rem 0 0; padding: 0 0 0 1.25rem;
          display: flex; flex-direction: column; gap: 0.12rem;
        }
        .adm-nav-children > li { position: relative; padding-left: 0.95rem; }
        /* Elbow: down from the trunk, then curving right into the child. */
        .adm-nav-children > li::before {
          content: ''; position: absolute; left: 0; top: 0;
          width: 0.62rem; height: calc(50% + 1px);
          border-left: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          border-bottom-left-radius: 9px;
          pointer-events: none;
        }
        /* Trunk continuation — unbroken between children, stops at the last one. */
        .adm-nav-children > li:not(:last-child)::after {
          content: ''; position: absolute; left: 0; top: 50%; bottom: 0;
          border-left: 1px solid var(--border);
          pointer-events: none;
        }
        .adm-nav-child { padding: 0.46rem 0.7rem; font-size: 0.62rem; gap: 0.5rem; }
        .adm-nav-child-label { flex: 1; }
        .adm-nav-count {
          font-size: 0.58rem; font-weight: 600;
          color: var(--text-dim); font-variant-numeric: tabular-nums;
        }
        .adm-nav-item.active .adm-nav-count { color: var(--primary); }
        /* No tile behind the glyph: that box existed to give an emoji a consistent
           footprint. A Lucide icon on currentColor needs no container, and dropping
           it lets eleven nav rows sit closer together in a 250px rail. */
        .adm-nav-icon {
          width: 20px; height: 20px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: currentColor;
        }
        .adm-nav-icon svg { width: 18px; height: 18px; }
        .adm-badge {
          margin-left: auto;
          background: var(--accent-muted); color: var(--accent);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          font-size: 0.54rem; font-weight: 600; letter-spacing: 0.04em;
          padding: 0.08rem 0.45rem; min-width: 18px; text-align: center;
        }
        .adm-sidebar-foot { padding: 0.9rem 0.8rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.45rem; }
        .adm-foot-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          padding: 0.58rem;
          border: 1px solid var(--border); border-radius: var(--r-full);
          background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.58rem;
          letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500;
          color: var(--text-muted); text-decoration: none;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-foot-btn:hover { color: var(--primary); border-color: var(--border-accent); background: var(--primary-muted); }
        /* Sign out reads danger at rest, not only on hover — artboard 8b colours it
           #F2828C in the drawer. A destructive action that looks identical to the
           theme toggle until you are already pointing at it announces itself too late. */
        .adm-foot-btn.danger { color: var(--danger); }
        .adm-foot-btn.danger:hover { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: var(--danger-muted); }

        .adm-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(22, 40, 26, 0.32); display: none; }

        /* ── topbar ── */
        .adm-topbar {
          position: sticky; top: 0; z-index: 40;
          display: flex; align-items: center; gap: 0.9rem;
          padding: 0.85rem 2rem;
          background: color-mix(in srgb, var(--bg-subtle) 84%, transparent);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .adm-iconbtn {
          width: 34px; height: 34px; flex-shrink: 0;
          border-radius: var(--r-full);
          border: 1px solid var(--border);
          background: var(--surface); color: var(--text-secondary);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: color 0.2s, border-color 0.2s;
        }
        .adm-iconbtn:hover { color: var(--primary); border-color: var(--border-accent); }
        .adm-burger { display: none; }
        .adm-avatar {
          width: 32px; height: 32px; flex-shrink: 0;
          border-radius: 50%;
          background: var(--accent-muted);
          border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 0.8rem; font-weight: 600;
          color: var(--accent);
        }

        /* ── cards & shared pieces ── */
        .adm-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .adm-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-md); }

        /* skeleton shimmer (loading states) */
        @keyframes admShimmer { 0% { background-position: -450px 0; } 100% { background-position: 450px 0; } }
        .adm-skel {
          background: linear-gradient(90deg, var(--border) 0%, var(--bg-subtle) 40%, var(--border) 80%);
          background-size: 450px 100%;
          animation: admShimmer 1.4s ease-in-out infinite;
          border-radius: var(--r-sm);
        }

        .adm-title { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; letter-spacing: -0.028em; line-height: 1.1; color: var(--text-primary); }

        .adm-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.1rem; }
        @media (max-width: 1200px) { .adm-metrics { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 620px)  { .adm-metrics { grid-template-columns: 1fr; } }
        .adm-metric { padding: 1.25rem 1.4rem; }
        .adm-metric .head { display: flex; align-items: center; gap: 0.55rem; margin-bottom: 0.8rem; }
        .adm-metric .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .adm-metric .lbl {
          font-family: var(--font-body); font-size: 0.55rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-metric .num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 600; line-height: 1; color: var(--text-primary); }
        .adm-metric .sub { font-family: var(--font-body); font-size: 0.66rem; font-weight: 300; color: var(--text-muted); margin-top: 0.35rem; }

        /* pills */
        .adm-pill {
          font-family: var(--font-body); font-size: 0.6rem;
          letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500;
          padding: 0.45rem 0.95rem; border-radius: var(--r-full);
          background: var(--surface); color: var(--text-muted);
          border: 1px solid var(--border);
          cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; gap: 0.45rem;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-pill:hover { border-color: var(--border-accent); color: var(--text-primary); }
        .adm-pill.active { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
        .adm-pill .count {
          font-size: 0.54rem; letter-spacing: 0.04em;
          background: var(--bg-subtle); color: var(--text-dim);
          border-radius: var(--r-full); padding: 0.05rem 0.42rem; min-width: 17px; text-align: center;
        }
        .adm-pill.active .count { background: color-mix(in srgb, var(--primary-text) 22%, transparent); color: var(--primary-text); }

        /* buttons */
        .adm-btn {
          font-family: var(--font-body); font-size: 0.6rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          padding: 0.55rem 1.05rem; border-radius: var(--r-full);
          border: 1px solid transparent; cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; gap: 0.4rem;
          transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s;
        }
        .adm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .adm-btn.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
        .adm-btn.primary:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
        .adm-btn.success { background: var(--primary-muted); color: var(--primary); border-color: var(--border-accent); }
        .adm-btn.success:hover:not(:disabled) { background: var(--primary); color: var(--primary-text); }
        .adm-btn.outline { background: transparent; color: var(--text-muted); border-color: var(--border); }
        .adm-btn.outline:hover:not(:disabled) { color: var(--primary); border-color: var(--border-accent); background: var(--primary-muted); }
        .adm-btn.danger { background: var(--danger-muted); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
        .adm-btn.danger:hover:not(:disabled) { background: var(--danger); color: var(--danger-text); }
        .adm-btn.info { background: color-mix(in srgb, var(--status-info) 12%, transparent); color: var(--status-info); border-color: color-mix(in srgb, var(--status-info) 30%, transparent); }
        .adm-btn.info:hover:not(:disabled) { background: var(--status-info); color: var(--primary-text); }

        /* inputs */
        .adm-input {
          background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--r-full);
          padding: 0.6rem 1.05rem;
          font-family: var(--font-body); font-size: 0.8rem; font-weight: 300;
          color: var(--text-primary); outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .adm-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
        .adm-input.square { border-radius: var(--r-lg); background: var(--bg-subtle); width: 100%; }
        select.adm-input { cursor: pointer; font-weight: 400; }

        .adm-modal-overlay {
          position: fixed; inset: 0; z-index: 120;
          background: rgba(20, 14, 8, 0.6);
          display: flex; align-items: center; justify-content: center;
          padding: 1.5rem;
        }
        .adm-modal-panel {
          width: min(100%, 720px);
          max-height: 92vh;
          overflow-y: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          box-shadow: var(--shadow-lg);
          padding: 1.4rem 1.5rem;
        }
        .adm-modal-panel h3 {
          margin: 0 0 0.75rem;
          font-family: var(--font-display);
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .adm-modal-panel .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .adm-modal-panel .form-grid.full { grid-template-columns: 1fr; }
        .adm-modal-panel .form-row {
          display: flex; flex-direction: column; gap: 0.35rem;
          margin-bottom: 0.9rem;
        }
        .adm-modal-panel .form-row label {
          font-family: var(--font-body); font-size: 0.66rem;
          letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-modal-panel .form-actions {
          display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: flex-end; margin-top: 1rem;
        }

        /* chart */
        .adm-chart { display: flex; align-items: flex-end; gap: 0.9rem; height: 160px; padding-top: 0.5rem; }
        .adm-chart .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.45rem; height: 100%; justify-content: flex-end; }
        .adm-chart .bar {
          width: 100%; max-width: 46px;
          border-radius: var(--r-sm) var(--r-sm) 0 0;
          background: linear-gradient(180deg, var(--primary), color-mix(in srgb, var(--primary) 55%, transparent));
          transition: height 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .adm-chart .val { font-family: var(--font-body); font-size: 0.56rem; font-weight: 500; color: var(--text-muted); }
        .adm-chart .mon { font-family: var(--font-body); font-size: 0.56rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-dim); }

        /* calendar */
        .adm-cal-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.9rem 1.2rem;
          border-bottom: 1px solid var(--border);
          background: var(--bg-subtle);
          border-radius: var(--r-xl) var(--r-xl) 0 0;
        }
        .adm-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; padding: 0.5rem; }
        .adm-cal-dow {
          text-align: center; padding: 0.45rem 0;
          font-family: var(--font-body); font-size: 0.52rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-cal-cell { min-height: 62px; padding: 0.35rem 0.4rem; border-radius: var(--r-sm); }
        .adm-cal-cell .d { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); margin-bottom: 0.2rem; }
        .adm-cal-ev {
          display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-family: var(--font-body); font-size: 0.5rem; font-weight: 500;
          padding: 0.08rem 0.3rem; border-radius: 3px; margin-bottom: 1px;
        }


        /* ── overview ──
           These --ov-* names are kept because ~80 rules below read them, but every
           one now forwards to a house token instead of carrying its own literal.
           The tab used to run a self-contained lime-on-charcoal skin (#C0FF00 on
           #1C1C1C, Inter/Jost) — a third design language sitting between the plum
           site and the plum admin chrome, and one that needed its own hand-written
           dark path. Forwarding deletes that path: .dark rebinds --surface,
           --text-primary and the rest, and everything here follows. Layout values
           (--ov-r, the grid gap) are unchanged. */
        .adm-ov {
          --ov-lime: var(--accent);
          --ov-lime-2: var(--accent-hover);
          --ov-lime-soft: var(--accent-muted);
          --ov-lime-ink: var(--accent);
          --ov-lime-on: var(--accent-text);
          --ov-charcoal: var(--primary);
          --ov-ink: var(--text-primary);
          --ov-muted: var(--text-muted);
          --ov-card: var(--surface);
          --ov-chip: var(--bg-subtle);
          --ov-line: var(--border);
          --ov-dash: var(--border-strong);
          --ov-neg: var(--danger-muted);
          --ov-neg-ink: var(--danger);
          --ov-r: 22px;
          --ov-font: var(--font-body);
          font-family: var(--ov-font);
          gap: 1.15rem !important;
        }
        .adm-ov .adm-title {
          font-family: var(--ov-font); font-weight: 600;
          letter-spacing: -0.03em; color: var(--ov-ink);
        }
        .adm-ov .adm-title em { color: var(--ov-lime-ink) !important; font-style: normal !important; }
        .adm-ov .adm-greet { font-family: var(--ov-font); font-size: 0.8rem; font-weight: 400; color: var(--ov-muted); margin-top: 0.3rem; }
        .adm-ov .adm-iconbtn {
          border-radius: 50%; background: var(--ov-chip);
          border-color: transparent; color: var(--ov-muted);
        }
        .adm-ov .adm-iconbtn:hover { background: var(--ov-lime); border-color: transparent; color: var(--ov-lime-on); }

        /* top region — 2x2 KPI grid on the left, sales panel on the right */
        .adm-ov-top {
          display: grid;
          grid-template-columns: minmax(280px, 4.4fr) minmax(340px, 5.6fr);
          gap: 1.15rem; align-items: stretch;
        }
        .adm-ov-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 1.15rem; }
        @media (max-width: 1080px) { .adm-ov-top { grid-template-columns: 1fr; } }
        @media (max-width: 560px)  { .adm-ov-kpis { grid-template-columns: 1fr; } }

        .adm-ov-surface {
          background: var(--ov-card);
          border: 1px solid var(--ov-line);
          border-radius: var(--ov-r);
        }

        .adm-ov-kpi {
          position: relative; overflow: hidden;
          padding: 1.15rem 1.2rem 1.2rem;
          min-height: 152px;
          display: flex; flex-direction: column;
          transition: transform 0.28s ease, box-shadow 0.28s ease;
        }
        .adm-ov-kpi:hover { transform: translateY(-3px); box-shadow: 0 14px 34px rgba(20, 20, 20, 0.09); }
        .adm-ov-kpi .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
        .adm-ov-kpi .lbl { font-size: 0.775rem; font-weight: 500; letter-spacing: -0.01em; color: var(--ov-muted); }
        .adm-ov-kpi .ico {
          width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%;
          background: var(--ov-chip); color: var(--ov-muted);
          display: flex; align-items: center; justify-content: center;
        }
        .adm-ov-kpi .num {
          margin-top: auto;
          font-size: clamp(1.55rem, 2.5vw, 2.05rem);
          font-weight: 700; letter-spacing: -0.035em; line-height: 1.05;
          color: var(--ov-ink);
        }
        .adm-ov-kpi .foot {
          display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
          margin-top: 0.5rem; font-size: 0.685rem; font-weight: 400; color: var(--ov-muted);
        }

        /* the single accent card — rich green with a lime bloom in the corner */
        /* The featured KPI card is a dark fill in BOTH themes, so its values are
           pinned literals rather than tokens — the same contract .dark-band has.
           It was a green gradient under a lime highlight, which belonged to neither
           the old palette nor this one. */
        .adm-ov-kpi.accent {
          border-color: transparent;
          background:
            radial-gradient(120% 95% at 92% 4%, rgba(168, 186, 156, 0.38) 0%, rgba(168, 186, 156, 0) 58%),
            linear-gradient(142deg, #3E6B43 0%, #224326 52%, #16281A 100%);
          box-shadow: 0 10px 30px rgba(22, 40, 26, 0.28);
        }
        .adm-ov-kpi.accent .lbl { color: rgba(238, 243, 234, 0.9); }
        .adm-ov-kpi.accent .num { color: #EEF3EA; }
        .adm-ov-kpi.accent .foot { color: rgba(238, 243, 234, 0.84); }
        .adm-ov-kpi.accent .ico { background: rgba(238, 243, 234, 0.16); color: #EEF3EA; }

        .adm-ov-badge {
          display: inline-flex; align-items: center; gap: 0.15rem;
          padding: 0.16rem 0.44rem; border-radius: 999px;
          font-size: 0.655rem; font-weight: 600; letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .adm-ov-badge.up   { background: var(--ov-lime-soft); color: var(--ov-lime-ink); }
        .adm-ov-badge.down { background: var(--ov-neg); color: var(--ov-neg-ink); }
        .adm-ov-kpi.accent .adm-ov-badge { background: rgba(168, 186, 156, 0.20); color: #A8BA9C; }

        /* sales panel */
        .adm-ov-panel { padding: 1.3rem 1.4rem 1.2rem; display: flex; flex-direction: column; }
        .adm-ov-panel h3 {
          font-family: var(--ov-font); font-size: 1.06rem; font-weight: 600;
          letter-spacing: -0.025em; color: var(--ov-ink); margin: 0;
        }
        .adm-ov-panel .sub { font-size: 0.71rem; font-weight: 400; color: var(--ov-muted); margin: 0.25rem 0 0; }
        .adm-ov-panel .sub b { font-weight: 600; color: var(--ov-ink); }
        .adm-ov-legend { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .adm-ov-legend span {
          display: inline-flex; align-items: center; gap: 0.35rem;
          font-size: 0.66rem; font-weight: 500; color: var(--ov-muted);
        }
        .adm-ov-legend i { width: 9px; height: 9px; border-radius: 3px; display: block; }

        .adm-ov-chart { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 0.7rem; margin-top: 1.15rem; }
        .adm-ov-chart .ax {
          display: flex; flex-direction: column; justify-content: space-between;
          height: 178px; min-width: 30px; text-align: right;
          font-size: 0.6rem; font-weight: 500; color: var(--ov-muted);
        }
        .adm-ov-chart .ax span { transform: translateY(-0.35em); line-height: 1; }
        .adm-ov-plot { position: relative; height: 178px; }
        .adm-ov-plot .grid { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; }
        .adm-ov-plot .grid i { display: block; border-top: 1px dashed var(--ov-dash); }
        .adm-ov-plot .bars { position: absolute; inset: 0; display: flex; align-items: flex-end; }
        .adm-ov-grp { flex: 1; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 4px; }
        .adm-ov-bar {
          width: clamp(9px, 26%, 19px); min-height: 3px;
          border-radius: 5px 5px 2px 2px;
          transition: height 0.7s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .adm-ov-bar.net { background: repeating-linear-gradient(135deg, var(--ov-lime) 0 5px, var(--ov-lime-2) 5px 10px); }
        .adm-ov-bar.ref { background: var(--ov-charcoal); }
        .adm-ov-months { grid-column: 2; display: flex; margin-top: 0.55rem; }
        .adm-ov-months span {
          flex: 1; text-align: center;
          font-size: 0.585rem; font-weight: 500; letter-spacing: 0.14em;
          text-transform: uppercase; color: var(--ov-muted);
        }

        .adm-ov-ai { margin-top: auto; padding-top: 0.95rem; border-top: 1px solid var(--ov-line); }
        .adm-ov-ai .cap {
          font-size: 0.55rem; font-weight: 600; letter-spacing: 0.2em;
          text-transform: uppercase; color: var(--ov-muted);
        }
        .adm-ov-ai p { font-size: 0.745rem; font-weight: 400; line-height: 1.65; color: var(--ov-ink); margin: 0.35rem 0 0.7rem; }
        .adm-ov-btn {
          font-family: var(--ov-font); font-size: 0.7rem; font-weight: 500;
          padding: 0.5rem 0.95rem; border-radius: 999px;
          border: 1px solid var(--ov-line); background: var(--ov-chip);
          color: var(--ov-ink); cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-ov-btn:hover:not(:disabled) { background: var(--ov-lime); border-color: var(--ov-lime); color: var(--ov-lime-on); }
        .adm-ov-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        /* full-width calendar, anchored below both */
        .adm-ov-cal { overflow: hidden; }
        .adm-ov-cal .adm-cal-head {
          background: var(--ov-chip); border-bottom: 1px solid var(--ov-line);
          border-radius: 0; padding: 0.95rem 1.25rem;
        }
        .adm-ov-cal .adm-cal-title {
          font-family: var(--ov-font); font-size: 0.94rem; font-weight: 600;
          letter-spacing: -0.02em; color: var(--ov-ink);
        }
        .adm-ov-cal .adm-cal-grid { gap: 6px; padding: 0.5rem 1rem 0.9rem; }
        .adm-ov-cal .adm-cal-grid:first-of-type { padding-bottom: 0; }
        .adm-ov-cal .adm-cal-dow {
          font-family: var(--ov-font); font-size: 0.575rem; font-weight: 600;
          letter-spacing: 0.16em; color: var(--ov-muted);
        }
        .adm-ov-cal .adm-cal-cell {
          min-height: 78px; padding: 0.45rem 0.5rem;
          border-radius: 14px; border: 1px solid transparent;
          transition: background 0.18s, border-color 0.18s, transform 0.18s;
        }
        .adm-ov-cal .adm-cal-cell:hover { transform: translateY(-1px); border-color: var(--ov-dash); }
        .adm-ov-cal .adm-cal-cell .d {
          font-family: var(--ov-font); font-size: 0.75rem; font-weight: 600;
          color: var(--ov-ink); margin-bottom: 0.25rem;
        }
        .adm-ov-cal .adm-cal-ev {
          font-family: var(--ov-font); font-size: 0.55rem; font-weight: 500;
          border-radius: 5px; padding: 0.1rem 0.32rem;
        }
        .adm-ov-cal .adm-cal-foot {
          border-top: 1px solid var(--ov-line); padding: 0.9rem 1.25rem;
          display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap;
          font-family: var(--ov-font); font-size: 0.73rem; color: var(--ov-muted);
        }

        /* bookings tab — tree-menu column beside the grouped table */
        /* rows */
        .adm-row { border-bottom: 1px solid var(--border); }
        .adm-row:last-child { border-bottom: none; }

        /* Clickable data rows. The tint is drawn as a full-bleed inset shadow so it
           layers over whatever the row's own background is — the menu/rental/service
           rows sit on --surface, the tray rows on a --primary fill, and one rule
           covers both by picking the tint from the matching foreground token. */
        .adm-datarow { transition: box-shadow 0.2s ease; }
        .adm-datarow:hover {
          box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--text-primary) 5%, transparent);
        }
        .adm-datarow--onfill:hover {
          box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--primary-text) 10%, transparent);
        }

        /* responsive */
        @media (max-width: 900px) {
          .adm-main { margin-left: 0; }
          .adm-sidebar { transform: translateX(-100%); }
          .adm-sidebar.open { transform: translateX(0); box-shadow: var(--shadow-lg); }
          .adm-scrim.open { display: block; }
          .adm-burger { display: flex; }
          .adm-drawer-close { display: flex; }
          .adm-topbar { padding: 0.8rem 1.25rem; }
          .adm-content { padding: 1.5rem 1.25rem 4rem !important; }
          .adm-overview-cols { grid-template-columns: 1fr !important; }
        }

        /* ── master/detail panes (support threads, booking history) ──
           Both columns carry a hard min width, so below ~860px the pair overflows
           the content box instead of shrinking. The detail side is minmax(0, 1fr)
           rather than 1fr so a wide table inside can't blow the column out either. */
        .adm-split {
          display: grid; gap: 1rem; align-items: start;
          grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
        }
        .adm-split--history {
          gap: 14px;
          grid-template-columns: minmax(190px, 4fr) minmax(240px, 8fr);
        }
        @media (max-width: 860px) {
          .adm-split, .adm-split--history { grid-template-columns: minmax(0, 1fr); }
        }

        @media (max-width: 640px) {
          /* Two form columns leave ~130px a field once the overlay and panel padding
             are taken out — narrower than the inputs' own text. */
          .adm-modal-panel .form-grid { grid-template-columns: 1fr; }
          /* Top-aligned so a tall form scrolls from its heading rather than being
             centred with both ends clipped. */
          .adm-modal-overlay { padding: 0.75rem; align-items: flex-start; }
          .adm-modal-panel { max-height: calc(100dvh - 1.5rem); padding: 1.1rem 1rem; }
          .adm-modal-panel .form-actions > * { flex: 1 1 auto; }
          /* Seven columns leave ~44px a cell here, so the reserved row height is
             what makes an empty month fill the screen. */
          .adm-cal-cell { min-height: 46px; padding: 0.25rem 0.2rem; }
          .adm-title { font-size: 1.25rem; }
        }

        /* The tab label is the only elastic thing in the topbar; without this it
           pushes the bell, theme toggle and avatar off the right edge on a phone. */
        .adm-topbar-title {
          min-width: 0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }

        @media (max-width: 560px) {
          .adm-topbar { padding: 0.7rem 1rem; }
          .adm-content { padding: 1.25rem 1rem 3.5rem !important; }
          .adm-cal-head { padding: 0.75rem 0.9rem; }
          .adm-chart { gap: 0.4rem; }
        }

        /* ── contract (item 2) ──
           Same browser-print approach as the customer invoice (#cds-invoice): the
           admin prints or saves as PDF from the browser, so there's no PDF library
           anywhere in the stack. Everything but the contract is hidden for print. */
        @media print {
          body * { visibility: hidden; }
          #adm-contract, #adm-contract * { visibility: visible; }
          #adm-contract {
            position: fixed; inset: 0; max-height: none; overflow: visible;
            border: none; box-shadow: none; border-radius: 0;
            background: #fff; color: #000; padding: 2rem;
          }
          .adm-contract-noprint { display: none !important; }
        }

        /* ── printable invoice ──
           The letterhead is paper-only: on screen the modal sits inside the dashboard,
           but a printed page arrives with no context and has to identify itself. */
        .adm-invoice-printonly { display: none; }
        .adm-invoice-letterhead {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 1.5rem; padding: 0 0 0.9rem; margin-bottom: 1.2rem;
          border-bottom: 2px solid #000;
        }
        .adm-invoice-brand { font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; }
        .adm-invoice-word {
          font-family: var(--font-display); font-size: 1.5rem; font-weight: 600;
          letter-spacing: 0.12em;
        }
        .adm-invoice-sub { font-family: var(--font-body); font-size: 0.72rem; font-weight: 300; }

        @media print {
          #adm-invoice, #adm-invoice * { visibility: visible; }

          /* !important throughout: the panel carries maxHeight/overflowY as INLINE
             styles, which outrank an id selector. Without it the invoice keeps its
             90vh box and its inner scroller, so anything past the first page is
             silently cut off instead of paginating. */
          #adm-invoice {
            position: fixed !important; inset: 0 !important;
            width: auto !important; max-height: none !important; overflow: visible !important;
            display: block !important;
            border: none !important; box-shadow: none !important; border-radius: 0 !important;
            background: #fff !important; color: #000 !important;
            padding: 0 !important;
          }
          #adm-invoice .adm-invoice-body {
            max-height: none !important; overflow: visible !important;
            padding: 0 !important;
          }

          .adm-invoice-noprint { display: none !important; }
          .adm-invoice-printonly { display: block !important; }

          /* Hairlines survive the trip to paper; var(--border) can be near-white. */
          #adm-invoice table, #adm-invoice td, #adm-invoice th { border-color: #999 !important; }
          #adm-invoice table { page-break-inside: auto; }
          #adm-invoice tr { page-break-inside: avoid; }

          @page { margin: 16mm; }
        }
      `}</style>

      <ToastViewport toasts={toasts} onDismiss={dismiss} />

      {cashTarget && (
        <CashPaymentModal
          bookingId={cashTarget.bookingId}
          bookingName={cashTarget.bookingName}
          notify={notify}
          onClose={() => setCashTarget(null)}
          onRecorded={applyCashResult}
        />
      )}

      {/* Event resource planning — furniture, service-ware and staff counts. Separate
          from DraftItemsEditor above: that one adds PRICED lines and is Draft-only,
          this one is operational and works on a Confirmed booking. */}
      {resourcesResId && (() => {
        const target = reservations.find((r) => r.id === resourcesResId);
        // The row could have gone (a refresh mid-modal); close rather than render an
        // allocation form with no booking behind it.
        if (!target) return null;
        return (
          <EventResourcesModal
            bookingId={target.id}
            eventType={target.eventType}
            guestCount={target.guestCount}
            bookingName={target.bookingName}
            notify={notify}
            // Completed is a historical record: viewable so staff can check what was
            // sent, but not editable. The server would still accept a write (it only
            // refuses Cancelled) — this is a product decision enforced in the UI.
            readOnly={target.status === 'Completed'}
            onClose={() => setResourcesResId(null)}
            // Refetch so the row's button reflects the saved plan, mirroring how
            // DraftItemsEditor's onChanged reloads after a change.
            onSaved={() => { void loadBookings(); }}
          />
        );
      })()}

      {/* ══════════ INVOICE VIEW ══════════
          Shows the invoice Submit already issued. Line descriptions come from the
          booking detail, but every figure comes from the INVOICE — those are the
          captured totals the customer is billed against, and they can legitimately
          differ from a live recomputation if a catalog price moved after submit. */}
      {invoiceView && (() => {
        const { booking: ib, invoice, detail } = invoiceView;
        const close = () => setInvoiceView(null);
        const balance = invoice ? invoice.grandTotal - invoice.paidTotal : 0;

        const TotalRow = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.3rem 0', fontFamily: 'var(--font-body)', fontSize: strong ? '0.95rem' : '0.8rem', fontWeight: strong ? 600 : 300, color: strong ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            <span>{label}</span>
            <span style={{ whiteSpace: 'nowrap', color: strong ? 'var(--primary)' : undefined }}>{value}</span>
          </div>
        );

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Invoice"
            style={{
              position: 'fixed', inset: 0, zIndex: 121,
              background: 'rgba(20, 14, 8, 0.55)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
            }}
            onClick={close}
          >
            <div
              id="adm-invoice"
              className="adm-card"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(720px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            >
              <div className="adm-invoice-noprint" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.8rem', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <FieldLabel text={invoice ? `Invoice ${invoice.id.slice(0, 8).toUpperCase()}` : 'Invoice'} />
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0.15rem 0 0' }}>
                    {ib.bookingName}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {invoice && <StatusBadge label={invoice.status} color="var(--primary)" />}
                  {invoice && (
                    <button type="button" className="adm-btn outline" onClick={() => window.print()}>
                      🖨 Print
                    </button>
                  )}
                  <button type="button" className="adm-iconbtn" aria-label="Close" onClick={close}>✕</button>
                </div>
              </div>

              {/* Paper-only letterhead. The on-screen modal has the dashboard around it
                  for context; a printed page has nothing, so it needs to say who issued
                  it and what it is. */}
              <div className="adm-invoice-printonly">
                <div className="adm-invoice-letterhead">
                  <div>
                    <div className="adm-invoice-brand">King Jegi Party Need and Catering Services</div>
                    <div className="adm-invoice-sub">Calamba, Laguna · Events &amp; Catering</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="adm-invoice-word">INVOICE</div>
                    {invoice && <div className="adm-invoice-sub">No. {invoice.id.slice(0, 8).toUpperCase()}</div>}
                  </div>
                </div>
              </div>

              <div className="adm-invoice-body" style={{ overflowY: 'auto', padding: '1.4rem 1.5rem 1.8rem' }}>
                {!invoice ? (
                  /* The edge case. Submit is the only route to Pending and it always
                     issues an invoice, so reaching this means something upstream
                     skipped generation — worth investigating, not just clicking past. */
                  <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                    <ScrollText size={26} strokeWidth={1.5} aria-hidden="true" style={{ marginBottom: '0.6rem', color: 'var(--text-dim)' }} />
                    <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.4rem' }}>
                      No invoice yet
                    </h4>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 1.2rem', lineHeight: 1.6 }}>
                      Submitting a booking normally issues its invoice automatically, so this
                      is unexpected. Issuing one here is safe, but it's worth checking how this
                      booking reached {ib.status} without one.
                    </p>
                    <button
                      type="button"
                      className="adm-btn primary"
                      disabled={invoiceBusyId === ib.id}
                      onClick={() => void generateMissingInvoice(ib)}
                    >
                      {invoiceBusyId === ib.id ? 'Issuing…' : 'Issue invoice now'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.9rem', marginBottom: '1.3rem' }}>
                      <div>
                        <FieldLabel text="Billed to" />
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.15rem' }}>{ib.bookingName}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-muted)' }}>{ib.venueAddress}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-muted)' }}>{ib.contactNumber || '—'}</div>
                      </div>
                      <div>
                        <FieldLabel text="Issued" />
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.15rem' }}>{fmtDate(invoice.issueDate)}</div>
                        <FieldLabel text="Due" />
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.15rem' }}>{fmtDate(invoice.dueDate)}</div>
                      </div>
                      <div>
                        <FieldLabel text="Event" />
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.15rem' }}>{fmtDate(ib.eventDate)}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                          {fmtTime(ib.startTime)}{ib.endTime ? ` – ${fmtTime(ib.endTime)}` : ''}
                        </div>
                      </div>
                    </div>

                    {detail && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, marginBottom: '1.2rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ textAlign: 'left', padding: '0.4rem 0', fontSize: '0.62rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Description</th>
                            <th style={{ textAlign: 'right', padding: '0.4rem 0', fontSize: '0.62rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.package && (
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.45rem 0' }}>Package — {detail.package.packageName}</td>
                              <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(detail.package.basePrice)}</td>
                            </tr>
                          )}
                          {detail.menuItems.map((m) => (
                            <tr key={m.itemId} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.45rem 0' }}>{m.itemName} × {m.quantity}</td>
                              <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(m.lineTotal)}</td>
                            </tr>
                          ))}
                          {detail.menuTrays.map((t) => (
                            <tr key={t.trayId} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.45rem 0' }}>{t.trayName} × {t.quantity}</td>
                              <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(t.lineTotal)}</td>
                            </tr>
                          ))}
                          {detail.rentals.map((r) => (
                            <tr key={r.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.45rem 0' }}>Rental — {r.itemName} × {r.quantity}</td>
                              <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.subtotal)}</td>
                            </tr>
                          ))}
                          {detail.services.map((sv) => (
                            <tr key={sv.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.45rem 0' }}>Service — {sv.serviceName} × {sv.quantity}</td>
                              <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(sv.totalCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
                      <TotalRow label="Food" value={fmt(invoice.foodTotal)} />
                      <TotalRow label="Rentals" value={fmt(invoice.rentalTotal)} />
                      <TotalRow label="Services" value={fmt(invoice.serviceTotal)} />
                      {/* VAT was removed, so new invoices carry 0 and the row is noise.
                          Invoices issued while VAT applied keep their tax and still show
                          it — the figure is part of what the customer was billed. */}
                      {invoice.taxAmount > 0 && <TotalRow label="Tax" value={fmt(invoice.taxAmount)} />}
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.35rem', paddingTop: '0.35rem' }}>
                        <TotalRow label="Grand total" value={fmt(invoice.grandTotal)} strong />
                      </div>
                      <TotalRow label="Paid" value={fmt(invoice.paidTotal)} />
                      <TotalRow
                        label={balance > 0 ? 'Balance due' : 'Balance'}
                        value={fmt(balance)}
                        strong={balance > 0}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ BOOKING DETAIL VIEW (phase 4) ══════════
          Read-only. Everything the admin needs at a glance without leaving the
          Bookings tab; editing still happens through the existing actions. */}
      {/* Top level, not inside the Rentals tab: the same modal is reachable from a
          booking's detail view, which renders over any tab. The damage note is required
          by the backend, so the confirm button stays disabled until there is one. */}
      {damageTarget && createPortal(
        <div className="adm-modal-overlay" onClick={() => setDamageTarget(null)}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Mark rental line damaged">
            <h3>Mark as Damaged</h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.2rem' }}>
              {damageTarget.quantity} × {damageTarget.itemName} — {damageTarget.customerName}, {fmtDate(damageTarget.eventDate)}.
              This keeps the stock held out of inventory until the line is resolved.
            </p>
            <label style={{ display: 'block', marginTop: '1rem' }}>
              <FieldLabel text="What's wrong? (required)" />
              <textarea
                className="adm-input"
                rows={3}
                maxLength={500}
                value={damageNote}
                autoFocus
                onChange={(e) => setDamageNote(e.target.value)}
                placeholder="e.g. 3 chairs with cracked legs"
                style={{ width: '100%', resize: 'vertical' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button type="button" className="adm-btn outline" onClick={() => setDamageTarget(null)}>Cancel</button>
              <button type="button" className="adm-btn danger" disabled={!damageNote.trim()} onClick={() => void confirmDamage()}>
                Mark Damaged
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {detailBooking && (() => {
        const b = detailBooking.booking;
        const isDelivery = b.bookingType === 'FoodDelivery';
        const lineTotal =
          detailBooking.rentals.reduce((s, r) => s + r.subtotal, 0) +
          detailBooking.services.reduce((s, sv) => s + sv.totalCost, 0) +
          detailBooking.menuItems.reduce((s, m) => s + m.lineTotal, 0) +
          detailBooking.menuTrays.reduce((s, t) => s + t.lineTotal, 0);
        const hasLines =
          detailBooking.rentals.length + detailBooking.services.length +
          detailBooking.menuItems.length + detailBooking.menuTrays.length > 0;

        const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
          <div>
            <FieldLabel text={label} />
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
              {value}
            </div>
          </div>
        );

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Booking details"
            style={{
              position: 'fixed', inset: 0, zIndex: 120,
              background: 'rgba(20, 14, 8, 0.55)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
            }}
            onClick={() => { setDetailBooking(null); setDetailInvoice(null); }}
          >
            <div
              className="adm-card"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(720px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.8rem', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <FieldLabel text={`Reference ${b.id.slice(0, 8).toUpperCase()}`} />
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0.15rem 0 0' }}>
                    {b.bookingName}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <StatusBadge label={RES_STATUS[b.status as ResStatus]?.label ?? b.status} color={RES_STATUS[b.status as ResStatus]?.color ?? 'var(--text-secondary)'} />
                  <button type="button" className="adm-iconbtn" aria-label="Close" onClick={() => { setDetailBooking(null); setDetailInvoice(null); }}>✕</button>
                </div>
              </div>

              <div style={{ overflowY: 'auto', padding: '1.4rem 1.5rem 1.8rem', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
                <div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '0 0 0.7rem' }}>Event</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.9rem' }}>
                    <Row label="Booking type" value={BOOKING_TYPE_LABELS[b.bookingType as BookingTypeName] ?? b.bookingType} />
                    <Row label="Event type" value={b.eventType ?? '—'} />
                    <Row label={isDelivery ? 'Delivery date' : 'Start date'} value={fmtDate(b.eventDate)} />
                    <Row label={isDelivery ? 'Delivery time' : 'Start time'} value={fmtTime(b.startTime)} />
                    {!isDelivery && <Row label="End date" value={b.endDate ? fmtDate(b.endDate) : '—'} />}
                    {!isDelivery && <Row label="End time" value={fmtTime(b.endTime)} />}
                    <Row label="Guests" value={b.guestCount ?? '—'} />
                    <Row label="Deposit" value={b.depositStatus} />
                  </div>
                  <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.9rem' }}>
                    <Row label={isDelivery ? 'Delivery address' : 'Venue'} value={b.venueAddress} />
                    <Row label="Contact number" value={b.contactNumber || '—'} />
                  </div>
                </div>

                {b.cancellationRequested && (
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', padding: '0.6rem 0.85rem', borderLeft: '2px solid var(--accent)', margin: 0 }}>
                    ⚠ <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Cancellation requested:</strong> {b.cancellationRequestReason || 'No reason given.'}
                  </p>
                )}

                {b.adminNote && (
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', padding: '0.6rem 0.85rem', borderLeft: '2px solid var(--border-accent)', margin: 0, whiteSpace: 'pre-wrap' }}>
                    <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Staff note:</strong> {b.adminNote}
                  </p>
                )}

                <div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '0 0 0.7rem' }}>Items</h4>
                  {!hasLines && !detailBooking.package ? (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                      Nothing has been added to this booking yet.
                    </p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300 }}>
                      <tbody>
                        {detailBooking.package && (
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.45rem 0' }}>
                              <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Package — {detailBooking.package.packageName}</strong>
                            </td>
                            <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(detailBooking.package.basePrice)}</td>
                          </tr>
                        )}
                        {detailBooking.menuItems.map((m) => (
                          <tr key={m.itemId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.45rem 0' }}>{m.itemName} × {m.quantity}</td>
                            <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(m.lineTotal)}</td>
                          </tr>
                        ))}
                        {detailBooking.menuTrays.map((t) => (
                          <tr key={t.trayId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.45rem 0' }}>{t.trayName} × {t.quantity}</td>
                            <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(t.lineTotal)}</td>
                          </tr>
                        ))}
                        {detailBooking.rentals.map((r) => (
                          <tr key={r.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.45rem 0' }}>
                              Rental — {r.itemName} × {r.quantity}
                              <span style={{ color: DELIVERY_STATUS_STYLE[r.deliveryStatus].color }}>
                                {' '}· {DELIVERY_STATUS_STYLE[r.deliveryStatus].label}
                              </span>
                              {r.damageNote && (
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, color: 'var(--danger)' }}>
                                  ⚠ {r.damageNote}
                                </div>
                              )}
                              {/* Same actions as the returns desk, for an admin already
                                  looking at this one event. */}
                              {DELIVERY_NEXT_STATUSES[r.deliveryStatus].length > 0 && (
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                                  {DELIVERY_NEXT_STATUSES[r.deliveryStatus].map((next) => (
                                    <button
                                      key={next}
                                      type="button"
                                      className={`adm-btn ${next === 'Returned' ? 'success' : next === 'Damaged' ? 'danger' : 'info'}`}
                                      disabled={returnsBusyId === r.lineId}
                                      onClick={() => {
                                        const line = detailLineToOutstanding(r);
                                        if (!line) return;
                                        if (next === 'Damaged') {
                                          setDamageNote('');
                                          setDamageTarget(line);
                                        } else {
                                          void applyDeliveryStatus(line, next);
                                        }
                                      }}
                                    >
                                      {DELIVERY_ACTION_LABEL[next]}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.subtotal)}</td>
                          </tr>
                        ))}
                        {detailBooking.services.map((sv) => (
                          <tr key={sv.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.45rem 0' }}>Service — {sv.serviceName} × {sv.quantity}</td>
                            <td style={{ padding: '0.45rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(sv.totalCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Editing is Draft-only server-side (Bookingservice.EnsureEditableAsync),
                    so the panel appears exactly where the API would accept it. */}
                {b.status === 'Draft' && (
                  <div>
                    <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '0 0 0.2rem' }}>Add items</h4>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-dim)', margin: '0 0 0.9rem' }}>
                      Same catalog and rules the customer wizard uses. Submit freezes the
                      total and issues the invoice, so add everything first.
                    </p>
                    <DraftItemsEditor
                      detail={detailBooking}
                      notify={notify}
                      onChanged={async () => {
                        // Refetch so the Items table and Money block above reflect the
                        // server's recomputed total rather than a local guess.
                        await refreshBookingDetail(b.id);
                        await loadBookings();
                      }}
                    />
                  </div>
                )}

                <div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '0 0 0.7rem' }}>Money</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.9rem' }}>
                    <Row label="Line items" value={fmt(lineTotal)} />
                    <Row label="Booking total" value={fmt(b.totalAmount)} />
                    {detailInvoice ? (
                      <>
                        {detailInvoice.taxAmount > 0 && <Row label="Tax" value={fmt(detailInvoice.taxAmount)} />}
                        <Row label="Grand total" value={<span style={{ color: 'var(--primary)' }}>{fmt(detailInvoice.grandTotal)}</span>} />
                        <Row label="Paid" value={fmt(detailInvoice.paidTotal)} />
                        <Row label="Balance" value={fmt(detailInvoice.grandTotal - detailInvoice.paidTotal)} />
                        <Row label="Invoice status" value={detailInvoice.status} />
                        <Row label="Due date" value={fmtDate(detailInvoice.dueDate)} />
                      </>
                    ) : (
                      <Row label="Invoice" value={<span style={{ color: 'var(--text-dim)', fontWeight: 300 }}>Not generated yet</span>} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ CONTRACT (item 2) — printable service agreement ══════════ */}
      {contractBooking && (() => {
        const b = contractBooking.booking;
        const lineTotal =
          contractBooking.rentals.reduce((s, r) => s + r.subtotal, 0) +
          contractBooking.services.reduce((s, sv) => s + sv.totalCost, 0) +
          contractBooking.menuItems.reduce((s, m) => s + m.lineTotal, 0) +
          contractBooking.menuTrays.reduce((s, t) => s + t.lineTotal, 0);

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Service contract"
            style={{
              position: 'fixed', inset: 0, zIndex: 120,
              background: 'rgba(20, 14, 8, 0.55)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
            }}
            onClick={() => { setContractBooking(null); setContractInvoice(null); }}
          >
            <div
              className="adm-card"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(760px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            >
              <div className="adm-contract-noprint" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.7rem', padding: '1rem 1.4rem', borderBottom: '1px solid var(--border)' }}>
                <FieldLabel text="Service Contract" />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="adm-btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
                  <button type="button" className="adm-btn outline" onClick={() => { setContractBooking(null); setContractInvoice(null); }}>Close</button>
                </div>
              </div>

              <div id="adm-contract" style={{ overflowY: 'auto', padding: '1.8rem 2rem 2.2rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '1.6rem' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600 }}>King Jegi Catering Services</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                    Catering Service Agreement
                  </div>
                </div>

                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                  This agreement is entered into between <strong style={{ color: 'var(--text-primary)' }}>King Jegi Catering Services</strong> (the
                  “Caterer”) and the Client named below, for the event described in this contract. It reflects the booking
                  as confirmed on the Caterer’s system.
                </p>

                {/* ── event details ── */}
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '1.4rem 0 0.5rem' }}>1. Event Details</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.35rem 1.5rem', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                  <span>Reference: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.id.slice(0, 8).toUpperCase()}</strong></span>
                  <span>Booking: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.bookingName}</strong></span>
                  <span>Type: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.eventType || b.bookingType}</strong></span>
                  <span>Date: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmtDate(b.eventDate)}</strong></span>
                  <span>Time: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.startTime?.substring(0, 5)}{b.endTime ? ` – ${b.endTime.substring(0, 5)}` : ''}</strong></span>
                  <span>Guests: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.guestCount ?? 'N/A'}</strong></span>
                  <span style={{ gridColumn: '1 / -1' }}>Venue: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.venueAddress}</strong></span>
                  <span>Contact: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.contactNumber || 'N/A'}</strong></span>
                </div>

                {/* ── inclusions ── */}
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '1.4rem 0 0.5rem' }}>2. Services &amp; Inclusions</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300 }}>
                  <tbody>
                    {contractBooking.package && (
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.4rem 0' }}>
                          <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Package — {contractBooking.package.packageName}</strong>
                          {contractBooking.package.inclusions.length > 0 && (
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{contractBooking.package.inclusions.join(' · ')}</div>
                          )}
                        </td>
                        <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(contractBooking.package.basePrice)}</td>
                      </tr>
                    )}
                    {contractBooking.menuItems.map((m) => (
                      <tr key={m.itemId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.4rem 0' }}>{m.itemName} × {m.quantity}</td>
                        <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(m.lineTotal)}</td>
                      </tr>
                    ))}
                    {contractBooking.menuTrays.map((t) => (
                      <tr key={t.trayId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.4rem 0' }}>{t.trayName} × {t.quantity}</td>
                        <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(t.lineTotal)}</td>
                      </tr>
                    ))}
                    {contractBooking.rentals.map((r) => (
                      <tr key={r.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.4rem 0' }}>Rental — {r.itemName} × {r.quantity}</td>
                        <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.subtotal)}</td>
                      </tr>
                    ))}
                    {contractBooking.services.map((sv) => (
                      <tr key={sv.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.4rem 0' }}>Service — {sv.serviceName} × {sv.quantity}</td>
                        <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(sv.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* ── money ── */}
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '1.4rem 0 0.5rem' }}>3. Fees &amp; Payment</h4>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', display: 'grid', gap: '0.25rem' }}>
                  <span>Line items subtotal: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(lineTotal)}</strong></span>
                  {contractInvoice ? (
                    <>
                      {contractInvoice.taxAmount > 0 && (
                        <span>Tax: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(contractInvoice.taxAmount)}</strong></span>
                      )}
                      <span style={{ fontSize: '0.9rem' }}>
                        Total contract price:{' '}
                        <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(contractInvoice.grandTotal)}</strong>
                      </span>
                      <span>Paid to date: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(contractInvoice.paidTotal)}</strong> · Balance: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(contractInvoice.grandTotal - contractInvoice.paidTotal)}</strong></span>
                      <span>Invoice due: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmtDate(contractInvoice.dueDate)}</strong></span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>
                      No invoice has been issued for this booking yet — tax and the final contract price will be confirmed on the invoice.
                    </span>
                  )}
                </div>

                {/* ── terms ── */}
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '1.4rem 0 0.5rem' }}>4. Terms</h4>
                <ol style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, lineHeight: 1.75, color: 'var(--text-muted)', paddingLeft: '1.1rem', margin: 0 }}>
                  <li>The reservation fee secures the event date and is applied against the total contract price.</li>
                  <li>Payment follows the schedule on the issued invoice. The date is only secured once the reservation fee is verified.</li>
                  <li>Final guest count and menu changes must be confirmed with the Caterer before the event date; changes may adjust the price.</li>
                  <li>Cancellations are subject to the Caterer’s cancellation and refund policy in force at the time of the request.</li>
                  <li>Rental items remain the property of the Caterer and must be returned in the condition supplied.</li>
                </ol>

                {/* ── signatures ── */}
                {/* auto-fit rather than 1fr 1fr: the two signature lines stack on a
                    phone but stay side by side on the printed sheet, which is wide. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2.5rem', marginTop: '2.4rem' }}>
                  {['Client', 'For King Jegi Catering Services'].map((who) => (
                    <div key={who}>
                      <div style={{ borderTop: '1px solid var(--text-primary)', paddingTop: '0.4rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                        {who} — signature over printed name / date
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="adm-shell">

        {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
        <div className={`adm-scrim${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
        <aside className={`adm-sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="adm-brand">
            <div className="adm-brand-mark">K</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                King Jegi
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
                Admin Panel
              </div>
            </div>
            {/* Drawer close, per artboard 8b. Below 900px the sidebar is a drawer and
                had no visible dismiss — only the scrim, which is not discoverable and
                is easy to miss on a narrow screen. Hidden at desktop, where the
                sidebar is permanent and there is nothing to close. */}
            <button
              type="button"
              className="adm-iconbtn adm-drawer-close"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <nav className="adm-nav" aria-label="Admin navigation">
            <span className="adm-nav-caption">Operations</span>
            {NAV.map((item) => (
              /* Bookings is an accordion over its status filters rather than a flat
                 entry; the rest of NAV renders as it always has. */
              item.id === 'bookings' ? (
                <BookingsTreeMenu
                  key={item.id}
                  expanded={bookingsNavOpen}
                  onToggleExpanded={() => {
                    // Expand AND select, so one click always puts something on screen.
                    // Collapsing while already on Bookings leaves the tab selected.
                    if (tab === 'bookings') setBookingsNavOpen((o) => !o);
                    else selectBookingStatus(lastBookingStatus.current);
                  }}
                  active={tab === 'bookings'}
                  value={resFilter}
                  onSelect={selectBookingStatus}
                  counts={resCounts}
                  totalCount={reservations.length}
                  badge={item.badge}
                />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  className={`adm-nav-item${tab === item.id ? ' active' : ''}`}
                  onClick={() => openTab(item.id)}
                >
                  <span className="adm-nav-icon">{item.icon}</span>
                  {item.label}
                  {item.badge != null && item.badge > 0 && <span className="adm-badge">{item.badge}</span>}
                </button>
              )
            ))}

            <span className="adm-nav-caption" style={{ marginTop: '0.9rem' }}>Management</span>
            <button
              type="button"
              className={`adm-nav-item${tab === 'menus' ? ' active' : ''}`}
              onClick={() => openTab('menus')}
            >
              <span className="adm-nav-icon"><UtensilsCrossed size={18} strokeWidth={1.75} /></span>
              Menus &amp; Dishes
            </button>
            <button
              type="button"
              className={`adm-nav-item${tab === 'rentals' ? ' active' : ''}`}
              onClick={() => openTab('rentals')}
            >
              <span className="adm-nav-icon"><Tent size={18} strokeWidth={1.75} /></span>
              Rentals
            </button>
            <button
              type="button"
              className={`adm-nav-item${tab === 'services' ? ' active' : ''}`}
              onClick={() => openTab('services')}
            >
              <span className="adm-nav-icon"><Wrench size={18} strokeWidth={1.75} /></span>
              Service Items
            </button>
            <Link
              to="/admin/booking-histories"
              className={`adm-nav-item${isRouteActive('/admin/booking-histories') ? ' active' : ''}`}
            >
              <span className="adm-nav-icon" aria-hidden="true"><CalendarClock size={18} strokeWidth={1.75} /></span>
              Booking Histories
            </Link>
            <button
              type="button"
              className={`adm-nav-item${tab === 'audit' ? ' active' : ''}`}
              onClick={() => openTab('audit')}
            >
              <span className="adm-nav-icon"><ScrollText size={18} strokeWidth={1.75} /></span>
              Audit Log
            </button>
            <button
              type="button"
              className={`adm-nav-item${tab === 'announcements' ? ' active' : ''}`}
              onClick={() => openTab('announcements')}
            >
              <span className="adm-nav-icon"><Megaphone size={18} strokeWidth={1.75} /></span>
              Announcements
            </button>
            {/* Owner-only. This is NOT the security boundary — the server's
                [Authorize(Roles = "Owner")] is. Hiding the item just spares an
                Assistant a tab that would only 403 at them. An undefined adminRole
                (a session persisted before that field existed) fails closed. */}
            {authUser?.adminRole === 'Owner' && (
              <button
                type="button"
                className={`adm-nav-item${tab === 'staff' ? ' active' : ''}`}
                onClick={() => openTab('staff')}
              >
                <span className="adm-nav-icon"><Users size={18} strokeWidth={1.75} /></span>
                Staff Management
              </button>
            )}
            {PLACEHOLDER_ITEMS.map((name) => (
              <button
                key={name}
                type="button"
                className={`adm-nav-item${tab === 'placeholder' && placeholderName === name ? ' active' : ''}`}
                onClick={() => { setPlaceholderName(name); openTab('placeholder'); }}
              >
                <span className="adm-nav-icon"><Circle size={18} strokeWidth={1.75} /></span>
                {name}
              </button>
            ))}
          </nav>

          <div className="adm-sidebar-foot">
            {/* The admin dashboard had a full `.dark` styling path but no way to reach
                it — an admin had to visit the landing page to change theme. */}
            <ThemeToggle className="adm-foot-btn" showLabel size={14} />
            <button type="button" className="adm-foot-btn danger" onClick={() => void logout()}>
              <LogOut size={15} strokeWidth={1.75} aria-hidden="true" /> Sign out
            </button>
          </div>
        </aside>

        {/* ═══════════════════════ MAIN ═══════════════════════ */}
        <div className="adm-main">

          {/* topbar */}
          <div className="adm-topbar">
            <button type="button" className="adm-iconbtn adm-burger" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span className="adm-topbar-title" style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--text-dim)' }}>
              {tab === 'placeholder' ? placeholderName : tab === 'menus' ? 'Menus & Dishes' : tab === 'services' ? 'Service Items' : tab === 'rentals' ? 'Rentals' : tab === 'audit' ? 'Audit Log' : tab === 'histories' ? 'Booking Histories' : tab === 'announcements' ? 'Announcements' : tab === 'staff' ? 'Staff Management' : NAV.find((n) => n.id === tab)?.label}
            </span>
            <div style={{ flex: 1 }} />

            {/* notification bell — the in-app view of what the NotificationWorker sent */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="adm-iconbtn"
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                aria-expanded={bellOpen}
                onClick={() => { setBellOpen((o) => !o); if (!bellOpen) void loadNotifications(); }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15,
                      padding: '0 3px', borderRadius: 'var(--r-full)', background: 'var(--danger)',
                      color: 'var(--accent-text)', fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                    }}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <>
                  {/* click-away layer, below the panel but above the page */}
                  <div style={{ position: 'fixed', inset: 0, zIndex: 130 }} onClick={() => setBellOpen(false)} />
                  <div
                    className="adm-card"
                    style={{
                      position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0, zIndex: 131,
                      width: 340, maxWidth: '90vw', maxHeight: 420, overflowY: 'auto', padding: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)' }}>
                      <FieldLabel text="Notifications" />
                      {unreadCount > 0 && (
                        <button type="button" className="adm-btn outline" onClick={() => void readAllNotifications()}>
                          Mark all read
                        </button>
                      )}
                    </div>

                    {notifications.length === 0 ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', padding: '1.6rem 1rem', textAlign: 'center', margin: 0 }}>
                        Nothing yet. Overdue-payment digests and low-stock alerts show up here.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => openNotification(n)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', border: 'none',
                            // Read rows stay clickable now that clicking navigates.
                            cursor: notificationTarget(n) === 'none' && n.readAt ? 'default' : 'pointer',
                            borderBottom: '1px solid var(--border)',
                            padding: '0.8rem 1rem',
                            background: n.readAt ? 'transparent' : 'var(--primary-muted)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
                            {!n.readAt && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />}
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</span>
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            {n.body}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                            {fmtDateTime(n.sentAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }} className="adm-hide-sm">
              {adminName} · {FALLBACK_ADMIN.role}
            </span>
            <div className="adm-avatar" title={adminName}>{adminName.charAt(0)}</div>
          </div>

          {/* content */}
          <div className="adm-content" style={{ padding: '2rem 2.25rem 4rem', flex: 1, maxWidth: 1240, width: '100%', margin: '0 auto' }}>

            {/* ══════════ OVERVIEW ══════════ */}
            {tab === 'overview' && (
              <OverviewTab
                adminName={adminName}
                reservations={reservations}
                payments={payments}
                calMonth={calMonth}
                onCalMonthChange={setCalMonth}
                onOpenBooking={(bookingName) => {
                  // Same hand-off the notification feed uses: search the Bookings tab
                  // for this booking by name. Clears the status filter too: without it,
                  // opening a Confirmed booking while the filter sat on Draft landed on
                  // an empty table.
                  setResSearch(bookingName);
                  selectBookingStatus('all');
                }}
                onReviewPending={() => selectBookingStatus('Pending')}
                onConfirmBooking={(id) => void setResStatus(id, 'Confirmed')}
                notify={notify}
              />
            )}

            {/* ══════════ BOOKINGS ══════════ */}
            {tab === 'bookings' && (
              <BookingsTab
                reservations={reservations}
                statusFilter={resFilter}
                typeFilter={resTypeFilter}
                onTypeFilterChange={setResTypeFilter}
                search={resSearch}
                onSearchChange={setResSearch}
                rowActions={bookingActions}
                busy={{ submitBusyId, detailBusyId, invoiceBusyId, contractBusyId }}
                onViewAll={(g) => selectBookingStatus(g)}
                onBookingUpdated={(updated) => setReservations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
                onBookingCreated={() => void loadBookings()}
                notify={notify}
              />
            )}

            {/* ══════════ PAYMENTS (live backend data) ══════════ */}
            {tab === 'payments' && (
              <PaymentsTab
                active={tab === 'payments'}
                refundQueue={refundQueue}
                reservations={reservations}
                paymentsLoading={paymentsLoading}
                paymentsError={paymentsError}
                paymentsAuthError={paymentsAuthError}
                actionBusyId={paymentActionBusy}
                refreshToken={paymentsRefresh}
                focus={paymentFocus}
                onRunAction={runPaymentAction}
                onRetryPayments={() => void loadPayments()}
                onLogCash={(b) => setCashTarget({ bookingId: b.id, bookingName: b.bookingName })}
              />
            )}

            {/* ══════════ AUDIT LOG (live backend data, Owner-only) ══════════ */}
            {tab === 'audit' && (
              <AuditLogTab />
            )}

            {/* ══════════ PACKAGES ══════════ */}
            {tab === 'packages' && (
              <AdminPackagesTab />
            )}

            {/* ══════════ TESTIMONIALS ══════════ */}
            {tab === 'testimonials' && (
              <TestimonialsTab notify={notify} onPendingCountChange={setPendingTesti} />
            )}

            {/* ══════════ BOOKING HISTORIES (live backend data) ══════════ */}
            {tab === 'histories' && (
              <BookingHistoriesTab
                reservations={reservations}
                bookingId={historyBookingId}
                onSelectBooking={setHistoryBookingId}
              />
            )}

            {/* ══════════ MENUS & DISHES (live backend data) ══════════ */}
            {tab === 'menus' && (
              <MenusTab />
            )}

            {/* ══════════ RENTALS (live backend data) ══════════ */}
            {tab === 'rentals' && (
              <RentalsTab
                outstandingRentals={outstandingRentals}
                returnsLoading={returnsLoading}
                returnsError={returnsError}
                returnsFeedback={returnsFeedback}
                returnsBusyId={returnsBusyId}
                catalogRefreshToken={rentalCatalogRefresh}
                onRefreshReturns={() => void loadOutstandingRentals()}
                onApplyStatus={(line, next) => void applyDeliveryStatus(line, next)}
                onMarkDamaged={(line) => { setDamageNote(''); setDamageTarget(line); }}
              />
            )}

                {/* ══════════ SERVICE ITEMS (live backend data) ══════════ */}
                {tab === 'services' && (
                  <ServiceItemsTab />
                )}

                {/* ══════════ ANNOUNCEMENTS ══════════ */}
                {tab === 'announcements' && (
                  <AnnouncementsTab notify={notify} />
                )}

                {/* ══════════ STAFF ══════════ */}
                {/* Gated here as well as on the nav, so a hand-typed ?tab=staff
                    lands on nothing. Still not the security boundary. */}
                {tab === 'staff' && authUser?.adminRole === 'Owner' && (
                  <div className="fade-up">
                    <h2 className="adm-title" style={{ marginBottom: '1.2rem' }}>Staff Management</h2>
                    <StaffPanel notify={notify} />
                  </div>
                )}

                {/* ══════════ PLACEHOLDER ══════════ */}
                {tab === 'placeholder' && (
                  placeholderName === 'Chat Support' ? (
                    <AdminSupportPanel notify={notify} />
                  ) : (
                  <div className="fade-up">
                <h2 className="adm-title" style={{ marginBottom: '1.2rem' }}>{placeholderName}</h2>
                <div className="adm-card" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                  <Circle size={28} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--text-dim)', marginBottom: '0.8rem' }} />
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    {placeholderName} management arrives when the backend is wired up.
                  </p>
                </div>
              </div>
              )
            )}
          </div>

          <footer style={{ borderTop: '1px solid var(--border)', padding: '1.75rem 2rem', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              © {new Date().getFullYear()} King Jegi Events &amp; Catering · Admin Panel
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
