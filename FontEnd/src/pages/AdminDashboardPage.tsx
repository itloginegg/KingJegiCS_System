import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate } from '../lib/format';
import type { ResStatus } from '../components/admin/shared/statusMeta';

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { LayoutGrid, CalendarDays, Wallet, Package, Star, Circle } from 'lucide-react';
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
  updateLineDeliveryStatus,
  BookingApiError,
  type OutstandingRentalLine,
  type DeliveryStatusName,
  type CashPaymentResult,
  type BookingTypeName,
  type BookingResponse,
  type BookingDetailResponse,
  type InvoiceResponseDto,
} from '../api/bookingApi';
import { API_BASE_URL } from '../api/bookingApi';
import { startLiveHub } from '../lib/liveHub';
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
import { AdminSidebar } from '../components/admin/shell/AdminSidebar';
import { AdminTopbar } from '../components/admin/shell/AdminTopbar';
import type { AdminTab as Tab, AdminNavItem } from '../components/admin/shell/types';
import '../components/admin/admin.css';
import type { BookingGroupKey, BookingRowActions } from '../components/admin/bookings/types';
import { CashPaymentModal } from '../components/admin/CashPaymentModal';
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
import { InvoiceModal, type InvoiceView } from '../components/admin/bookings/InvoiceModal';
import { BookingDetailModal } from '../components/admin/bookings/BookingDetailModal';
import { ContractModal } from '../components/admin/bookings/ContractModal';
import { DamageNoteModal } from '../components/admin/rentals/DamageNoteModal';
import { OverviewTab } from '../components/admin/overview/OverviewTab';
import { RentalsTab } from '../components/admin/rentals/RentalsTab';
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
  /* Set by openTab when it moves to the placeholder panel. 'placeholder' has no ?tab=
     spelling, so that URL write leaves no tab param, and the URL-sync effect below
     would read the bare URL as "Overview" and undo the click one render later. The
     effect consumes this once and keeps the in-memory tab instead. Only ever set when
     the write really changes the URL: otherwise the effect never runs to consume it,
     and a stale flag would swallow the next genuine navigation to a bare /admin. */
  const keepPlaceholderOnSync = useRef(false);

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
  const [invoiceView, setInvoiceView] = useState<InvoiceView | null>(null);

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
    const leavingHistories = t !== 'histories' && location.pathname === HISTORIES_PATH;
    keepPlaceholderOnSync.current =
      t === 'placeholder' && (leavingHistories || params.toString() !== searchParams.toString());
    if (leavingHistories) {
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
      await updateLineDeliveryStatus(session.token, line, next, note);

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
      source: 'Rental',
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

    return startLiveHub(conn, () => {
      notify('info', 'Live notifications are unavailable. Open the bell to refresh manually.');
    });
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
    const keepPlaceholder = keepPlaceholderOnSync.current && t === null;
    keepPlaceholderOnSync.current = false;
    if (!keepPlaceholder) setTab(isUrlTab(t) ? t : 'overview');

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
  const NAV: AdminNavItem[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={18} strokeWidth={1.75} /> },
    { id: 'bookings', label: 'Bookings', icon: <CalendarDays size={18} strokeWidth={1.75} />, badge: pendingRes.length },
    { id: 'payments', label: 'Payments', icon: <Wallet size={18} strokeWidth={1.75} />, badge: pendingPayments.length },
    { id: 'packages', label: 'Packages', icon: <Package size={18} strokeWidth={1.75} /> },
    { id: 'testimonials', label: 'Testimonials', icon: <Star size={18} strokeWidth={1.75} />, badge: pendingTesti },
  ];

  const isRouteActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <>
      {/* Only what must not outlive the dashboard stays inline; everything scoped to
          adm- lives in components/admin/admin.css. See that file's header for why
          these three are here. */}
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.45s ease both; }

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
      {invoiceView && (
        <InvoiceModal
          view={invoiceView}
          issuing={invoiceBusyId === invoiceView.booking.id}
          onClose={() => setInvoiceView(null)}
          onIssueInvoice={(b) => void generateMissingInvoice(b)}
        />
      )}

      {/* Top level, not inside the Rentals tab: the same modal is reachable from a
          booking's detail view, which renders over any tab. The damage note is required
          by the backend, so the confirm button stays disabled until there is one. */}
      {damageTarget && (
        <DamageNoteModal
          target={damageTarget}
          note={damageNote}
          onNoteChange={setDamageNote}
          onCancel={() => setDamageTarget(null)}
          onConfirm={() => void confirmDamage()}
        />
      )}

      {/* ══════════ BOOKING DETAIL VIEW (phase 4) ══════════
          Read-only. Everything the admin needs at a glance without leaving the
          Bookings tab; editing still happens through the existing actions. */}
      {detailBooking && (
        <BookingDetailModal
          detail={detailBooking}
          invoice={detailInvoice}
          busyLineId={returnsBusyId}
          onClose={() => { setDetailBooking(null); setDetailInvoice(null); }}
          onRentalAction={(r, next) => {
            // Same actions as the returns desk, through the same path and prompt.
            const line = detailLineToOutstanding(r);
            if (!line) return;
            if (next === 'Damaged') {
              setDamageNote('');
              setDamageTarget(line);
            } else {
              void applyDeliveryStatus(line, next);
            }
          }}
          onItemsChanged={async () => {
            // Refetch so the Items table and Money block reflect the server's
            // recomputed total rather than a local guess.
            await refreshBookingDetail(detailBooking.booking.id);
            await loadBookings();
          }}
          notify={notify}
        />
      )}

      {/* ══════════ CONTRACT (item 2) — printable service agreement ══════════ */}
      {contractBooking && (
        <ContractModal
          // Keyed so each booking's contract drafts its own terms on mount.
          key={contractBooking.booking.id}
          detail={contractBooking}
          invoice={contractInvoice}
          onClose={() => { setContractBooking(null); setContractInvoice(null); }}
        />
      )}

      <div className="adm-shell">

        {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
        <AdminSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          nav={NAV}
          tab={tab}
          placeholderName={placeholderName}
          placeholderItems={PLACEHOLDER_ITEMS}
          bookingsNav={{
            expanded: bookingsNavOpen,
            onToggleExpanded: () => {
              // Expand AND select, so one click always puts something on screen.
              // Collapsing while already on Bookings leaves the tab selected.
              if (tab === 'bookings') setBookingsNavOpen((o) => !o);
              else selectBookingStatus(lastBookingStatus.current);
            },
            value: resFilter,
            onSelect: selectBookingStatus,
            counts: resCounts,
            totalCount: reservations.length,
          }}
          onOpenTab={openTab}
          onOpenPlaceholder={(name) => { setPlaceholderName(name); openTab('placeholder'); }}
          historiesActive={isRouteActive('/admin/booking-histories')}
          isOwner={authUser?.adminRole === 'Owner'}
          onLogout={() => void logout()}
        />

        {/* ═══════════════════════ MAIN ═══════════════════════ */}
        <div className="adm-main">

          {/* topbar */}
          <AdminTopbar
            title={tab === 'placeholder' ? placeholderName : tab === 'menus' ? 'Menus & Dishes' : tab === 'services' ? 'Service Items' : tab === 'rentals' ? 'Rentals' : tab === 'audit' ? 'Audit Log' : tab === 'histories' ? 'Booking Histories' : tab === 'announcements' ? 'Announcements' : tab === 'staff' ? 'Staff Management' : NAV.find((n) => n.id === tab)?.label ?? ''}
            adminName={adminName}
            roleLabel={FALLBACK_ADMIN.role}
            onOpenNav={() => setSidebarOpen(true)}
            notifications={notifications}
            unreadCount={unreadCount}
            onRefreshNotifications={() => void loadNotifications()}
            onReadAll={() => void readAllNotifications()}
            onOpenNotification={openNotification}
          />

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
                    {placeholderName} isn't available yet.
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
