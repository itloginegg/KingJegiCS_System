import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useAuth } from '../hooks/useAuth';
import { HubConnectionBuilder } from '@microsoft/signalr';
import {
  LayoutDashboard, CalendarDays, CreditCard, Package,
  Utensils, Tent, CheckCircle, Clock, Calendar, ListTodo, LogOut,
  MapPin, Users, Landmark,
} from 'lucide-react';
import {
  getAllBookings,
  getInvoiceByBooking,
  getPaymentsByInvoice,
  cancelBooking as cancelBookingRequest,
  requestCancellation,
  requestRefund,
  BookingApiError,
  API_BASE_URL,
  type BookingResponse as BookingResponseDto,
  type InvoiceResponseDto,
  type PaymentRecord,
} from '../api/bookingApi';
import { startLiveHub } from '../lib/liveHub';
import { readSession } from '../lib/tokenStorage';
import { ToastViewport, useToasts } from '../components/ui/Toasts';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notificationTarget,
  type AppNotification,
} from '../api/notificationsApi';
import { OPEN_SUPPORT_CHAT_EVENT } from '../components/site/ChatWidget';
import {
  getMyTestimonials,
  submitTestimonial,
  TestimonialApiError,
  type Testimonial as MyTestimonial,
} from '../api/testimonialsApi';


import {
  DERIVED_STATUS,
  BOOKING_STATUS_ORDER,
  derivedStatusOf,
  bookingMeta,
  fmt,
  fmtDate,
  type BookingStatusKey,
  type DerivedBookingStatus,
} from '../components/customer/bookingStatus';

import {
  StatusBadge,
  FieldLabel,
  Pipeline,
  pipelineStep,
  BookingDetailModal,
  InvoiceModal,
  PaymentScheduleModal,
} from '../components/customer/DashboardModals';

type Tab = 'overview' | 'bookings' | 'payments';
const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { id: 'bookings', label: 'My Bookings', icon: <CalendarDays size={20} /> },
  { id: 'payments', label: 'Payments', icon: <CreditCard size={20} /> },
];

