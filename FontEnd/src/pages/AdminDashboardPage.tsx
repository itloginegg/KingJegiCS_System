import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { useAuth } from '../hooks/useAuth';
import { readSession } from '../lib/tokenStorage';
import {
  fetchMenuItems,
  fetchMenuTrays,
  createMenuItem,
  updateMenuItem,
  deactivateMenuItem,
  createMenuTray,
  updateMenuTray,
  deactivateMenuTray,
  MenuApiError,
  getFullImageUrl,
  type AdminMenuItem,
  type AdminMenuItemPayload,
  type AdminMenuTray,
  type AdminMenuTrayPayload,
} from '../api/menuAdminApi';
import {
  fetchRentalItems,
  createRentalItem,
  updateRentalItem,
  RentalApiError,
  type AdminRentalItem,
  type AdminRentalItemCreate,
  type AdminRentalItemUpdate,
} from '../api/rentalAdminApi';
import {
  fetchServiceItems,
  createServiceItem,
  updateServiceItem,
  ServiceApiError,
  type AdminServiceItem,
  type AdminServiceItemCreate,
  type AdminServiceItemUpdate,
} from '../api/serviceAdminApi';
import { AdminPackagesTab } from './AdminPackagesTab';
import {
  getAllBookings,
  createBooking,
  confirmBooking,
  completeBooking,
  cancelBooking,
  submitBooking,
  generateInvoice,
  BookingApiError,
  type BookingResponse,
  type BookingCreatePayload,
} from '../api/bookingApi';
import {
  searchCustomers,
  createWalkInCustomer,
  CustomerAdminApiError,
  type AdminCustomer,
} from '../api/customerAdminApi';
import { API_BASE_URL } from '../api/bookingApi';
import {
  listSupportThreads,
  getSupportThread,
  replySupport,
  setSupportStatus,
  SupportApiError,
  type SupportThread,
  type SupportThreadSummary,
} from '../api/supportApi';
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
import { fetchAuditLogs, AuditApiError, type AuditLogEntry } from '../api/auditApi';
import { ToastViewport, useToasts } from '../components/ui/Toasts';

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

/* Fallback identity; the signed-in admin account takes precedence. */
const FALLBACK_ADMIN = { name: 'Chris Paul', role: 'Administrator' };

type ResStatus = 'Draft' | 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';



type TestiStatus = 'pending' | 'approved' | 'rejected';

type Testimonial = { id: number; name: string; rating: number; body: string; submittedAt: string; status: TestiStatus };

const INITIAL_TESTIMONIALS: Testimonial[] = [
  { id: 1, name: 'Maria Santos', rating: 5, body: 'King Jegi made our wedding feast unforgettable. Guests are still talking about the lechon months later!', submittedAt: '2026-07-10', status: 'pending' },
  { id: 2, name: 'Jerome dela Cruz', rating: 5, body: 'Professional from quotation to cleanup. The buffet setup looked stunning and everything was served on time.', submittedAt: '2026-07-05', status: 'approved' },
  { id: 3, name: 'Ana Reyes', rating: 4, body: "Farm-fresh talaga ang lasa! The team handled everything so I could actually enjoy my daughter's party.", submittedAt: '2026-06-28', status: 'approved' },
  { id: 4, name: 'Marco Lim', rating: 3, body: 'Food was great but the crew arrived a little later than promised. Still recommended overall.', submittedAt: '2026-06-20', status: 'rejected' },
];

const REVENUE_BY_MONTH = [
  { month: 'Feb', value: 42000 },
  { month: 'Mar', value: 68000 },
  { month: 'Apr', value: 55000 },
  { month: 'May', value: 91000 },
  { month: 'Jun', value: 76898 },
  { month: 'Jul', value: 63000 },
];

/* ─────────────────────────────────────────────────────────────────────────
   Status maps & helpers
───────────────────────────────────────────────────────────────────────── */

const RES_STATUS: Record<ResStatus, { label: string; color: string }> = {
  Draft: { label: 'Draft', color: 'var(--text-dim)' },
  Pending: { label: 'Pending', color: 'var(--accent)' },
  Confirmed: { label: 'Confirmed', color: 'var(--primary)' },
  Completed: { label: 'Completed', color: '#4a90d9' },
  Cancelled: { label: 'Cancelled', color: 'var(--danger)' },
};

type PaymentStatusKey = 'Pending' | 'Success' | 'Failed' | 'PartiallyRefunded' | 'Refunded';

const PAYMENT_STATUS: Record<PaymentStatusKey, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--accent)' },
  Success: { label: 'Success', color: 'var(--primary)' },
  Failed: { label: 'Failed', color: 'var(--danger)' },
  PartiallyRefunded: { label: 'Partially Refunded', color: '#4a90d9' },
  Refunded: { label: 'Refunded', color: '#4a90d9' },
};

const paymentStatusMeta = (status: string) =>
  PAYMENT_STATUS[status as PaymentStatusKey] ?? { label: status, color: 'var(--text-dim)' };

const TESTI_STATUS: Record<TestiStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--accent)' },
  approved: { label: 'Approved', color: 'var(--primary)' },
  rejected: { label: 'Rejected', color: 'var(--danger)' },
};

export const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`;
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

const fmtDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-body)',
        fontSize: '0.62rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        padding: '0.28rem 0.68rem', borderRadius: 'var(--r-full)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function FieldLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)', fontSize: '0.52rem',
        letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500,
        color: 'var(--text-dim)', display: 'block', marginBottom: '0.4rem',
      }}
    >
      {text}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

type Tab = 'overview' | 'bookings' | 'payments' | 'packages' | 'menus' | 'rentals' | 'services' | 'testimonials' | 'audit' | 'placeholder';

const PLACEHOLDER_ITEMS = ['Announcements', 'Chat Support'];

/* ─────────────────────────────────────────────────────────────────────────
   New Booking (item 4) — admin walk-in: find or create a customer, then create
   a Draft booking for them via the existing createBooking (backend uses the
   supplied CustomerId because the caller is an admin).
───────────────────────────────────────────────────────────────────────── */
function NewBookingModal({ onClose, onCreated, notify }: {
  onClose: () => void;
  onCreated: () => void;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [custMode, setCustMode] = useState<'search' | 'new'>('search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminCustomer | null>(null);

  const [wName, setWName] = useState('');
  const [wEmail, setWEmail] = useState('');
  const [wPhone, setWPhone] = useState('');

  const [bookingType, setBookingType] = useState<'FullService' | 'FoodDelivery'>('FullService');
  const [eventType, setEventType] = useState('Wedding');
  const [guests, setGuests] = useState('100');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState('');
  const [contact, setContact] = useState('');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const isFull = bookingType === 'FullService';
  const toHms = (t: string) => (t.length === 5 ? `${t}:00` : t);

  const runSearch = async () => {
    const session = readSession();
    if (!session) { setError('You are signed out. Sign in as Owner/Assistant.'); return; }
    setSearching(true); setError('');
    try {
      setResults(await searchCustomers(session.token, q));
    } catch (err) {
      setError(err instanceof CustomerAdminApiError ? err.message : 'Customer search failed.');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => { void runSearch(); /* initial list */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const session = readSession();
    if (!session) { setError('You are signed out. Sign in as Owner/Assistant.'); return; }

    if (!eventDate || !startTime || !venue.trim()) { setError('Fill in date, time, and venue/address.'); return; }
    if (isFull) {
      if (!endDate || !endTime) { setError('Full-service events need an end date and time.'); return; }
      if (new Date(`${endDate}T${toHms(endTime)}`) <= new Date(`${eventDate}T${toHms(startTime)}`)) {
        setError('The event must end after it starts.'); return;
      }
      if (!eventType || Number(guests) < 1) { setError('Pick an event type and guest count.'); return; }
    }

    setCreating(true); setError('');
    try {
      let customerId: string;
      if (custMode === 'search') {
        if (!selected) { setError('Select a customer, or switch to New walk-in.'); setCreating(false); return; }
        customerId = selected.id;
      } else {
        if (!wName.trim() || !wEmail.trim() || !wPhone.trim()) { setError('Fill in the walk-in name, email, and phone.'); setCreating(false); return; }
        const made = await createWalkInCustomer(session.token, { fullName: wName.trim(), email: wEmail.trim(), phoneNumber: wPhone.trim() });
        customerId = made.id;
      }

      const payload: BookingCreatePayload = {
        customerId,
        bookingType,
        eventDate,
        startTime: toHms(startTime),
        endDate: isFull ? endDate : null,
        endTime: isFull ? toHms(endTime) : null,
        eventType: isFull ? eventType : null,
        venueAddress: venue.trim(),
        guestCount: isFull ? Number(guests) : null,
        contactNumber: contact.trim() || null,
      };
      await createBooking(session.token, payload);
      notify('success', 'Draft booking created. Open it to add items and submit.');
      onCreated();
    } catch (err) {
      setError(
        err instanceof CustomerAdminApiError ? err.message
          : err instanceof BookingApiError ? err.message
          : 'Could not create the booking. Please try again.',
      );
      setCreating(false);
    }
  };

  return (
    <div className="adm-modal-overlay" onClick={() => !creating && onClose()}>
      <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New booking" style={{ maxWidth: 580 }}>
        <h3>New Booking</h3>

        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem' }}>
          <button type="button" className={`adm-btn${custMode === 'search' ? ' primary' : ''}`} onClick={() => setCustMode('search')}>Existing customer</button>
          <button type="button" className={`adm-btn${custMode === 'new' ? ' primary' : ''}`} onClick={() => setCustMode('new')}>New walk-in</button>
        </div>

        {custMode === 'search' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input className="adm-input" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }} style={{ flex: 1 }} />
              <button type="button" className="adm-btn" onClick={() => void runSearch()} disabled={searching}>{searching ? '…' : 'Search'}</button>
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
              {results.length === 0 ? (
                <div style={{ padding: '0.8rem', color: 'var(--text-dim)', fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}>No customers found.</div>
              ) : results.map((c) => (
                <button key={c.id} type="button" onClick={() => setSelected(c)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.8rem', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  background: selected?.id === c.id ? 'var(--primary-muted)' : 'transparent',
                  fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-primary)',
                }}>
                  <strong>{c.fullName}</strong> · <span style={{ color: 'var(--text-muted)' }}>{c.email}</span>
                  {!c.isActive && <span style={{ color: 'var(--danger)' }}> (inactive)</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="form-grid" style={{ marginBottom: '1rem' }}>
            <div className="form-row"><label>Full name</label><input className="adm-input" value={wName} onChange={(e) => setWName(e.target.value)} /></div>
            <div className="form-row"><label>Email</label><input className="adm-input" type="email" value={wEmail} onChange={(e) => setWEmail(e.target.value)} /></div>
            <div className="form-row"><label>Phone</label><input className="adm-input" value={wPhone} onChange={(e) => setWPhone(e.target.value)} /></div>
          </div>
        )}

        <div className="form-grid">
          <div className="form-row"><label>Booking type</label>
            <select className="adm-input" value={bookingType} onChange={(e) => setBookingType(e.target.value as 'FullService' | 'FoodDelivery')}>
              <option value="FullService">Full-service event</option>
              <option value="FoodDelivery">Food delivery</option>
            </select>
          </div>
          {isFull && (
            <div className="form-row"><label>Event type</label>
              <select className="adm-input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option>Wedding</option><option>Corporate</option><option>Birthday</option><option>Others</option>
              </select>
            </div>
          )}
          {isFull && <div className="form-row"><label>Guests</label><input className="adm-input" type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} /></div>}
          <div className="form-row"><label>{isFull ? 'Event date' : 'Delivery date'}</label><input className="adm-input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></div>
          <div className="form-row"><label>{isFull ? 'Start time' : 'Delivery time'}</label><input className="adm-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          {isFull && <div className="form-row"><label>End date</label><input className="adm-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>}
          {isFull && <div className="form-row"><label>End time</label><input className="adm-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>}
          <div className="form-row"><label>{isFull ? 'Venue address' : 'Delivery address'}</label><input className="adm-input" value={venue} onChange={(e) => setVenue(e.target.value)} /></div>
          <div className="form-row"><label>Contact number (optional)</label><input className="adm-input" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.6rem', fontFamily: 'var(--font-body)' }}>{error}</div>}

        <div className="form-actions">
          <button type="button" className="adm-btn" onClick={onClose} disabled={creating}>Cancel</button>
          <button type="button" className="adm-btn primary" onClick={() => void create()} disabled={creating}>{creating ? 'Creating…' : 'Create Draft'}</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Chat Support (item 3) — customer ↔ staff. Lists every thread, opens one to
   reply, live-refreshes via the "SupportMessage" event on the payment hub.
───────────────────────────────────────────────────────────────────────── */
function AdminSupportPanel({ notify }: { notify: (t: 'success' | 'error' | 'info', m: string) => void }) {
  const [threads, setThreads] = useState<SupportThreadSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Open' | 'Closed'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  const statusRef = useRef(statusFilter);
  useEffect(() => { statusRef.current = statusFilter; }, [statusFilter]);
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  const loadThreads = async () => {
    const session = readSession();
    if (!session) return;
    try {
      const st = statusRef.current;
      setThreads(await listSupportThreads(session.token, st === 'all' ? undefined : st));
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not load support threads.');
    } finally {
      setLoadingThreads(false);
    }
  };

  const refreshOpen = async () => {
    const id = selectedRef.current;
    if (!id) return;
    const session = readSession();
    if (!session) return;
    try { setThread(await getSupportThread(session.token, id)); } catch { /* ignore */ }
  };

  const openThread = async (id: string) => {
    const session = readSession();
    if (!session) return;
    setSelectedId(id);
    try {
      setThread(await getSupportThread(session.token, id));
      await loadThreads();   // unread counts change after marking read
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not open the conversation.');
    }
  };

  useEffect(() => { setLoadingThreads(true); void loadThreads(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread]);

  // Live: the backend broadcasts "SupportMessage" on the payment hub on every message.
  useEffect(() => {
    const conn = new HubConnectionBuilder().withUrl(`${API_BASE_URL}/hubs/payment`).withAutomaticReconnect().build();
    conn.on('SupportMessage', (payload: { threadId?: string }) => {
      void loadThreads();
      if (payload?.threadId && payload.threadId === selectedRef.current) void refreshOpen();
    });
    conn.start().catch(() => {});
    return () => { void conn.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || !selectedId) return;
    const session = readSession();
    if (!session) return;
    setInput('');
    setSending(true);
    try {
      await replySupport(session.token, selectedId, text);
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const toggleStatus = async () => {
    if (!thread) return;
    const session = readSession();
    if (!session) return;
    const next = thread.status === 'Open' ? 'Closed' : 'Open';
    try {
      await setSupportStatus(session.token, thread.id, next);
      notify('success', `Thread marked ${next.toLowerCase()}.`);
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not update the status.');
    }
  };

  const when = (iso: string) => {
    try { return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h2 className="adm-title">Chat Support</h2>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {(['all', 'Open', 'Closed'] as const).map((s) => (
            <button key={s} type="button" className={`adm-pill${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)}>{s === 'all' ? 'All' : s}</button>
          ))}
          <button type="button" className="adm-btn" onClick={() => void loadThreads()}>Refresh</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: '1rem', alignItems: 'start' }}>
        <div className="adm-card" style={{ padding: '0.4rem', maxHeight: '62vh', overflowY: 'auto' }}>
          {loadingThreads ? (
            <div style={{ padding: '1.2rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading…</div>
          ) : threads.length === 0 ? (
            <div style={{ padding: '1.2rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No support threads yet.</div>
          ) : threads.map((t) => (
            <button key={t.id} type="button" onClick={() => void openThread(t.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
              padding: '0.7rem 0.8rem', borderRadius: 'var(--r-lg)', marginBottom: '0.2rem',
              background: selectedId === t.id ? 'var(--primary-muted)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <strong style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.customerName}</strong>
                {t.unreadFromCustomer > 0 && <span style={{ background: 'var(--accent)', color: '#fff', fontSize: '0.55rem', fontWeight: 600, borderRadius: 'var(--r-full)', padding: '0.1rem 0.4rem' }}>{t.unreadFromCustomer}</span>}
                {t.status === 'Closed' && <span style={{ color: 'var(--text-dim)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Closed</span>}
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.15rem' }}>{t.lastMessagePreview ?? 'No messages yet'}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>{when(t.lastMessageAt)}</div>
            </button>
          ))}
        </div>

        <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', height: '62vh' }}>
          {!thread ? (
            <div style={{ margin: 'auto', color: 'var(--text-dim)', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>Select a conversation to reply.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.9rem 1rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-primary)' }}>{thread.customerName}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>{thread.status}</div>
                </div>
                <button type="button" className="adm-btn" onClick={() => void toggleStatus()}>{thread.status === 'Open' ? 'Close' : 'Reopen'}</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {thread.messages.length === 0 ? (
                  <div style={{ margin: 'auto', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No messages yet.</div>
                ) : thread.messages.map((m) => {
                  const mine = m.sender === 'Admin';
                  return (
                    <div key={m.id} style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%',
                      background: mine ? 'var(--primary)' : 'var(--bg-subtle)',
                      color: mine ? 'var(--primary-text)' : 'var(--text-primary)',
                      border: mine ? 'none' : '1px solid var(--border)',
                      borderRadius: 'var(--r-lg)', padding: '0.55rem 0.8rem',
                      fontFamily: 'var(--font-body)', fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    }}>
                      {m.text}
                      <div style={{ fontSize: '0.55rem', opacity: 0.65, marginTop: '0.25rem' }}>{when(m.createdAt)}</div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              <form onSubmit={reply} style={{ display: 'flex', gap: '0.5rem', padding: '0.8rem 1rem', borderTop: '1px solid var(--border)' }}>
                <input className="adm-input" style={{ flex: 1 }} placeholder="Type a reply…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Reply" />
                <button type="submit" className="adm-btn primary" disabled={sending || !input.trim()}>{sending ? '…' : 'Send'}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminDashboardPage() {
  const { user: authUser, logout } = useAuth();
  const location = useLocation();

  const adminName = authUser?.name ?? FALLBACK_ADMIN.name;

  const [tab, setTab] = useState<Tab>('overview');
  const [placeholderName, setPlaceholderName] = useState(PLACEHOLDER_ITEMS[0]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [reservations, setReservations] = useState<BookingResponse[]>([]);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

  const loadBookings = async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      const data = await getAllBookings(session.token);
      setReservations(data);
    } catch (err: any) {
      console.error(err);
    }
  };
  const [testimonials, setTestimonials] = useState(INITIAL_TESTIMONIALS);

  const { toasts, notify, dismiss } = useToasts();

  /* payments — live data from /api/Payments/recent + /api/Payments/refund-requests */
  const [payments, setPayments] = useState<AdminPaymentRecord[]>([]);
  const [refundQueue, setRefundQueue] = useState<RefundRequestQueueItem[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [paymentsAuthError, setPaymentsAuthError] = useState(false);
  const [paymentActionBusy, setPaymentActionBusy] = useState<string | null>(null);
  const [denyTargetId, setDenyTargetId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

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
      } else if (action === 'reject') {
        await rejectPayment(session.token, paymentId);
        notify('success', 'Payment rejected.');
      } else if (action === 'refund') {
        await refundPayment(session.token, paymentId, extra?.amount);
        notify('success', 'Refund issued.');
      } else {
        await denyRefund(session.token, paymentId, extra?.reason ?? '');
        notify('success', 'Refund request denied.');
        setDenyTargetId(null);
        setDenyReason('');
      }
      await loadPayments();
    } catch (err) {
      notify(
        'error',
        err instanceof PaymentApiError ? err.message : 'The payment action failed. Please try again.',
      );
    } finally {
      setPaymentActionBusy(null);
    }
  };

  /* audit log — live data from /api/Auditlogs (Owner-only endpoint) */
  const AUDIT_PAGE_SIZE = 25;
  const [auditRows, setAuditRows] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);

  const loadAuditLogs = async (page: number) => {
    const session = readSession();
    if (!session) {
      setAuditError('You are not signed in. Sign in as the Owner to view the audit trail.');
      return;
    }
    setAuditLoading(true);
    setAuditError(null);
    try {
      setAuditRows(await fetchAuditLogs(session.token, { page, pageSize: AUDIT_PAGE_SIZE }));
      setAuditPage(page);
    } catch (err) {
      setAuditError(
        err instanceof AuditApiError ? err.message : 'Unable to load the audit trail. Please try again.',
      );
    } finally {
      setAuditLoading(false);
    }
  };

  /* one-click invoice for a Confirmed booking: issued today, due on the event date */
  const [invoiceBusyId, setInvoiceBusyId] = useState<string | null>(null);

  const generateInvoiceFor = async (b: BookingResponse) => {
    const session = readSession();
    if (!session) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setInvoiceBusyId(b.id);
    try {
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const issueDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      await generateInvoice(session.token, b.id, issueDate, b.eventDate);
      notify('success', `Invoice generated for ${b.bookingName || 'this booking'} — due ${b.eventDate}.`);
    } catch (err) {
      notify(
        'error',
        err instanceof BookingApiError ? err.message : 'Could not generate the invoice. Please try again.',
      );
    } finally {
      setInvoiceBusyId(null);
    }
  };

  /* menus & dishes tab — live data from /api/Menuitems + /api/Menutrays */
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [menuTrays, setMenuTrays] = useState<AdminMenuTray[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuAuthError, setMenuAuthError] = useState(false);
  const [menuCategory, setMenuCategory] = useState<'all' | string>('all');

  const [rentalItems, setRentalItems] = useState<AdminRentalItem[]>([]);
  const [rentalsLoading, setRentalsLoading] = useState(false);
  const [rentalsError, setRentalsError] = useState<string | null>(null);
  const [rentalFormOpen, setRentalFormOpen] = useState(false);
  const [rentalFormMode, setRentalFormMode] = useState<'create' | 'edit'>('create');
  const [rentalFormItem, setRentalFormItem] = useState<AdminRentalItemCreate | AdminRentalItemUpdate>({
    itemName: '',
    category: '',
    totalQuantity: 1,
    unitPrice: 0,
    isActive: true,
    imageFile: null,
  });
  const [rentalImagePreview, setRentalImagePreview] = useState<string | null>(null);
  const [rentalEditId, setRentalEditId] = useState<string | null>(null);
  const [rentalSaving, setRentalSaving] = useState(false);
  const [rentalFeedback, setRentalFeedback] = useState<string | null>(null);
  const [rentalFormError, setRentalFormError] = useState<string | null>(null);
  const rentalCategoryOptions = ['Linens', 'Chairs', 'Tables', 'Lights', 'Others'] as const;
  const rentalFormValid = Boolean(
    rentalFormItem.itemName.trim() &&
    rentalFormItem.category.trim() &&
    Number(rentalFormItem.totalQuantity) >= 1 &&
    Number(rentalFormItem.unitPrice) >= 0,
  );

  /* service items state — live data from /api/Serviceitems */
  const [serviceItems, setServiceItems] = useState<AdminServiceItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [serviceFormOpen, setServiceFormOpen] = useState(false);
  const [serviceFormMode, setServiceFormMode] = useState<'create' | 'edit'>('create');
  const [serviceFormItem, setServiceFormItem] = useState<AdminServiceItemCreate | AdminServiceItemUpdate>({
    serviceName: '',
    unitCost: 0,
    isActive: true,
  });
  const [serviceEditId, setServiceEditId] = useState<string | null>(null);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceFeedback, setServiceFeedback] = useState<string | null>(null);
  const [serviceFormError, setServiceFormError] = useState<string | null>(null);
  const serviceFormValid = Boolean(
    serviceFormItem.serviceName.trim() && Number(serviceFormItem.unitCost) >= 0,
  );

  const [menuFormOpen, setMenuFormOpen] = useState(false);
  const [menuFormMode, setMenuFormMode] = useState<'item' | 'tray'>('item');
  const [menuFormAction, setMenuFormAction] = useState<'create' | 'edit'>('create');
  const [menuFormItem, setMenuFormItem] = useState<AdminMenuItemPayload | null>(null);
  const [menuImagePreview, setMenuImagePreview] = useState<string | null>(null);
  const [menuFormTray, setMenuFormTray] = useState<AdminMenuTrayPayload | null>(null);
  const [menuEditId, setMenuEditId] = useState<string | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuSuccess, setMenuSuccess] = useState<string | null>(null);

  const MENU_ITEM_FORM_DEFAULT: AdminMenuItemPayload = {
    itemName: '',
    itemCategory: '',
    courseCategory: '',
    description: '',
    dietaryTags: [],
    pricePerTray: null,
    servesPerTray: 1,
    menuPackageId: null,
    imageFile: null,
  };

  const MENU_TRAY_FORM_DEFAULT: AdminMenuTrayPayload = {
    trayName: '',
    pricePerTray: 0,
    servesMin: 1,
    servesMax: 1,
    dishItemIds: [],
  };

  const openMenuForm = (
    mode: 'item' | 'tray',
    action: 'create' | 'edit',
    payload: AdminMenuItemPayload | AdminMenuTrayPayload | null = null,
    id: string | null = null,
  ) => {
    setMenuFormMode(mode);
    setMenuFormAction(action);
    setMenuEditId(id);
    setMenuSuccess(null);

    if (mode === 'item') {
      const itemData = action === 'edit' && payload ? (payload as AdminMenuItemPayload) : MENU_ITEM_FORM_DEFAULT;
      setMenuFormItem(itemData);
      setMenuFormTray(null);
      const existingUrl = (payload as (AdminMenuItemPayload & { imageUrl?: string | null }))?.imageUrl;
      setMenuImagePreview(existingUrl ? getFullImageUrl(existingUrl) : null);
    } else {
      setMenuFormTray(
        action === 'edit' && payload ? (payload as AdminMenuTrayPayload) : MENU_TRAY_FORM_DEFAULT,
      );
      setMenuFormItem(null);
      setMenuImagePreview(null);
    }

    setMenuFormOpen(true);
  };

  const handleMenuFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      updateMenuFormItem({ imageFile: file });
      setMenuImagePreview(URL.createObjectURL(file));
    }
  };

  const clearMenuImage = () => {
    updateMenuFormItem({ imageFile: null });
    setMenuImagePreview(null);
  };

  const updateMenuFormItem = (changes: Partial<AdminMenuItemPayload>) => {
    setMenuFormItem((prev) => (prev ? { ...prev, ...changes } : prev));
  };

  const updateMenuFormTray = (changes: Partial<AdminMenuTrayPayload>) => {
    setMenuFormTray((prev) => (prev ? { ...prev, ...changes } : prev));
  };

  const closeMenuForm = () => {
    setMenuFormOpen(false);
    setMenuFormItem(null);
    setMenuFormTray(null);
    setMenuEditId(null);
    setMenuSuccess(null);
    setMenuImagePreview(null);
  };

  /* bookings tab state */
  const [resFilter, setResFilter] = useState<'all' | ResStatus>('all');
  const [resSearch, setResSearch] = useState('');
  const [cancelResId, setCancelResId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  /* payments tab state */
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentStatusKey>('all');
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  /* packages tab state */


  /* testimonials tab state */
  const [testiFilter, setTestiFilter] = useState<'all' | TestiStatus>('pending');

  /* calendar state */
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  /* ── derived metrics ── */
  const totalRevenue = payments
    .filter((p) => p.status === 'Success' || p.status === 'PartiallyRefunded' || p.status === 'Refunded')
    .reduce((s, p) => s + (p.amountPaid - p.refundedAmount), 0);
  const pendingPayments = payments.filter((p) => p.status === 'Pending');
  const pendingPayTotal = pendingPayments.reduce((s, p) => s + p.amountPaid, 0);
  const pendingRes = reservations.filter((r) => r.status === 'Pending');
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const upcomingCount = reservations.filter((r) => {
    if (r.status !== 'Pending' && r.status !== 'Confirmed') return false;
    const d = new Date(r.eventDate);
    return d >= now && d <= in30;
  }).length;
  const pendingTesti = testimonials.filter((t) => t.status === 'pending').length;

  /* dates with ≥2 active reservations flag as conflicts */
  const conflictDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reservations) {
      if (r.status === 'Pending' || r.status === 'Confirmed') {
        counts.set(r.eventDate, (counts.get(r.eventDate) ?? 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, c]) => c >= 2).map(([d]) => d));
  }, [reservations]);

  const filteredRes = useMemo(() => {
    const q = resSearch.trim().toLowerCase();
    return reservations
      .filter((r) => resFilter === 'all' || r.status === resFilter)
      .filter(
        (r) =>
          q === '' ||
          (r.bookingName && r.bookingName.toLowerCase().includes(q)) ||
          (r.contactNumber && r.contactNumber.toLowerCase().includes(q)) ||
          (r.eventType && r.eventType.toLowerCase().includes(q)),
      )
      .sort((a, b) => +new Date(a.eventDate) - +new Date(b.eventDate));
  }, [reservations, resFilter, resSearch]);

  const filteredPayments = payments.filter((p) => paymentFilter === 'all' || p.status === paymentFilter);

  const filteredTesti = testimonials.filter((t) => testiFilter === 'all' || t.status === testiFilter);

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

  const cancelReservation = async (id: string) => {
    const session = readSession();
    if (!session?.token) return;
    try {
      const updated = await cancelBooking(session.token, id);
      setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setCancelResId(null);
      setCancelReason('');
      notify('success', 'Booking cancelled.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to cancel booking.');
    }
  };

  const setTestiStatus = (id: number, status: TestiStatus) =>
    setTestimonials((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));

  const openTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };

  /* ── menus & dishes: fetch ── */
  const loadMenuCatalog = async () => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to load the menu catalog.');
      setMenuAuthError(true);
      return;
    }
    setMenuLoading(true);
    setMenuError(null);
    setMenuAuthError(false);
    try {
      const [items, trays] = await Promise.all([
        fetchMenuItems(session.token),
        fetchMenuTrays(session.token),
      ]);
      setMenuItems(items);
      setMenuTrays(trays);
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError('Something went wrong while loading the menu catalog. Please try again.');
      }
    } finally {
      setMenuLoading(false);
    }
  };

  const loadRentalCatalog = async () => {
    const session = readSession();
    if (!session) {
      setRentalsError('You are not signed in. Sign in with an Owner or Assistant account to load rentals.');
      return;
    }

    setRentalsLoading(true);
    setRentalsError(null);
    setRentalFeedback(null);

    try {
      const items = await fetchRentalItems(session.token);
      setRentalItems(items);
    } catch (err) {
      if (err instanceof RentalApiError) {
        setRentalsError(err.message);
      } else {
        setRentalsError('Unable to load rental inventory. Please try again.');
      }
    } finally {
      setRentalsLoading(false);
    }
  };

  const openRentalForm = (mode: 'create' | 'edit', item?: AdminRentalItem) => {
    setRentalFormMode(mode);
    setRentalFormError(null);
    setRentalFeedback(null);
    if (mode === 'edit' && item) {
      setRentalFormItem({
        itemName: item.itemName,
        category: item.category,
        totalQuantity: item.totalQuantity,
        unitPrice: item.unitPrice,
        isActive: item.isActive,
        imageFile: null,
      });
      setRentalEditId(item.id);
      setRentalImagePreview(item.imageUrl ? getFullImageUrl(item.imageUrl) : null);
    } else {
      setRentalFormItem({ itemName: '', category: '', totalQuantity: 1, unitPrice: 0, isActive: true, imageFile: null });
      setRentalEditId(null);
      setRentalImagePreview(null);
    }
    setRentalFormOpen(true);
  };

  const handleRentalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRentalFormItem((prev) => ({ ...prev, imageFile: file }));
      setRentalImagePreview(URL.createObjectURL(file));
    }
  };

  const clearRentalImage = () => {
    setRentalFormItem((prev) => ({ ...prev, imageFile: null }));
    setRentalImagePreview(null);
  };

  const closeRentalForm = () => {
    setRentalFormOpen(false);
    setRentalEditId(null);
    setRentalFormError(null);
    setRentalFormItem({ itemName: '', category: '', totalQuantity: 1, unitPrice: 0, isActive: true, imageFile: null });
    setRentalImagePreview(null);
  };

  const saveRentalItem = async () => {
    const session = readSession();
    if (!session) {
      setRentalsError('You are not signed in. Sign in with an Owner or Assistant account to save rentals.');
      return;
    }

    const itemName = rentalFormItem.itemName.trim();
    const category = rentalFormItem.category.trim();
    const totalQuantity = Number(rentalFormItem.totalQuantity);
    const unitPrice = Number(rentalFormItem.unitPrice);

    if (!itemName || !category) {
      setRentalFormError('Please enter the rental item name and category.');
      return;
    }
    if (!Number.isFinite(totalQuantity) || totalQuantity < 1) {
      setRentalFormError('Total quantity must be at least 1.');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setRentalFormError('Unit price cannot be negative.');
      return;
    }

    setRentalSaving(true);
    setRentalsError(null);
    setRentalFormError(null);

    try {
      if (rentalFormMode === 'edit' && rentalEditId) {
        const payload: AdminRentalItemUpdate = {
          itemName,
          category,
          totalQuantity,
          unitPrice,
          isActive: Boolean((rentalFormItem as AdminRentalItemUpdate).isActive),
          imageFile: rentalFormItem.imageFile,
        };
        const updated = await updateRentalItem(session.token, rentalEditId, payload);
        setRentalItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setRentalFeedback(`Updated ${updated.itemName}.`);
      } else {
        const payload: AdminRentalItemCreate = {
          itemName,
          category,
          totalQuantity,
          unitPrice,
          imageFile: rentalFormItem.imageFile,
        };
        const created = await createRentalItem(session.token, payload);
        setRentalItems((prev) => [created, ...prev]);
        setRentalFeedback(`Created ${created.itemName}.`);
      }
      closeRentalForm();
    } catch (err) {
      if (err instanceof RentalApiError) {
        setRentalsError(err.message);
      } else {
        setRentalsError('Unable to save the rental item. Please try again.');
      }
    } finally {
      setRentalSaving(false);
    }
  };

  const toggleRentalActive = async (item: AdminRentalItem) => {
    const session = readSession();
    if (!session) {
      setRentalsError('You are not signed in. Sign in with an Owner or Assistant account to update rentals.');
      return;
    }

    setRentalSaving(true);
    setRentalsError(null);
    setRentalFeedback(null);

    try {
      const updated = await updateRentalItem(session.token, item.id, {
        itemName: item.itemName,
        category: item.category,
        totalQuantity: item.totalQuantity,
        unitPrice: item.unitPrice,
        isActive: !item.isActive,
      });
      setRentalItems((prev) => prev.map((current) => (current.id === updated.id ? updated : current)));
      setRentalFeedback(`${updated.itemName} is now ${updated.isActive ? 'active' : 'inactive'}.`);
    } catch (err) {
      if (err instanceof RentalApiError) {
        setRentalsError(err.message);
      } else {
        setRentalsError('Unable to update the rental item. Please try again.');
      }
    } finally {
      setRentalSaving(false);
    }
  };

  const loadServiceCatalog = async () => {
    const session = readSession();
    if (!session) {
      setServicesError('You are not signed in. Sign in with an Owner or Assistant account to load services.');
      return;
    }

    setServicesLoading(true);
    setServicesError(null);
    setServiceFeedback(null);

    try {
      const items = await fetchServiceItems(session.token);
      setServiceItems(items);
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServicesError(err.message);
      } else {
        setServicesError('Unable to load service catalog. Please try again.');
      }
    } finally {
      setServicesLoading(false);
    }
  };

  const openServiceForm = (mode: 'create' | 'edit', item?: AdminServiceItem) => {
    setServiceFormMode(mode);
    setServiceFormError(null);
    setServiceFeedback(null);
    if (mode === 'edit' && item) {
      setServiceFormItem({
        serviceName: item.serviceName,
        unitCost: item.unitCost,
        isActive: item.isActive,
      });
      setServiceEditId(item.id);
    } else {
      setServiceFormItem({ serviceName: '', unitCost: 0, isActive: true });
      setServiceEditId(null);
    }
    setServiceFormOpen(true);
  };

  const closeServiceForm = () => {
    setServiceFormOpen(false);
    setServiceEditId(null);
    setServiceFormError(null);
    setServiceFormItem({ serviceName: '', unitCost: 0, isActive: true });
  };

  const saveServiceItem = async () => {
    const session = readSession();
    if (!session) {
      setServicesError('You are not signed in. Sign in with an Owner or Assistant account to save services.');
      return;
    }

    const serviceName = serviceFormItem.serviceName.trim();
    const unitCost = Number(serviceFormItem.unitCost);

    if (!serviceName) {
      setServiceFormError('Please enter the service name.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setServiceFormError('Unit cost cannot be negative.');
      return;
    }

    setServiceSaving(true);
    setServicesError(null);
    setServiceFormError(null);

    try {
      if (serviceFormMode === 'edit' && serviceEditId) {
        const payload: AdminServiceItemUpdate = {
          serviceName,
          unitCost,
          isActive: Boolean((serviceFormItem as AdminServiceItemUpdate).isActive),
        };
        const updated = await updateServiceItem(session.token, serviceEditId, payload);
        setServiceItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setServiceFeedback(`Updated service "${updated.serviceName}".`);
      } else {
        const payload: AdminServiceItemCreate = { serviceName, unitCost };
        const created = await createServiceItem(session.token, payload);
        setServiceItems((prev) => [created, ...prev]);
        setServiceFeedback(`Created service "${created.serviceName}".`);
      }
      closeServiceForm();
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServiceFormError(err.message);
      } else {
        setServiceFormError('Unable to save the service item. Please try again.');
      }
    } finally {
      setServiceSaving(false);
    }
  };

  const toggleServiceActive = async (item: AdminServiceItem) => {
    const session = readSession();
    if (!session) {
      setServicesError('You are not signed in. Sign in with an Owner or Assistant account to update services.');
      return;
    }

    setServiceSaving(true);
    setServicesError(null);
    setServiceFeedback(null);

    try {
      const updated = await updateServiceItem(session.token, item.id, {
        serviceName: item.serviceName,
        unitCost: item.unitCost,
        isActive: !item.isActive,
      });
      setServiceItems((prev) => prev.map((current) => (current.id === updated.id ? updated : current)));
      setServiceFeedback(`"${updated.serviceName}" is now ${updated.isActive ? 'active' : 'inactive'}.`);
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServicesError(err.message);
      } else {
        setServicesError('Unable to update service status. Please try again.');
      }
    } finally {
      setServiceSaving(false);
    }
  };

  const applyMenuItemToState = (item: AdminMenuItem) => {
    setMenuItems((prev) => {
      const exists = prev.some((m) => m.id === item.id);
      return exists ? prev.map((m) => (m.id === item.id ? item : m)) : [item, ...prev];
    });
  };

  const applyMenuTrayToState = (tray: AdminMenuTray) => {
    setMenuTrays((prev) => {
      const exists = prev.some((t) => t.id === tray.id);
      return exists ? prev.map((t) => (t.id === tray.id ? tray : t)) : [tray, ...prev];
    });
  };

  const saveMenuForm = async () => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to save changes.');
      setMenuAuthError(true);
      return;
    }

    setMenuSaving(true);
    setMenuError(null);
    setMenuSuccess(null);

    try {
      if (menuFormMode === 'item' && menuFormItem) {
        const payload = menuFormItem;
        const result = menuFormAction === 'edit' && menuEditId
          ? await updateMenuItem(session.token, menuEditId, payload)
          : await createMenuItem(session.token, payload);
        applyMenuItemToState(result);
        setMenuSuccess(`Menu item ${menuFormAction === 'edit' ? 'updated' : 'created'} successfully.`);
      }

      if (menuFormMode === 'tray' && menuFormTray) {
        const payload = menuFormTray;
        const result = menuFormAction === 'edit' && menuEditId
          ? await updateMenuTray(session.token, menuEditId, payload)
          : await createMenuTray(session.token, payload);
        applyMenuTrayToState(result);
        setMenuSuccess(`Menu tray ${menuFormAction === 'edit' ? 'updated' : 'created'} successfully.`);
      }

      setTimeout(() => {
        closeMenuForm();
      }, 700);
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError('Unable to save the menu entry. Please try again.');
      }
    } finally {
      setMenuSaving(false);
    }
  };

  const deactivateMenuEntry = async (mode: 'item' | 'tray', id: string) => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to deactivate entries.');
      setMenuAuthError(true);
      return;
    }

    setMenuLoading(true);
    setMenuError(null);

    try {
      if (mode === 'item') {
        await deactivateMenuItem(session.token, id);
        setMenuItems((prev) => prev.map((m) => (m.id === id ? { ...m, isActive: false } : m)));
      } else {
        await deactivateMenuTray(session.token, id);
        setMenuTrays((prev) => prev.map((t) => (t.id === id ? { ...t, isActive: false } : t)));
      }
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError('Unable to deactivate the menu entry. Please try again.');
      }
    } finally {
      setMenuLoading(false);
    }
  };

  /* refetch every time the tab is opened so admin edits elsewhere show up */
  useEffect(() => {
    if (tab === 'overview' || tab === 'payments') void loadPayments();
    if (tab === 'audit') void loadAuditLogs(1);
    if (tab === 'bookings') void loadBookings();
    if (tab === 'menus') void loadMenuCatalog();
    if (tab === 'rentals') void loadRentalCatalog();
    if (tab === 'services') void loadServiceCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const menuCategories = useMemo(
    () => [...new Set(menuItems.map((m) => m.itemCategory))].sort(),
    [menuItems],
  );
  const visibleMenuItems = menuItems.filter(
    (m) => menuCategory === 'all' || m.itemCategory === menuCategory,
  );

  /* calendar cells */
  const calYear = calMonth.getFullYear();
  const calMo = calMonth.getMonth();
  const daysInMonth = new Date(calYear, calMo + 1, 0).getDate();
  const startDay = new Date(calYear, calMo, 1).getDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const calCells: (number | null)[] = [
    ...Array.from({ length: startDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const maxRevenue = Math.max(...REVENUE_BY_MONTH.map((m) => m.value));

  const NAV: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: '▦' },
    { id: 'bookings', label: 'Bookings', icon: '🗓', badge: pendingRes.length },
    { id: 'payments', label: 'Payments', icon: '₱', badge: pendingPayments.length },
    { id: 'packages', label: 'Packages', icon: '📦' },
    { id: 'testimonials', label: 'Testimonials', icon: '★', badge: pendingTesti },
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
        .adm-nav-icon {
          width: 27px; height: 27px; flex-shrink: 0;
          border-radius: var(--r-sm);
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.78rem;
        }
        .adm-nav-item.active .adm-nav-icon { background: var(--primary-muted); border-color: var(--border-accent); }
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
        .adm-foot-btn.danger:hover { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: var(--danger-muted); }

        .adm-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(20, 14, 8, 0.45); display: none; }

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

        .adm-title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 500; color: var(--text-primary); }

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
        .adm-pill.active .count { background: rgba(255,255,255,0.22); color: var(--primary-text); }

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
        .adm-btn.danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
        .adm-btn.info { background: color-mix(in srgb, #4a90d9 12%, transparent); color: #4a90d9; border-color: color-mix(in srgb, #4a90d9 30%, transparent); }
        .adm-btn.info:hover:not(:disabled) { background: #4a90d9; color: #fff; }

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

        /* rows */
        .adm-row { border-bottom: 1px solid var(--border); }
        .adm-row:last-child { border-bottom: none; }

        /* responsive */
        @media (max-width: 900px) {
          .adm-main { margin-left: 0; }
          .adm-sidebar { transform: translateX(-100%); }
          .adm-sidebar.open { transform: translateX(0); box-shadow: var(--shadow-lg); }
          .adm-scrim.open { display: block; }
          .adm-burger { display: flex; }
          .adm-topbar { padding: 0.8rem 1.25rem; }
          .adm-content { padding: 1.5rem 1.25rem 4rem !important; }
          .adm-overview-cols { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="adm-shell">

        {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
        <div className={`adm-scrim${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
        <aside className={`adm-sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="adm-brand">
            <div className="adm-brand-mark">K</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                King Jegi
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
                Admin Panel
              </div>
            </div>
          </div>

          <nav className="adm-nav" aria-label="Admin navigation">
            <span className="adm-nav-caption">Operations</span>
            {NAV.map((item) => (
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
            ))}

            <span className="adm-nav-caption" style={{ marginTop: '0.9rem' }}>Management</span>
            <button
              type="button"
              className={`adm-nav-item${tab === 'menus' ? ' active' : ''}`}
              onClick={() => openTab('menus')}
            >
              <span className="adm-nav-icon">🍽️</span>
              Menus &amp; Dishes
            </button>
            <button
              type="button"
              className={`adm-nav-item${tab === 'rentals' ? ' active' : ''}`}
              onClick={() => openTab('rentals')}
            >
              <span className="adm-nav-icon">🎪</span>
              Rentals
            </button>
            <button
              type="button"
              className={`adm-nav-item${tab === 'services' ? ' active' : ''}`}
              onClick={() => openTab('services')}
            >
              <span className="adm-nav-icon">🛠️</span>
              Service Items
            </button>
            <Link
              to="/admin/booking-histories"
              className={`adm-nav-item${isRouteActive('/admin/booking-histories') ? ' active' : ''}`}
            >
              <span className="adm-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M8 2v4" />
                  <path d="M16 2v4" />
                  <path d="M4 10h16" />
                  <path d="M8 14h3" />
                  <path d="M8 17h6" />
                </svg>
              </span>
              Booking Histories
            </Link>
            <button
              type="button"
              className={`adm-nav-item${tab === 'audit' ? ' active' : ''}`}
              onClick={() => openTab('audit')}
            >
              <span className="adm-nav-icon">🧾</span>
              Audit Log
            </button>
            {PLACEHOLDER_ITEMS.map((name) => (
              <button
                key={name}
                type="button"
                className={`adm-nav-item${tab === 'placeholder' && placeholderName === name ? ' active' : ''}`}
                onClick={() => { setPlaceholderName(name); openTab('placeholder'); }}
              >
                <span className="adm-nav-icon">◌</span>
                {name}
              </button>
            ))}
          </nav>

          <div className="adm-sidebar-foot">
            <button type="button" className="adm-foot-btn danger" onClick={() => void logout()}>
              ⎋ Logout
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
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--text-dim)' }}>
              {tab === 'placeholder' ? placeholderName : tab === 'menus' ? 'Menus & Dishes' : tab === 'services' ? 'Service Items' : tab === 'rentals' ? 'Rentals' : tab === 'audit' ? 'Audit Log' : NAV.find((n) => n.id === tab)?.label}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }} className="adm-hide-sm">
              {adminName} · {FALLBACK_ADMIN.role}
            </span>
            <div className="adm-avatar" title={adminName}>{adminName.charAt(0)}</div>
          </div>

          {/* content */}
          <div className="adm-content" style={{ padding: '2rem 2.25rem 4rem', flex: 1, maxWidth: 1240, width: '100%', margin: '0 auto' }}>

            {/* ══════════ OVERVIEW ══════════ */}
            {tab === 'overview' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
                <div>
                  <h1 className="adm-title" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.1rem)' }}>
                    Good day,{' '}
                    <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{adminName.split(' ')[0]}</em>
                  </h1>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    Here's the business at a glance.
                  </p>
                </div>

                {/* metrics */}
                <div className="adm-metrics">
                  {[
                    { label: 'Total Revenue', value: fmt(totalRevenue), sub: 'from confirmed payments', color: 'var(--primary)' },
                    { label: 'Pending Payments', value: String(pendingPayments.length), sub: `${fmt(pendingPayTotal)} awaiting confirmation`, color: 'var(--accent)' },
                    { label: 'Upcoming Events', value: String(upcomingCount), sub: 'within the next 30 days', color: '#4a90d9' },
                    { label: 'Pending Reservations', value: String(pendingRes.length), sub: 'awaiting your review', color: 'var(--accent)' },
                  ].map((m) => (
                    <div key={m.label} className="adm-card adm-metric">
                      <div className="head">
                        <span className="dot" style={{ background: m.color }} />
                        <span className="lbl">{m.label}</span>
                      </div>
                      <div className="num" style={{ color: m.color === 'var(--primary)' ? 'var(--primary)' : 'var(--text-primary)' }}>{m.value}</div>
                      <div className="sub">{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* chart + calendar */}
                <div className="adm-overview-cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 5fr) minmax(340px, 7fr)', gap: '1.4rem', alignItems: 'start' }}>

                  {/* revenue chart */}
                  <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                    <FieldLabel text="Last 6 Months" />
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 1.1rem' }}>
                      Revenue Trend
                    </h3>
                    <div className="adm-chart">
                      {REVENUE_BY_MONTH.map((m) => (
                        <div key={m.month} className="col">
                          <span className="val">₱{Math.round(m.value / 1000)}k</span>
                          <div className="bar" style={{ height: `${Math.round((m.value / maxRevenue) * 100)}%` }} />
                          <span className="mon">{m.month}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* event calendar */}
                  <div className="adm-card" style={{ overflow: 'hidden' }}>
                    <div className="adm-cal-head">
                      <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Previous month" onClick={() => setCalMonth(new Date(calYear, calMo - 1, 1))}>
                        ‹
                      </button>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {calMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                      </span>
                      <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Next month" onClick={() => setCalMonth(new Date(calYear, calMo + 1, 1))}>
                        ›
                      </button>
                    </div>
                    <div className="adm-cal-grid" style={{ paddingBottom: 0 }}>
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="adm-cal-dow">{d}</div>)}
                    </div>
                    <div className="adm-cal-grid" style={{ paddingTop: 0 }}>
                      {calCells.map((day, i) => {
                        if (day === null) return <div key={`e${i}`} />;
                        const dateStr = `${calYear}-${pad(calMo + 1)}-${pad(day)}`;
                        const dayEvents = reservations.filter(
                          (r) => r.eventDate === dateStr && (r.status === 'Pending' || r.status === 'Confirmed'),
                        );
                        const conflict = conflictDates.has(dateStr);
                        const isToday = dateStr === todayISO;
                        return (
                          <div
                            key={dateStr}
                            className="adm-cal-cell"
                            style={{
                              background: conflict ? 'var(--accent-muted)' : isToday ? 'var(--primary-muted)' : 'transparent',
                              outline: isToday ? '1px solid var(--primary)' : 'none',
                            }}
                          >
                            <div className="d" style={{ color: isToday ? 'var(--primary)' : undefined }}>{day}</div>
                            {dayEvents.slice(0, 2).map((ev) => {
                              const c = RES_STATUS[ev.status as ResStatus]?.color || '#999';
                              return (
                                <span key={ev.id} className="adm-cal-ev" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
                                  {ev.bookingName}
                                </span>
                              );
                            })}
                            {conflict && (
                              <span className="adm-cal-ev" style={{ color: 'var(--accent)', fontWeight: 600 }}>⚠ conflict</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* pending queue */}
                <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                    <div>
                      <FieldLabel text="Needs Attention" />
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                        Pending Reservations
                      </h3>
                    </div>
                    <button type="button" className="adm-btn outline" onClick={() => openTab('bookings')}>Review All →</button>
                  </div>
                  {pendingRes.length === 0 ? (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1rem 0' }}>
                      All caught up — nothing pending.
                    </p>
                  ) : (
                    pendingRes.map((r) => (
                      <div key={r.id} className="adm-row" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem 0', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>{r.bookingName}</div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                            {r.eventType || r.bookingType} · {fmtDate(r.eventDate)} · {r.guestCount || 'N/A'} guests
                          </div>
                        </div>
                        {conflictDates.has(r.eventDate) && <StatusBadge label="⚠ Date conflict" color="var(--accent)" />}
                        <button type="button" className="adm-btn success" onClick={() => setResStatus(r.id, 'Confirmed')}>Confirm</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ══════════ BOOKINGS ══════════ */}
            {tab === 'bookings' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <h2 className="adm-title">Bookings</h2>
                  <input
                    className="adm-input"
                    type="search"
                    placeholder="Search name, email, or event…"
                    value={resSearch}
                    onChange={(e) => setResSearch(e.target.value)}
                    style={{ flex: '0 1 300px' }}
                    aria-label="Search bookings"
                  />
                  <button type="button" className="adm-btn primary" onClick={() => setNewBookingOpen(true)}>+ New Booking</button>
                </div>

                {newBookingOpen && (
                  <NewBookingModal
                    onClose={() => setNewBookingOpen(false)}
                    onCreated={() => { setNewBookingOpen(false); void loadBookings(); }}
                    notify={notify}
                  />
                )}

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['all', 'Draft', 'Pending', 'Confirmed', 'Completed', 'Cancelled'] as const).map((k) => {
                    const count = k === 'all' ? reservations.length : reservations.filter((r) => r.status === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${resFilter === k ? ' active' : ''}`} onClick={() => setResFilter(k)}>
                        {k === 'all' ? 'All' : k}
                        <span className="count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {filteredRes.length === 0 ? (
                  <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    No bookings match the current view.
                  </div>
                ) : (
                  filteredRes.map((r) => {
                    const cancelling = cancelResId === r.id;
                    return (
                      <div key={r.id} className="adm-card" style={{ padding: '1.35rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 240 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                              {r.bookingName}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.3rem 1.4rem', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                              <span>Event: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.eventType || r.bookingType}</strong></span>
                              <span>Date: <strong style={{ color: 'var(--primary)', fontWeight: 500 }}>{fmtDate(r.eventDate)} · {r.startTime?.substring(0, 5)}</strong></span>
                              <span>Guests: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.guestCount || 'N/A'}</strong></span>
                              <span>Email: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Not provided</strong></span>
                              <span>Phone: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.contactNumber || 'N/A'}</strong></span>
                              {r.menuPackageId && <span>Package: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Package Selected</strong></span>}
                            </div>
                            {r.cancellationRequested && (
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.65rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', padding: '0.5rem 0.8rem', borderLeft: '2px solid var(--border-accent)' }}>
                                ⚠ Cancellation Requested: {r.cancellationRequestReason}
                              </p>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.45rem' }}>
                            {conflictDates.has(r.eventDate) && (r.status === 'Pending' || r.status === 'Confirmed') && (
                              <StatusBadge label="⚠ Date conflict" color="var(--accent)" />
                            )}
                            <StatusBadge label={RES_STATUS[r.status as ResStatus]?.label || r.status} color={RES_STATUS[r.status as ResStatus]?.color || '#999'} />
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                          {r.status === 'Draft' && (
                            <button type="button" className="adm-btn success" disabled={submitBusyId === r.id} onClick={() => void submitDraftFor(r)}>
                              {submitBusyId === r.id ? 'Submitting…' : 'Submit for Customer'}
                            </button>
                          )}
                          {r.status === 'Pending' && (
                            <button type="button" className="adm-btn success" onClick={() => setResStatus(r.id, 'Confirmed')}>Confirm</button>
                          )}
                          {r.status === 'Confirmed' && (
                            <button type="button" className="adm-btn info" onClick={() => setResStatus(r.id, 'Completed')}>Mark Completed</button>
                          )}
                          {r.status === 'Confirmed' && (
                            <button
                              type="button"
                              className="adm-btn outline"
                              disabled={invoiceBusyId === r.id}
                              onClick={() => void generateInvoiceFor(r)}
                            >
                              {invoiceBusyId === r.id ? 'Generating…' : 'Generate Invoice'}
                            </button>
                          )}
                          {(r.status === 'Pending' || r.status === 'Confirmed') && !cancelling && (
                            <button type="button" className="adm-btn danger" onClick={() => { setCancelResId(r.id); setCancelReason(''); }}>Cancel</button>
                          )}
                        </div>

                        {cancelling && (
                          <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <FieldLabel text="Reason for cancellation" />
                              <input className="adm-input square" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Required" />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button type="button" className="adm-btn danger" disabled={!cancelReason.trim()} onClick={() => cancelReservation(r.id)}>
                                Confirm Cancel
                              </button>
                              <button type="button" className="adm-btn outline" onClick={() => setCancelResId(null)}>Back</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ══════════ PAYMENTS (live backend data) ══════════ */}
            {tab === 'payments' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="adm-title">Payments</h2>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                      Live from the backend — <code style={{ fontSize: '0.66rem' }}>/api/Payments/recent</code>
                    </p>
                  </div>
                  <button type="button" className="adm-btn outline" onClick={() => void loadPayments()} disabled={paymentsLoading}>
                    {paymentsLoading ? 'Refreshing…' : '↻ Refresh'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['all', 'Pending', 'Success', 'Failed', 'PartiallyRefunded', 'Refunded'] as const).map((k) => {
                    const count = k === 'all' ? payments.length : payments.filter((p) => p.status === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${paymentFilter === k ? ' active' : ''}`} onClick={() => setPaymentFilter(k)}>
                        {k === 'all' ? 'All Payments' : PAYMENT_STATUS[k].label}
                        <span className="count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* ── refund request queue ── */}
                {!paymentsLoading && !paymentsError && refundQueue.length > 0 && (
                  <div className="adm-card" style={{ padding: '1.3rem 1.5rem' }}>
                    <FieldLabel text={`Refund Requests · ${refundQueue.length} awaiting review`} />
                    {refundQueue.map((rq) => {
                      const busy = paymentActionBusy === rq.paymentId;
                      const denying = denyTargetId === rq.paymentId;
                      return (
                        <div key={rq.paymentId} className="adm-row" style={{ padding: '0.85rem 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                {rq.bookingName || 'Booking'} · requesting {fmt(rq.requestedAmount)}
                              </div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                                paid {fmt(rq.amountPaid)} · refundable {fmt(rq.refundableRemaining)} · booking {rq.bookingStatus}
                                {rq.cancellationRequested ? ' · cancellation requested' : ''}
                                {rq.reason ? ` · "${rq.reason}"` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="adm-btn success"
                              disabled={busy}
                              onClick={() => void runPaymentAction(rq.paymentId, 'refund', { amount: rq.requestedAmount })}
                            >
                              {busy ? 'Working…' : `Approve ${fmt(rq.requestedAmount)}`}
                            </button>
                            <button
                              type="button"
                              className="adm-btn danger"
                              disabled={busy}
                              onClick={() => { setDenyTargetId(denying ? null : rq.paymentId); setDenyReason(''); }}
                            >
                              Deny
                            </button>
                          </div>
                          {denying && (
                            <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.8rem' }}>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <FieldLabel text="Reason shown to the customer" />
                                <input className="adm-input square" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Required" />
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                  type="button"
                                  className="adm-btn danger"
                                  disabled={!denyReason.trim() || busy}
                                  onClick={() => void runPaymentAction(rq.paymentId, 'deny', { reason: denyReason.trim() })}
                                >
                                  Confirm Denial
                                </button>
                                <button type="button" className="adm-btn outline" onClick={() => setDenyTargetId(null)}>Back</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── error state ── */}
                {paymentsError && !paymentsLoading && (
                  <div className="adm-card" style={{ padding: '2.75rem 2rem', textAlign: 'center', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>⚠️</div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
                      Couldn't load payments
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.83rem', fontWeight: 300, color: 'var(--danger)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.65 }}>
                      {paymentsError}
                    </p>
                    <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button type="button" className="adm-btn outline" onClick={() => void loadPayments()}>Try Again</button>
                      {paymentsAuthError && <Link to="/login" className="adm-btn primary">Go to Sign In</Link>}
                    </div>
                  </div>
                )}

                {/* ── loading skeleton ── */}
                {paymentsLoading && (
                  <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                    <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ flex: 1 }}>
                          <div className="adm-skel" style={{ height: '0.9rem', width: '40%', marginBottom: '0.45rem' }} />
                          <div className="adm-skel" style={{ height: '0.6rem', width: '68%' }} />
                        </div>
                        <div className="adm-skel" style={{ height: '1.4rem', width: 84, borderRadius: 'var(--r-full)' }} />
                        <div className="adm-skel" style={{ height: '1.4rem', width: 70, borderRadius: 'var(--r-full)' }} />
                      </div>
                    ))}
                  </div>
                )}

                {!paymentsLoading && !paymentsError && (
                  filteredPayments.length === 0 ? (
                    <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                      {payments.length === 0 ? 'No customer payments recorded yet.' : 'No payments match this filter.'}
                    </div>
                  ) : (
                    filteredPayments.map((p) => {
                      const st = paymentStatusMeta(p.status);
                      const open = expandedPayment === p.id;
                      return (
                        <div key={p.id} className="adm-card" style={{ overflow: 'hidden' }}>
                          <button
                            type="button"
                            onClick={() => setExpandedPayment(open ? null : p.id)}
                            aria-expanded={open}
                            style={{
                              all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%',
                              padding: '1.3rem 1.5rem',
                              display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                                {p.customerName}
                              </div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                                {p.bookingName} · {p.method} · paid {fmtDateTime(p.paymentDateTime)}
                              </div>
                            </div>
                            {p.refundRequested && <StatusBadge label="Refund Requested" color="var(--accent)" />}
                            <StatusBadge label={st.label} color={st.color} />
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(p.amountPaid)}</span>
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>▼</span>
                          </button>

                          {open && (
                            <div style={{ borderTop: '1px solid var(--border)', padding: '1.15rem 1.5rem', background: 'var(--bg-subtle)' }}>
                              {[
                                { label: 'Customer', value: `${p.customerName} · ${p.customerEmail}` },
                                { label: 'Booking', value: `${p.bookingName}${p.eventType ? ` · ${p.eventType}` : ''} · event ${fmtDate(p.eventDate)}` },
                                { label: 'Method', value: p.gatewayProvider ? `${p.method} via ${p.gatewayProvider}` : p.method },
                                { label: 'Transaction Reference', value: p.transactionReference ?? '—' },
                                ...(p.refundedAmount > 0 ? [{ label: 'Refunded', value: fmt(p.refundedAmount) }] : []),
                              ].map((row) => (
                                <div key={row.label} className="adm-row" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.45rem 0', fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 300 }}>{row.label}</span>
                                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500, textAlign: 'right' }}>{row.value}</span>
                                </div>
                              ))}
                              {(p.status === 'Pending' ||
                                ((p.status === 'Success' || p.status === 'PartiallyRefunded') && p.amountPaid - p.refundedAmount > 0)) && (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                                  {p.status === 'Pending' && (
                                    <>
                                      <button
                                        type="button"
                                        className="adm-btn success"
                                        disabled={paymentActionBusy === p.id}
                                        onClick={() => void runPaymentAction(p.id, 'confirm')}
                                      >
                                        {paymentActionBusy === p.id ? 'Working…' : '✓ Confirm Received'}
                                      </button>
                                      <button
                                        type="button"
                                        className="adm-btn danger"
                                        disabled={paymentActionBusy === p.id}
                                        onClick={() => void runPaymentAction(p.id, 'reject')}
                                      >
                                        ✕ Reject
                                      </button>
                                    </>
                                  )}
                                  {(p.status === 'Success' || p.status === 'PartiallyRefunded') && p.amountPaid - p.refundedAmount > 0 && (
                                    <button
                                      type="button"
                                      className="adm-btn outline"
                                      disabled={paymentActionBusy === p.id}
                                      onClick={() => void runPaymentAction(p.id, 'refund')}
                                    >
                                      {paymentActionBusy === p.id ? 'Working…' : `Refund ${fmt(p.amountPaid - p.refundedAmount)}`}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )
                )}
              </div>
            )}

            {/* ══════════ AUDIT LOG (live backend data, Owner-only) ══════════ */}
            {tab === 'audit' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="adm-title">Audit Log</h2>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                      Live from the backend — <code style={{ fontSize: '0.66rem' }}>/api/Auditlogs</code> · Owner only
                    </p>
                  </div>
                  <button type="button" className="adm-btn outline" onClick={() => void loadAuditLogs(auditPage)} disabled={auditLoading}>
                    {auditLoading ? 'Refreshing…' : '↻ Refresh'}
                  </button>
                </div>

                {auditError && !auditLoading && (
                  <div className="adm-card" style={{ padding: '2.75rem 2rem', textAlign: 'center', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>⚠️</div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
                      Couldn't load the audit trail
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.83rem', fontWeight: 300, color: 'var(--danger)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.65 }}>
                      {auditError}
                    </p>
                    <button type="button" className="adm-btn outline" onClick={() => void loadAuditLogs(auditPage)}>Try Again</button>
                  </div>
                )}

                {auditLoading && (
                  <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                    <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ flex: 1 }}>
                          <div className="adm-skel" style={{ height: '0.9rem', width: '35%', marginBottom: '0.45rem' }} />
                          <div className="adm-skel" style={{ height: '0.6rem', width: '60%' }} />
                        </div>
                        <div className="adm-skel" style={{ height: '1.4rem', width: 84, borderRadius: 'var(--r-full)' }} />
                      </div>
                    ))}
                  </div>
                )}

                {!auditLoading && !auditError && (
                  <>
                    {auditRows.length === 0 ? (
                      <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                        {auditPage === 1 ? 'No audit entries recorded yet.' : 'No more entries.'}
                      </div>
                    ) : (
                      <div className="adm-card" style={{ padding: '0.4rem 1.5rem' }}>
                        {auditRows.map((row) => {
                          const actionColor =
                            row.action === 'CREATE' ? 'var(--primary)'
                            : row.action === 'DELETE' ? 'var(--danger)'
                            : 'var(--accent)';
                          return (
                            <div key={row.id} className="adm-row" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem 0' }}>
                              <div style={{ flex: 1, minWidth: 240 }}>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                  {row.targetTable}
                                  <span style={{ color: 'var(--text-dim)', fontWeight: 300 }}> · {row.targetId.substring(0, 8)}</span>
                                </div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                                  {fmtDateTime(row.changedAt)} · admin {row.adminId.substring(0, 8)}
                                </div>
                              </div>
                              <StatusBadge label={row.action} color={actionColor} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <button type="button" className="adm-btn outline" disabled={auditPage <= 1} onClick={() => void loadAuditLogs(auditPage - 1)}>
                        ‹ Newer
                      </button>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)' }}>Page {auditPage}</span>
                      <button type="button" className="adm-btn outline" disabled={auditRows.length < AUDIT_PAGE_SIZE} onClick={() => void loadAuditLogs(auditPage + 1)}>
                        Older ›
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══════════ PACKAGES ══════════ */}
            {tab === 'packages' && (
              <AdminPackagesTab />
            )}

            {/* ══════════ TESTIMONIALS ══════════ */}
            {tab === 'testimonials' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <h2 className="adm-title">Testimonial Moderation</h2>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                    {pendingTesti} pending review
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['pending', 'approved', 'rejected', 'all'] as const).map((k) => {
                    const count = k === 'all' ? testimonials.length : testimonials.filter((t) => t.status === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${testiFilter === k ? ' active' : ''}`} onClick={() => setTestiFilter(k)}>
                        {k === 'all' ? 'All' : TESTI_STATUS[k].label}
                        <span className="count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {filteredTesti.length === 0 ? (
                  <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    No testimonials in this view.
                  </div>
                ) : (
                  filteredTesti.map((t) => {
                    const st = TESTI_STATUS[t.status];
                    return (
                      <div key={t.id} className="adm-card" style={{ padding: '1.3rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                          <div
                            style={{
                              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                              background: 'var(--primary-muted)', border: '1px solid var(--border-accent)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)',
                            }}
                          >
                            {t.name.charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{t.name}</span>
                              <span style={{ color: 'var(--accent)', fontSize: '0.8rem' }}>
                                {'★'.repeat(t.rating)}
                                <span style={{ color: 'var(--border-strong)' }}>{'★'.repeat(5 - t.rating)}</span>
                              </span>
                            </div>
                            <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 0.4rem' }}>
                              "{t.body}"
                            </p>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                              Submitted {fmtDate(t.submittedAt)}
                            </span>
                          </div>
                          <StatusBadge label={st.label} color={st.color} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                          {t.status !== 'approved' && (
                            <button type="button" className="adm-btn success" onClick={() => setTestiStatus(t.id, 'approved')}>
                              ✓ Approve — publish to landing page
                            </button>
                          )}
                          {t.status !== 'rejected' && (
                            <button type="button" className="adm-btn danger" onClick={() => setTestiStatus(t.id, 'rejected')}>
                              ✕ {t.status === 'approved' ? 'Remove from landing page' : 'Reject'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ══════════ MENUS & DISHES (live backend data) ══════════ */}
            {tab === 'menus' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="adm-title">Menus &amp; Dishes</h2>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                      Live from the backend — <code style={{ fontSize: '0.66rem' }}>/api/Menuitems</code> · <code style={{ fontSize: '0.66rem' }}>/api/Menutrays</code>
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="adm-btn primary" onClick={() => openMenuForm('item', 'create')}>
                      + Add Dish
                    </button>
                    <button type="button" className="adm-btn success" onClick={() => openMenuForm('tray', 'create')}>
                      + Add Tray
                    </button>
                    <button type="button" className="adm-btn outline" onClick={() => void loadMenuCatalog()} disabled={menuLoading}>
                      {menuLoading ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>
                </div>

                {/* ── error state ── */}
                {menuError && !menuLoading && (
                  <div className="adm-card" style={{ padding: '2.75rem 2rem', textAlign: 'center', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>⚠️</div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
                      Couldn't load the menu catalog
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.83rem', fontWeight: 300, color: 'var(--danger)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.65 }}>
                      {menuError}
                    </p>
                    <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button type="button" className="adm-btn outline" onClick={() => void loadMenuCatalog()}>Try Again</button>
                      {menuAuthError && <Link to="/login" className="adm-btn primary">Go to Sign In</Link>}
                    </div>
                  </div>
                )}

                {/* ── loading skeleton ── */}
                {menuLoading && (
                  <>
                    <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                      <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ flex: 1 }}>
                            <div className="adm-skel" style={{ height: '0.9rem', width: '40%', marginBottom: '0.45rem' }} />
                            <div className="adm-skel" style={{ height: '0.6rem', width: '68%' }} />
                          </div>
                          <div className="adm-skel" style={{ height: '1.4rem', width: 84, borderRadius: 'var(--r-full)' }} />
                          <div className="adm-skel" style={{ height: '1.4rem', width: 70, borderRadius: 'var(--r-full)' }} />
                        </div>
                      ))}
                    </div>
                    <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                      <div className="adm-skel" style={{ height: '0.8rem', width: 110, marginBottom: '1.2rem' }} />
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
                        {[0, 1, 2].map((i) => <div key={i} className="adm-skel" style={{ height: 140, borderRadius: 'var(--r-xl)' }} />)}
                      </div>
                    </div>
                  </>
                )}

                {/* ── data ── */}
                {!menuLoading && !menuError && (
                  <>
                    {/* dishes */}
                    <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
                        <div>
                          <FieldLabel text="Menu Items" />
                          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                            Dishes ({visibleMenuItems.length})
                          </h3>
                        </div>
                        {menuCategories.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button type="button" className={`adm-pill${menuCategory === 'all' ? ' active' : ''}`} onClick={() => setMenuCategory('all')}>
                              All<span className="count">{menuItems.length}</span>
                            </button>
                            {menuCategories.map((c) => (
                              <button key={c} type="button" className={`adm-pill${menuCategory === c ? ' active' : ''}`} onClick={() => setMenuCategory(c)}>
                                {c}<span className="count">{menuItems.filter((m) => m.itemCategory === c).length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {menuItems.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                          The catalog is empty — no menu items have been created yet.
                        </p>
                      ) : visibleMenuItems.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                          No dishes in this category.
                        </p>
                      ) : (
                        visibleMenuItems.map((m) => (
                          <div key={m.id} className="adm-row" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 0', flexWrap: 'wrap', opacity: m.isActive ? 1 : 0.55 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 'var(--r-lg)', overflow: 'hidden', flexShrink: 0, background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {m.imageUrl ? (
                                <img src={getFullImageUrl(m.imageUrl)!} alt={m.itemName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ fontSize: '1.4rem' }}>🍽️</span>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 200 }}>
                              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem', fontWeight: 500, color: 'var(--text-primary)' }}>{m.itemName}</div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: 1.5 }}>{m.description}</div>
                              {m.dietaryTags.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                                  {m.dietaryTags.map((t) => (
                                    <span key={t} style={{ fontFamily: 'var(--font-body)', fontSize: '0.56rem', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--accent)', background: 'var(--accent-muted)', border: '1px solid var(--border-accent)', borderRadius: 'var(--r-full)', padding: '0.12rem 0.5rem' }}>
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <StatusBadge label={m.itemCategory} color="var(--primary)" />
                            <StatusBadge label={m.courseCategory} color="#4a90d9" />
                            <div style={{ textAlign: 'right', minWidth: 96 }}>
                              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>
                                {m.pricePerTray != null ? fmt(m.pricePerTray) : '—'}
                              </div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                                per tray · serves {m.servesPerTray}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                              <StatusBadge label={m.isActive ? 'Active' : 'Inactive'} color={m.isActive ? 'var(--primary)' : 'var(--danger)'} />
                              <button
                                type="button"
                                className="adm-btn info"
                                onClick={() => openMenuForm('item', 'edit', {
                                  itemName: m.itemName,
                                  itemCategory: m.itemCategory,
                                  courseCategory: m.courseCategory,
                                  description: m.description,
                                  dietaryTags: m.dietaryTags,
                                  pricePerTray: m.pricePerTray,
                                  servesPerTray: m.servesPerTray,
                                  menuPackageId: m.menuPackageId,
                                  imageUrl: m.imageUrl,
                                }, m.id)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="adm-btn danger"
                                onClick={() => deactivateMenuEntry('item', m.id)}
                                disabled={!m.isActive}
                              >
                                Deactivate
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* trays */}
                    <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                      <div style={{ marginBottom: '1rem' }}>
                        <FieldLabel text="Menu Trays" />
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                          Party Trays ({menuTrays.length})
                        </h3>
                      </div>
                      {menuTrays.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                          No trays configured yet.
                        </p>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                          {menuTrays.map((t) => (
                            <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '1.1rem 1.2rem', background: 'var(--bg-subtle)', opacity: t.isActive ? 1 : 0.55 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '0.5rem' }}>
                                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-primary)' }}>{t.trayName}</span>
                                <StatusBadge label={t.isActive ? 'Active' : 'Inactive'} color={t.isActive ? 'var(--primary)' : 'var(--danger)'} />
                              </div>
                              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600, color: 'var(--primary)', lineHeight: 1 }}>{fmt(t.pricePerTray)}</div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)', margin: '0.25rem 0 0.75rem' }}>
                                per tray · serves {t.servesMin}–{t.servesMax}
                              </div>
                              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.85rem' }}>
                                <button
                                  type="button"
                                  className="adm-btn info"
                                  onClick={() => openMenuForm('tray', 'edit', {
                                    trayName: t.trayName,
                                    pricePerTray: t.pricePerTray,
                                    servesMin: t.servesMin,
                                    servesMax: t.servesMax,
                                    dishItemIds: t.dishes.map((d) => d.id),
                                  }, t.id)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="adm-btn danger"
                                  onClick={() => deactivateMenuEntry('tray', t.id)}
                                  disabled={!t.isActive}
                                >
                                  Deactivate
                                </button>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {t.dishes.map((d) => (
                                  <span
                                    key={d.id}
                                    title={`${d.itemCategory} · ${d.courseCategory}`}
                                    style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 500, color: 'var(--primary)', background: 'var(--primary-muted)', border: '1px solid var(--border-accent)', borderRadius: 'var(--r-full)', padding: '0.2rem 0.6rem' }}
                                  >
                                    {d.itemName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {menuFormOpen && (
                  <div className="adm-modal-overlay" onClick={closeMenuForm}>
                    <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={menuFormMode === 'item' ? 'Menu item form' : 'Menu tray form'}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                        <div>
                          <h3>{menuFormAction === 'edit' ? 'Edit' : 'Add'} {menuFormMode === 'item' ? 'Dish' : 'Tray'}</h3>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                            {menuFormMode === 'item'
                              ? 'Create or update a menu dish entry and sync it with the backend.'
                              : 'Create or update a party tray with associated dishes.'}
                          </p>
                        </div>
                        <button type="button" className="adm-btn outline" onClick={closeMenuForm} style={{ height: '2.3rem' }}>
                          Close
                        </button>
                      </div>

                      {menuSuccess && (
                        <div style={{ padding: '0.9rem 1rem', borderRadius: 'var(--r-lg)', background: 'var(--primary-muted)', border: '1px solid var(--border-accent)', marginBottom: '1rem', color: 'var(--primary)' }}>
                          {menuSuccess}
                        </div>
                      )}

                      <div className="adm-modal-panel form-grid full">
                        {menuFormMode === 'item' && menuFormItem && (
                          <>
                            <div className="form-row">
                              <label htmlFor="menu-item-name">Dish name</label>
                              <input
                                id="menu-item-name"
                                className="adm-input"
                                value={menuFormItem.itemName}
                                onChange={(e) => updateMenuFormItem({ itemName: e.target.value })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-item-category">Category</label>
                              <input
                                id="menu-item-category"
                                className="adm-input"
                                value={menuFormItem.itemCategory}
                                onChange={(e) => updateMenuFormItem({ itemCategory: e.target.value })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-item-course">Course</label>
                              <input
                                id="menu-item-course"
                                className="adm-input"
                                value={menuFormItem.courseCategory}
                                onChange={(e) => updateMenuFormItem({ courseCategory: e.target.value })}
                              />
                            </div>
                            <div className="form-row full">
                              <label htmlFor="menu-item-description">Description</label>
                              <textarea
                                id="menu-item-description"
                                className="adm-input square"
                                rows={4}
                                value={menuFormItem.description}
                                onChange={(e) => updateMenuFormItem({ description: e.target.value })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-item-tags">Dietary tags</label>
                              <input
                                id="menu-item-tags"
                                className="adm-input"
                                value={menuFormItem.dietaryTags.join(', ')}
                                onChange={(e) => updateMenuFormItem({ dietaryTags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-item-price">Price per tray</label>
                              <input
                                id="menu-item-price"
                                className="adm-input"
                                type="number"
                                min={0}
                                value={menuFormItem.pricePerTray ?? ''}
                                onChange={(e) => updateMenuFormItem({ pricePerTray: e.target.value === '' ? null : Number(e.target.value) })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-item-serves">Serves per tray</label>
                              <input
                                id="menu-item-serves"
                                className="adm-input"
                                type="number"
                                min={1}
                                value={menuFormItem.servesPerTray}
                                onChange={(e) => updateMenuFormItem({ servesPerTray: Number(e.target.value) || 1 })}
                              />
                            </div>
                            <div className="form-row full">
                              <label htmlFor="menu-item-package">Package ID (optional)</label>
                              <input
                                id="menu-item-package"
                                className="adm-input"
                                value={menuFormItem.menuPackageId ?? ''}
                                onChange={(e) => updateMenuFormItem({ menuPackageId: e.target.value.trim() || null })}
                              />
                            </div>
                            <div className="form-row full">
                              <label htmlFor="menu-item-image">Dish Photo (File Upload)</label>
                              <input
                                id="menu-item-image"
                                type="file"
                                accept="image/*"
                                className="adm-input square"
                                onChange={handleMenuFileChange}
                                style={{ padding: '0.45rem' }}
                              />
                              {menuImagePreview ? (
                                <div style={{ marginTop: '0.65rem', padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                  <img
                                    src={menuImagePreview}
                                    alt="Dish Preview"
                                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                      {menuFormItem.imageFile ? menuFormItem.imageFile.name : 'Current Server Image'}
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                                      {menuFormItem.imageFile
                                        ? `${(menuFormItem.imageFile.size / 1024 / 1024).toFixed(2)} MB`
                                        : 'Stored on backend server'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="adm-btn danger"
                                    style={{ fontSize: '0.58rem', padding: '0.35rem 0.75rem' }}
                                    onClick={clearMenuImage}
                                  >
                                    Remove Photo
                                  </button>
                                </div>
                              ) : (
                                <div style={{ marginTop: '0.4rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                                  No image selected yet. Select a photo file (JPG, PNG, WEBP, etc.) to upload.
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {menuFormMode === 'tray' && menuFormTray && (
                          <>
                            <div className="form-row">
                              <label htmlFor="menu-tray-name">Tray name</label>
                              <input
                                id="menu-tray-name"
                                className="adm-input"
                                value={menuFormTray.trayName}
                                onChange={(e) => updateMenuFormTray({ trayName: e.target.value })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-tray-price">Price per tray</label>
                              <input
                                id="menu-tray-price"
                                className="adm-input"
                                type="number"
                                min={0}
                                step={0.01}
                                value={menuFormTray.pricePerTray}
                                onChange={(e) => updateMenuFormTray({ pricePerTray: Number(e.target.value) })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-tray-serves-min">Serves min</label>
                              <input
                                id="menu-tray-serves-min"
                                className="adm-input"
                                type="number"
                                min={1}
                                value={menuFormTray.servesMin}
                                onChange={(e) => updateMenuFormTray({ servesMin: Number(e.target.value) || 1 })}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="menu-tray-serves-max">Serves max</label>
                              <input
                                id="menu-tray-serves-max"
                                className="adm-input"
                                type="number"
                                min={1}
                                value={menuFormTray.servesMax}
                                onChange={(e) => updateMenuFormTray({ servesMax: Number(e.target.value) || 1 })}
                              />
                            </div>
                            <div className="form-row full">
                              <label>Tray dishes</label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.6rem', maxHeight: '240px', overflowY: 'auto', padding: '0.6rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)' }}>
                                {menuItems.map((item) => {
                                  const checked = menuFormTray.dishItemIds?.includes(item.id) ?? false;
                                  return (
                                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.78rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...(menuFormTray.dishItemIds || []), item.id]
                                            : (menuFormTray.dishItemIds || []).filter((dishId) => dishId !== item.id);
                                          updateMenuFormTray({ dishItemIds: next });
                                        }}
                                      />
                                      {item.itemName}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="form-actions">
                        <button type="button" className="adm-btn outline" onClick={closeMenuForm}>
                          Cancel
                        </button>
                        <button type="button" className="adm-btn primary" onClick={saveMenuForm} disabled={menuSaving}>
                          {menuSaving ? 'Saving…' : menuFormAction === 'edit' ? 'Save changes' : 'Create entry'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ══════════ RENTALS (live backend data) ══════════ */}
            {tab === 'rentals' && (
                  <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                      <div>
                        <h2 className="adm-title">Rentals</h2>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                          Manage party rental equipment and sync changes with the C# backend.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" className="adm-btn primary" onClick={() => openRentalForm('create')}>
                          + Add Rental Item
                        </button>
                        <button type="button" className="adm-btn outline" onClick={() => void loadRentalCatalog()} disabled={rentalsLoading}>
                          {rentalsLoading ? 'Refreshing…' : '↻ Refresh'}
                        </button>
                      </div>
                    </div>

                    {rentalFeedback && (
                      <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--primary)' }}>{rentalFeedback}</div>
                      </div>
                    )}

                    {rentalsError && !rentalsLoading && (
                      <div className="adm-card" style={{ padding: '2.75rem 2rem', textAlign: 'center', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>⚠️</div>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
                          Rental inventory unavailable
                        </h3>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.83rem', fontWeight: 300, color: 'var(--danger)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.65 }}>
                          {rentalsError}
                        </p>
                        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button type="button" className="adm-btn outline" onClick={() => void loadRentalCatalog()}>Try Again</button>
                        </div>
                      </div>
                    )}

                    {rentalsLoading && (
                      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                        <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
                        {[0, 1, 2].map((index) => (
                          <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: index < 2 ? '1px solid var(--border)' : 'none' }}>
                            <div className="adm-skel" style={{ height: '1rem', width: '30%' }} />
                            <div className="adm-skel" style={{ height: '1rem', width: '18%' }} />
                            <div className="adm-skel" style={{ height: '1rem', width: '18%' }} />
                            <div className="adm-skel" style={{ height: '1rem', width: '18%' }} />
                          </div>
                        ))}
                      </div>
                    )}

                    {!rentalsLoading && !rentalsError && (
                      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
                          <div>
                            <FieldLabel text="Rental Inventory" />
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                              Items ({rentalItems.length})
                            </h3>
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)' }}>
                            {rentalItems.filter((item) => item.isActive).length} active
                          </div>
                        </div>
                        {rentalItems.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            No rental inventory items are configured yet.
                          </p>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                              <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Image</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Name</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Category</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Total</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Out</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Available</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Unit Price</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Status</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rentalItems.map((item) => (
                                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', opacity: item.isActive ? 1 : 0.6 }}>
                                    <td style={{ padding: '0.75rem 0.7rem', verticalAlign: 'middle' }}>
                                      <div style={{ width: 48, height: 48, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {item.imageUrl ? (
                                          <img src={getFullImageUrl(item.imageUrl)!} alt={item.itemName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                          <span style={{ fontSize: '1.2rem' }}>🎪</span>
                                        )}
                                      </div>
                                    </td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle' }}>
                                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>{item.itemName}</div>
                                    </td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle', color: 'var(--text-muted)', fontSize: '0.88rem' }}>{item.category}</td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle', fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontWeight: 600 }}>{item.totalQuantity}</td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle', fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontWeight: 600 }}>{item.quantityOut}</td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle', fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontWeight: 600 }}>{item.stock}</td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle', fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontWeight: 600 }}>{fmt(item.unitPrice)}</td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle' }}>
                                      <StatusBadge label={item.isActive ? 'Active' : 'Inactive'} color={item.isActive ? 'var(--primary)' : 'var(--danger)'} />
                                    </td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle' }}>
                                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                        <button type="button" className="adm-btn info" onClick={() => openRentalForm('edit', item)}>
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          className={`adm-btn ${item.isActive ? 'danger' : 'success'}`}
                                          onClick={() => void toggleRentalActive(item)}
                                          disabled={rentalSaving}
                                        >
                                          {item.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {rentalFormOpen && (
                      <div className="adm-modal-overlay" onClick={closeRentalForm}>
                        <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rental item form">
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                            <div>
                              <h3>{rentalFormMode === 'edit' ? 'Edit' : 'Add'} Rental Item</h3>
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                                {rentalFormMode === 'edit'
                                  ? 'Update the rental item and toggle whether it is active in the catalog.'
                                  : 'Create a new rental inventory item for Rentals management.'}
                              </p>
                            </div>
                            <button type="button" className="adm-btn outline" onClick={closeRentalForm} style={{ height: '2.3rem' }}>
                              Close
                            </button>
                          </div>

                          {rentalFormError && (
                            <div style={{ padding: '0.8rem 0.9rem', marginBottom: '1rem', borderRadius: 'var(--r-lg)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
                              {rentalFormError}
                            </div>
                          )}

                          <div className="adm-modal-panel form-grid full">
                            <div className="form-row">
                              <label htmlFor="rental-item-name">Item name</label>
                              <input
                                id="rental-item-name"
                                className="adm-input"
                                value={rentalFormItem.itemName}
                                onChange={(e) => setRentalFormItem((prev) => ({ ...prev, itemName: e.target.value }))}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="rental-item-category">Category</label>
                              <select
                                id="rental-item-category"
                                className="adm-input"
                                value={rentalFormItem.category}
                                onChange={(e) => setRentalFormItem((prev) => ({ ...prev, category: e.target.value }))}
                              >
                                <option value="">Select a category</option>
                                {rentalCategoryOptions.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </div>
                            <div className="form-row">
                              <label htmlFor="rental-item-total">Total quantity</label>
                              <input
                                id="rental-item-total"
                                className="adm-input"
                                type="number"
                                min={1}
                                value={rentalFormItem.totalQuantity}
                                onChange={(e) => setRentalFormItem((prev) => ({ ...prev, totalQuantity: Number(e.target.value) || 1 }))}
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="rental-item-price">Unit price</label>
                              <input
                                id="rental-item-price"
                                className="adm-input"
                                type="number"
                                min={0}
                                step={0.01}
                                value={rentalFormItem.unitPrice}
                                onChange={(e) => setRentalFormItem((prev) => ({ ...prev, unitPrice: Number(e.target.value) || 0 }))}
                              />
                            </div>
                            {rentalFormMode === 'edit' && (
                              <div className="form-row" style={{ alignItems: 'center' }}>
                                <label htmlFor="rental-item-active">Active</label>
                                <input
                                  id="rental-item-active"
                                  type="checkbox"
                                  checked={Boolean((rentalFormItem as AdminRentalItemUpdate).isActive)}
                                  onChange={(e) => setRentalFormItem((prev) => ({ ...prev, isActive: e.target.checked }))}
                                />
                              </div>
                            )}
                            <div className="form-row full">
                              <label htmlFor="rental-item-image">Rental Photo (File Upload)</label>
                              <input
                                id="rental-item-image"
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="adm-input square"
                                onChange={handleRentalFileChange}
                                style={{ padding: '0.45rem' }}
                              />
                              {rentalImagePreview ? (
                                <div style={{ marginTop: '0.6rem', padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                  <img
                                    src={rentalImagePreview}
                                    alt="Rental Preview"
                                    style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                      {rentalFormItem.imageFile ? rentalFormItem.imageFile.name : 'Current Image'}
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                                      {rentalFormItem.imageFile
                                        ? `${(rentalFormItem.imageFile.size / 1024 / 1024).toFixed(2)} MB`
                                        : 'Stored on backend server'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="adm-btn danger"
                                    style={{ fontSize: '0.55rem', padding: '0.35rem 0.7rem' }}
                                    onClick={clearRentalImage}
                                  >
                                    Remove Photo
                                  </button>
                                </div>
                              ) : (
                                <div style={{ marginTop: '0.4rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                                  No photo uploaded yet. Supported formats: JPG, PNG, WEBP (Max 5MB).
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="form-actions">
                            <button type="button" className="adm-btn outline" onClick={closeRentalForm}>
                              Cancel
                            </button>
                            <button type="button" className="adm-btn primary" onClick={() => void saveRentalItem()} disabled={rentalSaving || !rentalFormValid}>
                              {rentalSaving ? 'Saving…' : rentalFormMode === 'edit' ? 'Save changes' : 'Create item'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ══════════ SERVICE ITEMS (live backend data) ══════════ */}
                {tab === 'services' && (
                  <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                      <div>
                        <h2 className="adm-title">Service Items</h2>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                          Manage event service offerings (e.g., sound systems, DJs, photo booths) and sync with the C# backend.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" className="adm-btn primary" onClick={() => openServiceForm('create')}>
                          + Add Service Item
                        </button>
                        <button type="button" className="adm-btn outline" onClick={() => void loadServiceCatalog()} disabled={servicesLoading}>
                          {servicesLoading ? 'Refreshing…' : '↻ Refresh'}
                        </button>
                      </div>
                    </div>

                    {serviceFeedback && (
                      <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--primary)' }}>{serviceFeedback}</div>
                      </div>
                    )}

                    {servicesError && !servicesLoading && (
                      <div className="adm-card" style={{ padding: '2.75rem 2rem', textAlign: 'center', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>⚠️</div>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
                          Service catalog unavailable
                        </h3>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.83rem', fontWeight: 300, color: 'var(--danger)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.65 }}>
                          {servicesError}
                        </p>
                        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button type="button" className="adm-btn outline" onClick={() => void loadServiceCatalog()}>Try Again</button>
                        </div>
                      </div>
                    )}

                    {servicesLoading && (
                      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                        <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
                        {[0, 1, 2].map((index) => (
                          <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: index < 2 ? '1px solid var(--border)' : 'none' }}>
                            <div className="adm-skel" style={{ height: '1rem', width: '35%' }} />
                            <div className="adm-skel" style={{ height: '1rem', width: '20%' }} />
                            <div className="adm-skel" style={{ height: '1rem', width: '20%' }} />
                            <div className="adm-skel" style={{ height: '1rem', width: '20%' }} />
                          </div>
                        ))}
                      </div>
                    )}

                    {!servicesLoading && !servicesError && (
                      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
                          <div>
                            <FieldLabel text="Service Offerings" />
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                              Services ({serviceItems.length})
                            </h3>
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)' }}>
                            {serviceItems.filter((item) => item.isActive).length} active
                          </div>
                        </div>
                        {serviceItems.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            No service items configured yet.
                          </p>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                              <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Service Name</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Unit Cost</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Status</th>
                                  <th style={{ padding: '0.95rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {serviceItems.map((item) => (
                                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', opacity: item.isActive ? 1 : 0.6 }}>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle' }}>
                                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.98rem', fontWeight: 500, color: 'var(--text-primary)' }}>{item.serviceName}</div>
                                    </td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle', fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--primary)' }}>
                                      {fmt(item.unitCost)}
                                    </td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle' }}>
                                      <StatusBadge label={item.isActive ? 'Active' : 'Inactive'} color={item.isActive ? 'var(--primary)' : 'var(--danger)'} />
                                    </td>
                                    <td style={{ padding: '0.95rem 0.7rem', verticalAlign: 'middle' }}>
                                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                        <button type="button" className="adm-btn info" onClick={() => openServiceForm('edit', item)}>
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          className={`adm-btn ${item.isActive ? 'danger' : 'success'}`}
                                          onClick={() => void toggleServiceActive(item)}
                                          disabled={serviceSaving}
                                        >
                                          {item.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {serviceFormOpen && (
                      <div className="adm-modal-overlay" onClick={closeServiceForm}>
                        <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Service item form">
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                            <div>
                              <h3>{serviceFormMode === 'edit' ? 'Edit' : 'Add'} Service Item</h3>
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                                {serviceFormMode === 'edit'
                                  ? 'Update service details or toggle whether it is active for customer bookings.'
                                  : 'Create a new service offering for event bookings.'}
                              </p>
                            </div>
                            <button type="button" className="adm-btn outline" onClick={closeServiceForm} style={{ height: '2.3rem' }}>
                              Close
                            </button>
                          </div>

                          {serviceFormError && (
                            <div style={{ padding: '0.8rem 0.9rem', marginBottom: '1rem', borderRadius: 'var(--r-lg)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
                              {serviceFormError}
                            </div>
                          )}

                          <div className="adm-modal-panel form-grid full">
                            <div className="form-row">
                              <label htmlFor="service-item-name">Service Name</label>
                              <input
                                id="service-item-name"
                                className="adm-input"
                                value={serviceFormItem.serviceName}
                                onChange={(e) => setServiceFormItem((prev) => ({ ...prev, serviceName: e.target.value }))}
                                placeholder="e.g. Sound System & Lighting Package"
                              />
                            </div>
                            <div className="form-row">
                              <label htmlFor="service-item-cost">Unit Cost (₱)</label>
                              <input
                                id="service-item-cost"
                                className="adm-input"
                                type="number"
                                min={0}
                                step={0.01}
                                value={serviceFormItem.unitCost}
                                onChange={(e) => setServiceFormItem((prev) => ({ ...prev, unitCost: Number(e.target.value) || 0 }))}
                              />
                            </div>
                            {serviceFormMode === 'edit' && (
                              <div className="form-row" style={{ alignItems: 'center' }}>
                                <label htmlFor="service-item-active">Active</label>
                                <input
                                  id="service-item-active"
                                  type="checkbox"
                                  checked={Boolean((serviceFormItem as AdminServiceItemUpdate).isActive)}
                                  onChange={(e) => setServiceFormItem((prev) => ({ ...prev, isActive: e.target.checked }))}
                                />
                              </div>
                            )}
                          </div>

                          <div className="form-actions">
                            <button type="button" className="adm-btn outline" onClick={closeServiceForm}>
                              Cancel
                            </button>
                            <button type="button" className="adm-btn primary" onClick={() => void saveServiceItem()} disabled={serviceSaving || !serviceFormValid}>
                              {serviceSaving ? 'Saving…' : serviceFormMode === 'edit' ? 'Save changes' : 'Create service'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
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
                  <div style={{ fontSize: '1.8rem', color: 'var(--text-dim)', marginBottom: '0.8rem' }}>◌</div>
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