export function CustomerDashboardPage() {
  const { user: authUser, logout } = useAuth();
  const location = useLocation();

  /* the signed-in account; static persona only as a dev fallback */
  const account = {
    name: authUser?.name ?? 'Maria Santos',
    email: authUser?.email ?? 'maria.santos@example.com',
  };

  /* Opening tab may be chosen from outside — /payment/success routes here as
     ?tab=payments after a confirmed gateway payment. Anything unrecognised falls
     back to the normal overview landing. */
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return requested === 'payments' || requested === 'bookings' ? requested : 'overview';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { toasts, notify, dismiss } = useToasts();

  const [bookings, setBookings] = useState<BookingResponseDto[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponseDto[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* notifications — the in-app view of what the NotificationWorker emailed us */
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);

  const loadNotifications = useCallback(async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      const feed = await getNotifications(session.token);
      setNotifications(feed.items);
      setUnreadCount(feed.unreadCount);
    } catch {
      // A failed poll isn't worth a toast — the bell keeps its last known state.
    }
  }, []);

  const readNotification = async (n: AppNotification) => {
    if (n.readAt) return;
    const session = readSession();
    if (!session?.token) return;
    try {
      await markNotificationRead(session.token, n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* leave it unread; the next poll reconciles */
    }
  };

  const readAllNotifications = async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      await markAllNotificationsRead(session.token);
      const stamp = new Date().toISOString();
      setNotifications((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: stamp })));
      setUnreadCount(0);
    } catch {
      notify('error', 'Could not mark notifications read.');
    }
  };

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  /* testimonials — one review per Completed booking */
  const [myReviews, setMyReviews] = useState<MyTestimonial[]>([]);
  const [reviewBookingId, setReviewBookingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const loadMyReviews = useCallback(async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      setMyReviews(await getMyTestimonials(session.token));
    } catch {
      // Non-critical: without this the "Leave a review" button simply stays offered.
    }
  }, []);

  useEffect(() => { void loadMyReviews(); }, [loadMyReviews]);

  const sendReview = async () => {
    const session = readSession();
    if (!session?.token || !reviewBookingId) return;
    setReviewBusy(true);
    try {
      await submitTestimonial(session.token, {
        bookingId: reviewBookingId,
        rating: reviewRating,
        body: reviewBody.trim(),
      });
      setReviewBookingId(null);
      setReviewBody('');
      setReviewRating(5);
      await loadMyReviews();
      notify('success', 'Thank you! Your review is with our team for approval.');
    } catch (err) {
      notify('error', err instanceof TestimonialApiError ? err.message : 'Could not submit your review.');
    } finally {
      setReviewBusy(false);
    }
  };

  const fetchDashboard = useCallback(async () => {
    const session = readSession();
    if (!session) {
      setLoadError('You are signed out. Please sign in again to load your dashboard.');
      setIsFetching(false);
      return;
    }
    setLoadError(null);
    try {
      const bookingList = await getAllBookings(session.token);
      setBookings(bookingList);

      // Invoices don't exist until the caterer generates them — a missing one is normal.
      const invoiceList = (
        await Promise.all(
          bookingList.map((b) => getInvoiceByBooking(session.token, b.id).catch(() => null)),
        )
      ).filter((i): i is InvoiceResponseDto => i !== null);
      setInvoices(invoiceList);

      const paymentLists = await Promise.all(
        invoiceList.map((inv) => getPaymentsByInvoice(session.token, inv.id).catch(() => [] as PaymentRecord[])),
      );
      setPayments(paymentLists.flat());
    } catch (err) {
      setLoadError(
        err instanceof BookingApiError
          ? err.message
          : 'Something went wrong while loading your dashboard. Please try again.',
      );
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  /* Live refresh: the backend broadcasts "PaymentUpdated" on /hubs/payment
     whenever a payment lands, fails, or is confirmed. */
  useEffect(() => {
    const conn = new HubConnectionBuilder()
      .withUrl(`${API_BASE_URL}/hubs/payment`)
      .withAutomaticReconnect()
      .build();

    conn.on('PaymentUpdated', () => {
      void fetchDashboard();
    });

    /* Slice D: the notification worker pushes a nudge when it seeds an assistant
       conversation. Payload is opaque ids only — filter to this customer, toast,
       and badge the Messages tab (unless it's already open). */
    /* Live badge: fired whenever any notification is written. Payload-free by
       design — we refetch so the server re-applies its own ownership scoping. */
    conn.on('NotificationCreated', () => {
      void loadNotifications();
    });

    conn.on('AssistantNudge', (payload: { customerId?: string; conversationId?: string }) => {
      const myId = readSession()?.user.id;
      if (!myId || payload?.customerId !== myId) return;
      notify('info', 'Your assistant has a new message — open the chat bubble to see it.');
    });

    // A dead hub isn't fatal — the dashboard still loads on refresh — but a
    // console-only failure left customers waiting on payment updates that would
    // never arrive, with nothing on screen to say so.
    return startLiveHub(conn, () => {
      notify('info', 'Live payment updates are unavailable. Refresh the page to see the latest status.');
    });
  }, [fetchDashboard, notify, loadNotifications]);


  const [detailBooking, setDetailBooking] = useState<BookingResponseDto | null>(null);
    const [invoiceOrder, setInvoiceOrder] = useState<any>(null);
  const [paymentScheduleOrder, setPaymentScheduleOrder] = useState<any>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  /**
   * Clicking a notification marks it read AND takes you to what it's about. Declared
   * here rather than beside readNotification because it needs the navigation state
   * (detailBooking, expandedOrder) that's set up just above.
   *
   * Marking read is fire-and-forget: navigation shouldn't wait on it, and a failed
   * mark-read is reconciled by the next poll.
   */
  const openNotification = (n: AppNotification) => {
    void readNotification(n);
    setBellOpen(false);

    switch (notificationTarget(n)) {
      case 'booking': {
        setTab('bookings');
        // The booking is normally already loaded; if it isn't (a very old
        // notification, or one that arrived before the last fetch), land on the tab
        // rather than opening an empty modal.
        const booking = bookings.find((b) => b.id === n.bookingId);
        if (booking) setDetailBooking(booking);
        break;
      }
      case 'payment': {
        setTab('payments');
        // targetId is the PAYMENT; the Payments tab expands by INVOICE, so hop
        // through the payment to find which invoice card to open.
        const payment = n.targetId ? payments.find((p) => p.id === n.targetId) : null;
        if (payment) setExpandedOrder(payment.invoiceId);
        break;
      }
      case 'chat':
        // ChatWidget is mounted globally, outside this page's tree.
        window.dispatchEvent(new Event(OPEN_SUPPORT_CHAT_EVENT));
        break;
      case 'none':
      default:
        break;
    }
  };
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  /* Arriving from Plan-by-Budget's materialize: open the new Draft so the Submit
     Booking button is immediately in view. Fires once. */
  const pendingDraftHandled = useRef(false);
  useEffect(() => {
    if (pendingDraftHandled.current) return;
    const pendingId = (location.state as { pendingDraftId?: string } | null)?.pendingDraftId;
    if (!pendingId) return;
    const draft = bookings.find((b) => b.id === pendingId);
    if (draft) {
      pendingDraftHandled.current = true;
      setDetailBooking(draft);
      notify('info', 'Your plan has been saved as a Draft — review it and click Submit Booking to send it for review.');
    }
  }, [bookings, location.state, notify]);

  const [query, setQuery] = useState('');
  /* Narrowed from `string` to the derived keys: the old value space held things like
     'secured' that matched no booking, and TypeScript couldn't say so. */
  const [statusFilter, setStatusFilter] = useState<'all' | BookingStatusKey>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');

  /* Escape closes whichever layer is open */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDetailBooking(null);
      setInvoiceOrder(null);
      setConfirmCancel(null);
      setRefundTarget(null);
      setSidebarOpen(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* derived */
  const invoiceOf = (b: BookingResponseDto) => invoices.find((i) => i.bookingId === b.id);
  /* Thin alias over the module-level derivation — kept so the call sites below read
     the same as before. `invoiceOf` stays, but only for showing amounts paid; it no
     longer decides which label appears. */
  const deriveBookingStatus = (b: BookingResponseDto): DerivedBookingStatus => derivedStatusOf(b);

  const activeBookings = bookings.filter((b) => !b.status.toLowerCase().includes('cancel'));
  const confirmedCount = bookings.filter((b) => b.status.toLowerCase() === 'confirmed').length;



  const nextBooking = [...activeBookings]
    .filter((b) => new Date(b.eventDate || '') >= new Date())
    .sort((a, b) => +new Date(a.eventDate || '') - +new Date(b.eventDate || ''))[0];

  /**
   * One row per invoiced booking for the Payment Summary breakdown. Sourced from the
   * invoice (the authoritative money record), with the booking supplying only its
   * name. Ordered by outstanding amount so whatever needs paying first is on top.
   */
  const paymentBreakdown = useMemo(
    () =>
      invoices
        .map((inv) => {
          const booking = bookings.find((b) => b.id === inv.bookingId);
          const due = inv.grandTotal - inv.paidTotal;
          return {
            id: inv.id,
            name: booking ? bookingMeta(booking).label : 'Booking',
            total: inv.grandTotal,
            paid: inv.paidTotal,
            due,
            pct: inv.grandTotal > 0 ? Math.round((inv.paidTotal / inv.grandTotal) * 100) : 0,
          };
        })
        .sort((a, b) => b.due - a.due),
    [invoices, bookings],
  );

  const totalValue = invoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalPaid = invoices.reduce((s, i) => s + i.paidTotal, 0);
  const totalDue = totalValue - totalPaid;
  const paidPct = totalValue > 0 ? Math.round((totalPaid / totalValue) * 100) : 0;


  /* How many bookings sit under each derived status, for the filter's option labels.
     Counted over the unfiltered list so the numbers don't shift as you filter. */
  const statusCounts = useMemo(() => {
    const counts = {} as Record<BookingStatusKey, number>;
    for (const b of bookings) {
      const { key } = derivedStatusOf(b);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings
      // Matches on the DERIVED key, not the raw backend status. The old predicate
      // compared b.status ("Pending", "Confirmed") against filter values like
      // 'secured' and 'pending_fee' — a comparison that could never be true for any
      // option, so every choice but "All statuses" returned an empty list.
      .filter((b) => statusFilter === 'all' || derivedStatusOf(b).key === statusFilter)
      .filter((b) => {
        const meta = bookingMeta(b);
        return (
          q === '' ||
          b.id.toLowerCase().includes(q) ||
          meta.label.toLowerCase().includes(q) ||
          (b.venueAddress?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => {
        const d = +new Date(a.createdAt) - +new Date(b.createdAt);
        return sortBy === 'newest' ? -d : d;
      });
  }, [bookings, query, statusFilter, sortBy]);


  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [refundTarget, setRefundTarget] = useState<PaymentRecord | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

  /* Draft/Pending bookings cancel directly; a Confirmed booking files a
     cancellation request the owner reviews. */
  const cancelBooking = async (id: string) => {
    const session = readSession();
    if (!session) {
      notify('error', 'You are signed out. Please sign in again.');
      return;
    }
    const target = bookings.find((b) => b.id === id);
    const needsRequest = (target?.status ?? '').toLowerCase() === 'confirmed';
    setCancelBusy(true);
    try {
      if (needsRequest) {
        await requestCancellation(session.token, id, cancelReason.trim() || undefined);
        notify('success', 'Cancellation request sent — the caterer will review it shortly.');
      } else {
        await cancelBookingRequest(session.token, id);
        notify('success', 'Your booking has been cancelled.');
      }
      setConfirmCancel(null);
      setCancelReason('');
      await fetchDashboard();
    } catch (err) {
      notify(
        'error',
        err instanceof BookingApiError ? err.message : 'Could not cancel this booking. Please try again.',
      );
    } finally {
      setCancelBusy(false);
    }
  };

  const submitRefundRequest = async () => {
    if (!refundTarget) return;
    const session = readSession();
    if (!session) {
      notify('error', 'You are signed out. Please sign in again.');
      return;
    }
    setRefundBusy(true);
    try {
      await requestRefund(session.token, refundTarget.id, { reason: refundReason.trim() || undefined });
      notify('success', 'Refund request sent — the caterer will review it shortly.');
      setRefundTarget(null);
      setRefundReason('');
      await fetchDashboard();
    } catch (err) {
      notify(
        'error',
        err instanceof BookingApiError ? err.message : 'Could not send the refund request. Please try again.',
      );
    } finally {
      setRefundBusy(false);
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };


  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .fade-up { animation: fadeUp 0.5s ease both; }

        /* ── shell ── */
        .cds-shell { min-height: 100vh; background: var(--bg-subtle); transition: background 0.4s; }
        .cds-main { margin-left: 250px; min-height: 100vh; display: flex; flex-direction: column; }

        /* ── sidebar ── */
        .cds-sidebar {
          position: fixed; top: 0; left: 0; z-index: 60;
          width: 250px; height: 100vh;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex; flex-direction: column;
          transition: transform 0.3s ease;
        }
        .cds-brand {
          padding: 1.5rem 1.4rem 1.2rem;
          border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 0.65rem;
        }
        .cds-brand-mark {
          width: 34px; height: 34px; flex-shrink: 0;
          border-radius: var(--r-lg);
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 1.05rem; font-weight: 600;
          color: var(--primary);
        }
        .cds-nav { flex: 1; padding: 1rem 0.8rem; display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; }
        .cds-nav-caption {
          padding: 0.4rem 0.9rem 0.3rem;
          font-family: var(--font-body); font-size: 0.5rem;
          letter-spacing: 0.3em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .cds-nav-item {
          display: flex; align-items: center; gap: 0.7rem;
          width: 100%; text-align: left;
          padding: 0.68rem 0.9rem;
          border: 1px solid transparent; border-radius: var(--r-lg);
          background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.7rem;
          letter-spacing: 0.1em; text-transform: uppercase; font-weight: 500;
          color: var(--text-muted);
          text-decoration: none;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .cds-nav-item:hover:not(.active) { background: var(--bg-subtle); color: var(--text-primary); }
        .cds-nav-item.active {
          background: var(--primary-muted);
          border-color: var(--border-accent);
          color: var(--primary);
        }
        .cds-nav-icon {
          width: 28px; height: 28px; flex-shrink: 0;
          border-radius: var(--r-sm);
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem;
        }
        .cds-nav-item.active .cds-nav-icon { background: var(--primary-muted); border-color: var(--border-accent); }
        .cds-sidebar-foot { padding: 0.9rem 0.8rem; border-top: 1px solid var(--border); }
        .cds-userchip {
          display: flex; align-items: center; gap: 0.6rem;
          padding: 0.7rem 0.8rem; margin-bottom: 0.5rem;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
        }
        .cds-avatar {
          width: 32px; height: 32px; flex-shrink: 0;
          border-radius: 50%;
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 0.8rem; font-weight: 600;
          color: var(--primary);
        }

        .cds-scrim {
          position: fixed; inset: 0; z-index: 55;
          background: rgba(20, 14, 8, 0.45);
          display: none;
        }

        /* ── topbar ── */
        .cds-topbar {
          position: sticky; top: 0; z-index: 40;
          display: flex; align-items: center; gap: 0.9rem;
          padding: 0.9rem 2rem;
          background: color-mix(in srgb, var(--bg-subtle) 84%, transparent);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .cds-iconbtn {
          width: 36px; height: 36px; flex-shrink: 0;
          border-radius: var(--r-full);
          border: 1px solid var(--border);
          background: var(--surface); color: var(--text-secondary);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .cds-iconbtn:hover { color: var(--primary); border-color: var(--border-accent); }
        .cds-burger { display: none; }

        /* ── cards ── */
        .cds-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .cds-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-md); }

        .cds-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
        @media (max-width: 1100px) { .cds-stats { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 640px)  { .cds-stats { grid-template-columns: 1fr; } }

        .cds-stat { padding: 1.4rem 1.6rem; display: flex; flex-direction: column; gap: 0.9rem; }
        .cds-stat-top { display: flex; align-items: center; justify-content: space-between; }
        .cds-stat-icon {
          width: 38px; height: 38px; border-radius: var(--r-lg);
          display: flex; align-items: center; justify-content: center; font-size: 0.95rem;
          background: var(--primary-muted); border: 1px solid var(--border-accent);
        }
        .cds-stat-label {
          font-family: var(--font-body); font-size: 0.52rem;
          letter-spacing: 0.26em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .cds-stat-num { font-family: var(--font-display); font-size: 2.4rem; font-weight: 600; line-height: 1; }

        .cds-value { font-family: var(--font-body); font-size: 0.84rem; font-weight: 500; color: var(--text-primary); }
        .cds-tag {
          font-family: var(--font-body); font-size: 0.66rem; font-weight: 500;
          color: var(--primary);
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          padding: 0.2rem 0.6rem; border-radius: var(--r-full);
        }

        /* upcoming */
        .cds-upcoming { display: flex; align-items: stretch; overflow: hidden; }
        .cds-datebox {
          width: 92px; flex-shrink: 0;
          background: var(--primary);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 0.15rem; padding: 1.4rem 0;
        }
        @media (max-width: 700px) { .cds-upcoming { flex-direction: column; } .cds-datebox { width: 100%; flex-direction: row; gap: 0.6rem; padding: 0.8rem 0; } }

        /* pipeline */
        .cds-pipeline {
          display: flex;
          padding: 1.1rem 1.6rem;
          border-top: 1px solid var(--border);
          background: var(--bg-subtle);
        }
        .cds-pipeline-step {
          flex: 1; position: relative;
          display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
        }
        .cds-pipeline-step .dot { width: 11px; height: 11px; border-radius: 50%; z-index: 1; }
        .cds-pipeline-step .bar {
          position: absolute; top: 5px; right: 50%;
          width: 100%; height: 2px;
        }
        .cds-pipeline-step span {
          font-family: var(--font-body); font-size: 0.54rem;
          letter-spacing: 0.12em; text-transform: uppercase; text-align: center;
        }

        /* rows */
        .cds-row {
          display: flex; align-items: center; gap: 1rem;
          padding: 0.9rem 0;
          border-bottom: 1px solid var(--border);
        }
        .cds-row:last-child { border-bottom: none; }
        .cds-glyph {
          width: 38px; height: 38px; flex-shrink: 0;
          border-radius: var(--r-lg);
          background: var(--primary-muted); border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 1rem; font-weight: 600;
          color: var(--primary);
        }

        /* progress bar */
        .cds-bar { height: 7px; border-radius: var(--r-full); background: var(--border); overflow: hidden; }
        .cds-bar > div { height: 100%; border-radius: var(--r-full); background: var(--primary); transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1); }

        /* buttons */
        .cds-btn {
          font-family: var(--font-body); font-size: 0.62rem;
          letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500;
          padding: 0.62rem 1.15rem; border-radius: var(--r-full);
          cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; gap: 0.4rem;
          border: 1px solid transparent; text-decoration: none;
          transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s;
        }
        .cds-btn.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
        .cds-btn.primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
        .cds-btn.outline { background: transparent; color: var(--primary); border-color: var(--border-accent); }
        .cds-btn.outline:hover { background: var(--primary-muted); border-color: var(--primary); }
        .cds-btn.soft { background: var(--bg-subtle); color: var(--text-muted); border-color: var(--border); }
        .cds-btn.soft:hover { color: var(--primary); border-color: var(--border-accent); }
        .cds-btn.dangerghost { background: transparent; color: var(--text-muted); border-color: var(--border); }
        .cds-btn.dangerghost:hover { background: var(--danger-muted); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
        /* Disabled has to look it: a full-strength button that ignores the click reads as broken. */
        .cds-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        .cds-btn.primary:disabled:hover { background: var(--primary); transform: none; }
        .cds-btn.outline:disabled:hover { background: transparent; border-color: var(--border-accent); }

        /* inputs */
        .cds-input {
          background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--r-full);
          padding: 0.6rem 1.1rem;
          font-family: var(--font-body); font-size: 0.8rem; font-weight: 300;
          color: var(--text-primary); outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .cds-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
        select.cds-input { cursor: pointer; font-weight: 400; }

        /* table */
        .cds-table { width: 100%; border-collapse: collapse; }
        .cds-table th {
          font-family: var(--font-body); font-size: 0.54rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim); text-align: left;
          padding: 0.6rem 0.4rem; border-bottom: 1px solid var(--border);
        }
        .cds-table td {
          font-family: var(--font-body); font-size: 0.8rem;
          color: var(--text-primary);
          padding: 0.65rem 0.4rem; border-bottom: 1px solid var(--border);
        }

        /* modal */
        .cds-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(20, 14, 8, 0.55);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          padding: 1.5rem;
          animation: fadeUp 0.2s ease both;
        }
        .cds-modal {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--r-xl); width: 100%; max-height: 90vh;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: var(--shadow-lg);
          animation: scaleIn 0.25s ease both;
          position: relative;
        }
        .cds-modal-head {
          padding: 1.5rem 1.75rem 1.15rem;
          border-bottom: 1px solid var(--border);
          background: linear-gradient(180deg, var(--accent-muted) 0%, var(--surface) 100%);
          display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
        }
        .cds-modal-body { padding: 1.5rem 1.75rem; display: flex; flex-direction: column; gap: 1.2rem; overflow-y: auto; }
        .cds-modal-close {
          width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
          border: 1px solid var(--border);
          background: var(--surface); color: var(--text-muted);
          cursor: pointer; font-size: 0.85rem;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s, color 0.2s;
        }
        .cds-modal-close:hover { background: var(--bg-subtle); color: var(--text-primary); }

        /* messages */
        .cds-bubble {
          max-width: 70%;
          padding: 0.8rem 1rem;
          border-radius: var(--r-xl);
          font-family: var(--font-body); font-size: 0.82rem; font-weight: 300;
          line-height: 1.6;
        }
        .cds-bubble.admin {
          align-self: flex-start;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          color: var(--text-primary);
          border-bottom-left-radius: var(--r-sm);
        }
        .cds-bubble.me {
          align-self: flex-end;
          background: var(--primary);
          color: var(--primary-text);
          border-bottom-right-radius: var(--r-sm);
        }

        /* responsive */
        @media (max-width: 900px) {
          .cds-main { margin-left: 0; }
          .cds-sidebar { transform: translateX(-100%); }
          .cds-sidebar.open { transform: translateX(0); box-shadow: var(--shadow-lg); }
          .cds-scrim.open { display: block; }
          .cds-burger { display: flex; }
          .cds-topbar { padding: 0.8rem 1.25rem; }
          .cds-content { padding: 1.5rem 1.25rem 4rem !important; }
        }

        @media print {
          body * { visibility: hidden; }
          #cds-invoice, #cds-invoice * { visibility: visible; }
          #cds-invoice { position: fixed; inset: 0; max-height: none; border: none; box-shadow: none; }
        }
      `}</style>

      <div className="cds-shell">

        {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
        <div className={`cds-scrim${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
        <aside className={`cds-sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="cds-brand">
            <div className="cds-brand-mark">K</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                King Jegi
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
                Customer Portal
              </div>
            </div>
          </div>

          <nav className="cds-nav" aria-label="Dashboard navigation">
            <span className="cds-nav-caption">Account</span>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`cds-nav-item${tab === item.id ? ' active' : ''}`}
                onClick={() => switchTab(item.id)}
              >
                <span className="cds-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}

            <span className="cds-nav-caption" style={{ marginTop: '0.9rem' }}>Explore</span>
            <Link to="/packages" className="cds-nav-item"><span className="cds-nav-icon"><Package size={20} /></span>Packages</Link>
            <Link to="/menus" className="cds-nav-item"><span className="cds-nav-icon"><Utensils size={20} /></span>Menus</Link>
            <Link to="/rentals" className="cds-nav-item"><span className="cds-nav-icon"><Tent size={20} /></span>Rentals</Link>
          </nav>

          <div className="cds-sidebar-foot">
            <div className="cds-userchip">
              <div className="cds-avatar">{account.name.charAt(0)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {account.name}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 300, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {account.email}
                </div>
              </div>
            </div>
            <Link to="/" className="cds-nav-item">
              <span className="cds-nav-icon"><LogOut size={20} style={{ transform: 'rotate(180deg)' }} /></span>
              Back to Site
            </Link>
            <button type="button" className="cds-nav-item" onClick={() => void logout()}>
              <span className="cds-nav-icon"><LogOut size={20} /></span>
              Sign Out
            </button>
          </div>
        </aside>

        {/* ═══════════════════════ MAIN ═══════════════════════ */}
        <div className="cds-main">

          {/* topbar */}
          <div className="cds-topbar">
            <button type="button" className="cds-iconbtn cds-burger" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="17" height="17" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--text-dim)' }}>
              {NAV_ITEMS.find((n) => n.id === tab)?.label}
            </span>
            <div style={{ flex: 1 }} />

            {/* notification bell — /api/Notifications, scoped to this customer's bookings */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="cds-iconbtn"
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                aria-expanded={bellOpen}
                onClick={() => { setBellOpen((o) => !o); if (!bellOpen) void loadNotifications(); }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                  <div style={{ position: 'fixed', inset: 0, zIndex: 110 }} onClick={() => setBellOpen(false)} />
                  <div
                    className="cds-card"
                    style={{
                      position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0, zIndex: 111,
                      width: 340, maxWidth: '90vw', maxHeight: 420, overflowY: 'auto',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-dim)' }}>
                        Notifications
                      </span>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={() => void readAllNotifications()}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--primary)' }}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    {notifications.length === 0 ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', padding: '1.6rem 1rem', textAlign: 'center', margin: 0 }}>
                        Nothing yet. Booking confirmations and payment reminders show up here.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => openNotification(n)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', border: 'none',
                            // Read rows are still clickable now that clicking navigates —
                            // only rows with nowhere to go show the default cursor.
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
                            {new Date(n.sentAt).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <ThemeToggle className="cds-iconbtn" style={{ color: 'var(--accent)' }} />
            <div className="cds-avatar" title={account.name}>{account.name.charAt(0)}</div>
          </div>

          {/* content */}
          <div className="cds-content" style={{ padding: '2.25rem 2.5rem 4.5rem', flex: 1 }}>

            {/* header */}
            <div className="fade-up" style={{ marginBottom: '2rem' }}>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem, 3vw, 2.4rem)', fontWeight: 400, lineHeight: 1.15, color: 'var(--text-primary)' }}>
                Welcome back,{' '}
                <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{account.name.split(' ')[0]}</em>
              </h1>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.86rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Here's where your celebrations stand today.
              </p>
            </div>

            {/* ══════════ OVERVIEW ══════════ */}
            {loadError && !isFetching && (
              <div
                className="cds-card"
                style={{
                  padding: '1rem 1.3rem', marginBottom: '1.25rem',
                  borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)',
                  display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap',
                }}
                role="alert"
              >
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--danger)', flex: 1, minWidth: 200 }}>
                  {loadError}
                </span>
                <button type="button" className="cds-btn outline" onClick={() => { setIsFetching(true); void fetchDashboard(); }}>
                  Try Again
                </button>
              </div>
            )}

            {tab === 'overview' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                {/* stats */}
                <div className="cds-stats">
                  <div className="cds-card cds-stat">
                    <div className="cds-stat-top">
                      <span className="cds-stat-icon"><Calendar size={18} /></span>
                      <span className="cds-stat-label">Total Events</span>
                    </div>
                    <div>
                      <div className="cds-stat-num" style={{ color: 'var(--text-primary)' }}>{bookings.length}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>All-time bookings</div>
                    </div>
                  </div>
                  <div className="cds-card cds-stat">
                    <div className="cds-stat-top">
                      <span className="cds-stat-icon" style={{ background: 'var(--primary-muted)', color: 'var(--primary)' }}><CheckCircle size={18} /></span>
                      <span className="cds-stat-label" style={{ color: 'var(--primary)' }}>Secured Bookings</span>
                    </div>
                    <div>
                      <div className="cds-stat-num" style={{ color: 'var(--primary)' }}>{confirmedCount}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>Confirmed and reserved</div>
                    </div>
                  </div>
                  <div className="cds-card cds-stat">
                    <div className="cds-stat-top">
                      <span className="cds-stat-icon" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}><Clock size={18} /></span>
                      <span className="cds-stat-label" style={{ color: 'var(--accent)' }}>Outstanding Balance</span>
                    </div>
                    <div>
                      <div className="cds-stat-num" style={{ color: 'var(--accent)' }}>{fmt(invoices.reduce((sum, inv) => sum + (inv.grandTotal - inv.paidTotal), 0))}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>Total unpaid fees across all events</div>
                    </div>
                  </div>
                </div>

                {/* next event */}
                {nextBooking && (
                  <div className="cds-card cds-upcoming">
                    <div className="cds-datebox">
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
                        {new Date(nextBooking.eventDate || '').toLocaleDateString('en-PH', { month: 'short' }).toUpperCase()}
                      </span>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', fontWeight: 600, color: 'var(--primary-text)', lineHeight: 1 }}>
                        {new Date(nextBooking.eventDate || '').getDate()}
                      </span>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.6)' }}>
                        {new Date(nextBooking.eventDate || '').getFullYear()}
                      </span>
                    </div>
                    <div style={{ flex: 1, padding: '1.4rem 1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.5rem' }}>
                      <div><StatusBadge label={deriveBookingStatus(nextBooking).label} color={deriveBookingStatus(nextBooking).color} /></div>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0, lineHeight: 1.15 }}>
                        {bookingMeta(nextBooking).label}
                      </h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.4rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><MapPin size={12} /> {nextBooking.venueAddress}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Users size={12} /> {nextBooking.guestCount} guests</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><ListTodo size={12} /> {nextBooking.bookingName}</span>
                      </div>
                    </div>
                    <div style={{ padding: '1.4rem', display: 'flex', alignItems: 'center', borderLeft: '1px solid var(--border)' }}>

                      <button type="button" className="cds-btn primary" onClick={() => setDetailBooking(nextBooking)}>
                        View Details →
                      </button>
                    </div>
                  </div>
                )}

                {/* balance + recent, two columns on wide screens */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 5fr) minmax(320px, 7fr)', gap: '1.5rem' }} className="cds-overview-cols">
                  <style>{`@media (max-width: 1100px) { .cds-overview-cols { grid-template-columns: 1fr !important; } }`}</style>

                  {/* balance */}
                  <div className="cds-card" style={{ padding: '1.6rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    <div>
                      <FieldLabel text="Payment Summary" />
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                        Outstanding Balance
                      </h3>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 600, lineHeight: 1, color: totalDue > 0 ? 'var(--danger)' : 'var(--primary)' }}>
                      {fmt(totalDue)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-body)', fontSize: '0.64rem' }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{fmt(totalPaid)} paid</span>
                        <span style={{ color: 'var(--text-dim)', fontWeight: 300 }}>{paidPct}% complete</span>
                      </div>
                      <div className="cds-bar"><div style={{ width: `${paidPct}%` }} /></div>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                        Total contract value: {fmt(totalValue)}
                      </span>
                    </div>

                    {/* Per-booking breakdown. The totals above answer "how much do I owe
                        overall"; this answers "which event is that on", which the summary
                        alone couldn't. Only invoiced bookings appear — a booking with no
                        invoice yet has nothing to owe. */}
                    {paymentBreakdown.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                        <FieldLabel text="By Booking" />
                        {paymentBreakdown.map((row) => (
                          <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem' }}>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {row.name}
                              </span>
                              <span style={{ color: 'var(--text-dim)', fontWeight: 300, whiteSpace: 'nowrap' }}>
                                {row.pct}%
                              </span>
                            </div>
                            <div className="cds-bar"><div style={{ width: `${row.pct}%` }} /></div>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                              {fmt(row.paid)} paid of {fmt(row.total)}
                              {row.due > 0 && <> · <span style={{ color: 'var(--danger)' }}>{fmt(row.due)} due</span></>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button type="button" className="cds-btn outline" style={{ alignSelf: 'flex-start' }} onClick={() => setTab('payments')}>
                      Go to Payments →
                    </button>
                  </div>

                  {/* recent bookings */}
                  <div className="cds-card" style={{ padding: '1.6rem 1.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                      <div>
                        <FieldLabel text="Activity" />
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                          Recent Bookings
                        </h3>
                      </div>
                      <button type="button" className="cds-btn soft" onClick={() => setTab('bookings')}>View All &rarr;</button>
                    </div>
                    {bookings.slice(0, 4).map((b) => (
                      <div key={b.id} className="cds-row">
                        <div className="cds-glyph">{bookingMeta(b).icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {bookingMeta(b).label}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                            {fmtDate(b.eventDate || '')} · {b.guestCount} guests
                          </div>
                        </div>
                        <StatusBadge label={deriveBookingStatus(b).label} color={deriveBookingStatus(b).color} />
                        <button
                          type="button"
                          className="cds-iconbtn"
                          style={{ width: 30, height: 30 }}
                          aria-label={`View ${b.id}`}
                          onClick={() => setDetailBooking(b)}
                        >
                          →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            )}

            {/* ══════════ BOOKINGS ══════════ */}
            {tab === 'bookings' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                {/* controls */}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    className="cds-input"
                    style={{ flex: '1 1 220px', maxWidth: 320 }}
                    type="search"
                    placeholder="Search event, ID, or location…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search bookings"
                  />
                  <div style={{ flex: 1 }} />
                  {/* Options come from the same key list the labels do, so the dropdown
                      can't drift out of step with what a booking can actually be.
                      Counts are shown because an option that yields nothing is exactly
                      the confusion this replaced. */}
                  <select className="cds-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
                    <option value="all">All statuses ({bookings.length})</option>
                    {BOOKING_STATUS_ORDER.map((key) => (
                      <option key={key} value={key}>
                        {DERIVED_STATUS[key].label} ({statusCounts[key] ?? 0})
                      </option>
                    ))}
                  </select>
                  <select className="cds-input" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Sort bookings">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </div>

                {filteredBookings.length === 0 ? (
                  <div className="cds-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', color: 'var(--accent)', marginBottom: '0.75rem' }}>✦</div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                      No bookings <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>found</em>
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 300, color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                      Try adjusting your search or filters.
                    </p>
                    <button type="button" className="cds-btn outline" onClick={() => { setQuery(''); setStatusFilter('all'); }}>
                      Reset Filters
                    </button>
                  </div>
                ) : (
                  isFetching ? (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)' }}>Loading bookings...</div>
  ) : filteredBookings.map((b) => {
                    const order = invoiceOf(b);
                    const meta = bookingMeta(b);
                    const st = deriveBookingStatus(b);
                    const rawStatus = b.status.toLowerCase();
                    const cancellable = rawStatus === 'draft' || rawStatus === 'pending';
                    const canRequestCancel = rawStatus === 'confirmed' && !b.cancellationRequested;
                    return (
                      <div key={b.id} className="cds-card" style={{ overflow: 'hidden' }}>

                        <div style={{ padding: '1.4rem 1.6rem', display: 'flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap' }}>
                          <div className="cds-glyph" style={{ width: 46, height: 46 }}>{meta.icon}</div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                              {meta.label}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1.25rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                              <span>#{b.id}</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><CalendarDays size={12} /> {b.eventDate ? (b.eventDate ? fmtDate(b.eventDate) : 'TBD') : 'TBD'}</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Users size={12} /> {b.guestCount} guests</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><MapPin size={12} /> {b.venueAddress}</span>
                              {order && <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Landmark size={12} /> {fmt(order.grandTotal)}</span>}
                            </div>
                          </div>
                          <StatusBadge label={st.label} color={st.color} />
                        </div>

                        <Pipeline current={pipelineStep(b)} cancelled={b.status === 'cancelled'} />

                        <div style={{ borderTop: '1px solid var(--border)', padding: '1.1rem 1.6rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.9rem' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {/* Removed static services tag map */}
                          </div>
                          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                            {b.cancellationRequested && (
                              <StatusBadge label="Cancellation Requested" color="var(--warning-ink)" />
                            )}
                            {cancellable && (
                              <button type="button" className="cds-btn dangerghost" onClick={() => setConfirmCancel(b.id)}>
                                Cancel
                              </button>
                            )}
                            {canRequestCancel && (
                              <button type="button" className="cds-btn dangerghost" onClick={() => setConfirmCancel(b.id)}>
                                Request Cancellation
                              </button>
                            )}
                            
                            {/* Reviews are tied to a real completed booking — that pairing
                                is what keeps the public testimonials trustworthy. One per
                                booking, so the button disappears once it's been used. */}
                            {rawStatus === 'completed' && !myReviews.some((r) => r.bookingId === b.id) && (
                              <button type="button" className="cds-btn outline" onClick={() => { setReviewBookingId(b.id); setReviewBody(''); setReviewRating(5); }}>
                                Leave a Review
                              </button>
                            )}
                            {myReviews.some((r) => r.bookingId === b.id) && (
                              <StatusBadge
                                label={`Review ${(myReviews.find((r) => r.bookingId === b.id)!.status).toLowerCase()}`}
                                color={myReviews.find((r) => r.bookingId === b.id)!.status === 'Approved' ? 'var(--status-paid)' : 'var(--warning-ink)'}
                              />
                            )}

                            <button type="button" className="cds-btn outline" onClick={() => setDetailBooking(b)}>
                              Details
                            </button>

                          </div>
                        </div>

                        {reviewBookingId === b.id && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '1.1rem 1.6rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-muted)' }}>Your rating</span>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                                  onClick={() => setReviewRating(n)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontSize: '1.1rem', lineHeight: 1, color: n <= reviewRating ? 'var(--accent)' : 'var(--border-strong)' }}
                                >
                                  ★
                                </button>
                              ))}
                            </div>
                            <textarea
                              className="cds-input"
                              rows={3}
                              value={reviewBody}
                              onChange={(e) => setReviewBody(e.target.value)}
                              placeholder="How did we do? Your review is published only after our team approves it."
                              maxLength={2000}
                            />
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <button type="button" className="cds-btn primary" disabled={reviewBusy || !reviewBody.trim()} onClick={() => void sendReview()}>
                                {reviewBusy ? 'Sending…' : 'Submit Review'}
                              </button>
                              <button type="button" className="cds-btn outline" onClick={() => setReviewBookingId(null)}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ PAYMENTS ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */}
            {tab === 'payments' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {isFetching ? (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)' }}>Loading payments...</div>
  ) : invoices.map((inv) => {
    const b = bookings.find(bk => bk.id === inv.bookingId);
    if (!b) return null;
    const o = inv;
  
                  const stColor = inv.status === 'Paid' ? 'var(--status-paid)' : 'var(--status-unpaid)';
                    const st = { label: inv.status, color: stColor };
                  const total = inv.grandTotal;
                  const paid = inv.paidTotal;
                  const remaining = total - paid;
                  const open = expandedOrder === o.id;
                  return (

                    <div key={o.id} className="cds-card" style={{ overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedOrder(open ? null : o.id)}
                        style={{
                          all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%',
                          padding: '1.35rem 1.6rem',
                          display: 'flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap',
                        }}
                        aria-expanded={open}
                      >
                        <div
                          className="cds-glyph"
                          style={{
                            background: `color-mix(in srgb, ${st.color} 12%, transparent)`,
                            borderColor: `color-mix(in srgb, ${st.color} 30%, transparent)`,
                            color: st.color,
                          }}
                        >
                          ₱
                        </div>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                            {b?.bookingName || 'Event'}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                            #{o.id} · {o.issueDate}
                          </div>
                        </div>
                        <StatusBadge label={st.label} color={st.color} />

                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(total)}</span>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>▼</span>
                      </button>

                      {open && (
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ padding: '1.1rem 1.6rem' }}>
                              <FieldLabel text="Total" />
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(total)}</span>
                            </div>
                            <div style={{ padding: '1.1rem 1.6rem' }}>
                              <FieldLabel text="Paid" />
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(paid)}</span>
                            </div>
                            <div style={{ padding: '1.1rem 1.6rem' }}>
                              <FieldLabel text="Remaining" />
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: remaining > 0 ? 'var(--danger)' : 'var(--primary)' }}>
                                {fmt(remaining)}
                              </span>
                            </div>
                          </div>
                          <div style={{ padding: '1.1rem 1.6rem' }}>
                            <FieldLabel text="Order Items" />
                            {/* Items map removed */}
                          </div>
                          <div style={{ padding: '0 1.6rem 1.35rem', display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                            {remaining > 0 && (
                              <button type="button" className="cds-btn primary" onClick={() => setPaymentScheduleOrder(b)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><CreditCard size={14} /> Settle Balance</button>
                            )}
                            <button type="button" className="cds-btn outline" onClick={() => setInvoiceOrder(o)}>View Invoice</button>
                          </div>

                        </div>
                      )}
                    </div>
                  );
                })}

                {/* transactions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.75rem' }}>
                  <div style={{ width: 26, height: 1, background: 'var(--border-accent)' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.56rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 500 }}>
                    Transaction History
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div className="cds-card" style={{ overflow: 'hidden', overflowX: 'auto' }}>
                  <table className="cds-table" style={{ minWidth: 680 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-subtle)' }}>
                        <th style={{ padding: '0.8rem 1.4rem' }}>Event / Invoice</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {payments.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: '1.6rem 1.4rem', textAlign: 'center', color: 'var(--text-dim)', fontWeight: 300 }}>
                            No payments recorded yet.
                          </td>
                        </tr>
                      ) : (
                        [...payments]
                          .sort((a, z) => +new Date(z.paymentDateTime) - +new Date(a.paymentDateTime))
                          .map((p) => {
                            const inv = invoices.find((i) => i.id === p.invoiceId);
                            const bk = inv ? bookings.find((x) => x.id === inv.bookingId) : undefined;
                            const stColor =
                              p.status === 'Success' ? 'var(--status-paid)'
                              : p.status === 'Failed' ? 'var(--danger-ink)'
                              : p.status === 'Pending' ? 'var(--warning-ink)'
                              : 'var(--status-refund)';
                            // A completed event has already been delivered, so its
                            // payments are no longer refundable — asking would be a
                            // dispute, not a refund request.
                            const bookingCompleted = bk?.status?.toLowerCase() === 'completed';
                            const refundable =
                              (p.status === 'Success' || p.status === 'PartiallyRefunded') &&
                              p.refundableRemaining > 0 && !p.refundRequested && !bookingCompleted;
                            return (
                              <tr key={p.id}>
                                <td style={{ padding: '0.8rem 1.4rem' }}>
                                  <div style={{ fontWeight: 500 }}>{bk?.bookingName ?? 'Event'}</div>
                                  <div style={{ fontSize: '0.64rem', color: 'var(--text-dim)', marginTop: '0.12rem', fontWeight: 300 }}>
                                    #{p.id.substring(0, 8)}{p.transactionReference ? ` · ${p.transactionReference}` : ''}
                                  </div>
                                </td>
                                <td style={{ color: 'var(--text-muted)' }}>{fmtDate(p.paymentDateTime)}</td>
                                <td style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--primary)', fontSize: '0.95rem' }}>{fmt(p.amountPaid)}</td>
                                <td style={{ color: 'var(--text-muted)' }}>{p.method}</td>
                                <td>
                                  <StatusBadge
                                    label={p.refundRequested ? 'Refund Requested' : p.status}
                                    color={p.refundRequested ? 'var(--status-refund)' : stColor}
                                  />
                                </td>
                                <td style={{ paddingRight: '1.4rem', textAlign: 'right' }}>
                                  {refundable && (
                                    <button type="button" className="cds-btn outline" onClick={() => setRefundTarget(p)}>
                                      Request Refund
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>

          {/* footer */}
          <footer style={{ borderTop: '1px solid var(--border)', padding: '2rem 2.5rem', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              © {new Date().getFullYear()} King Jegi Party Need and Catering Services · Calamba, Laguna
            </p>
          </footer>
        </div>
      </div>

      {/* modals */}
      {detailBooking && (
        <BookingDetailModal
          booking={detailBooking}
          onClose={() => setDetailBooking(null)}
          statusBadge={deriveBookingStatus(detailBooking)}
          notify={notify}
          onSubmitted={() => { setDetailBooking(null); void fetchDashboard(); }}
        />
      )}
      {paymentScheduleOrder && <PaymentScheduleModal order={paymentScheduleOrder} invoice={invoiceOf(paymentScheduleOrder)} onClose={() => setPaymentScheduleOrder(null)} />}
      {invoiceOrder && <InvoiceModal order={invoiceOrder} customer={account} onClose={() => setInvoiceOrder(null)} />}

      {/* cancel confirmation */}

      {confirmCancel && (() => {
        const target = bookings.find((b) => b.id === confirmCancel);
        const needsRequest = (target?.status ?? '').toLowerCase() === 'confirmed';
        return (
          <div className="cds-overlay" onClick={() => setConfirmCancel(null)}>
            <div className="cds-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label="Confirm cancellation">
              <div className="cds-modal-body" style={{ textAlign: 'center', gap: '0.9rem', padding: '2rem 1.75rem' }}>
                <div style={{ fontSize: '1.6rem' }}>⚠️</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                  {needsRequest ? 'Request cancellation?' : `Cancel booking #${confirmCancel.substring(0, 8)}?`}
                </h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                  {needsRequest
                    ? 'This booking is already confirmed, so the caterer must review your cancellation. The reservation fee is non-refundable.'
                    : "This releases your reserved date. You can always book again, but availability isn't guaranteed."}
                </p>
                {needsRequest && (
                  <input
                    className="cds-input"
                    style={{ width: '100%' }}
                    placeholder="Reason (optional)"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    aria-label="Cancellation reason"
                  />
                )}
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', marginTop: '0.4rem' }}>
                  <button type="button" className="cds-btn soft" onClick={() => setConfirmCancel(null)}>Keep Booking</button>
                  <button
                    type="button"
                    className="cds-btn"
                    disabled={cancelBusy}
                    style={{ background: 'var(--danger)', color: 'var(--danger-text)', borderColor: 'var(--danger)', opacity: cancelBusy ? 0.6 : 1 }}
                    onClick={() => void cancelBooking(confirmCancel)}
                  >
                    {cancelBusy ? 'Working…' : needsRequest ? 'Send Request' : 'Yes, Cancel'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* refund request */}
      {refundTarget && (
        <div className="cds-overlay" onClick={() => setRefundTarget(null)}>
          <div className="cds-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Request a refund">
            <div className="cds-modal-body" style={{ textAlign: 'center', gap: '0.9rem', padding: '2rem 1.75rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                Request a refund?
              </h3>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                This asks the caterer to refund {fmt(refundTarget.refundableRemaining)} from your payment of {fmt(refundTarget.amountPaid)}. They will review it and respond.
              </p>
              <input
                className="cds-input"
                style={{ width: '100%' }}
                placeholder="Reason (optional)"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                aria-label="Refund reason"
              />
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', marginTop: '0.4rem' }}>
                <button type="button" className="cds-btn soft" onClick={() => setRefundTarget(null)}>Never Mind</button>
                <button
                  type="button"
                  className="cds-btn primary"
                  disabled={refundBusy}
                  style={{ opacity: refundBusy ? 0.6 : 1 }}
                  onClick={() => void submitRefundRequest()}
                >
                  {refundBusy ? 'Sending…' : 'Send Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
