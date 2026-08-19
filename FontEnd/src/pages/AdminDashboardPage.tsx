import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { useAuth } from '../hooks/useAuth';
import { readSession } from '../lib/tokenStorage';
import {
  fetchMenuItems,
  fetchMenuTrays,
  createMenuItem,
  updateMenuItem,
  deactivateMenuItem,
  reactivateMenuItem,
  createMenuTray,
  updateMenuTray,
  deactivateMenuTray,
  reactivateMenuTray,
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
  setBookingAdminNote,
  getBookingDetail,
  getBookingHistory,
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
  type BookingCreatePayload,
  type BookingDetailResponse,
  type BookingHistoryEntry,
  type InvoiceResponseDto,
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
  attachmentUrl,
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
import {
  getBookingRules,
  getCalendarDays,
  setDayLock,
  toDateKey,
  CalendarApiError,
  type BookingRules,
  type CalendarDay,
} from '../api/calendarApi';
import { PhoneNumberInput } from '../components/forms/PhoneNumberInput';
import { VenueAddressFields } from '../components/forms/VenueAddressFields';
import { isCompletePhPhone, toE164 } from '../lib/phone';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  type VenueAddress,
} from '../lib/venue';
import {
  getMonthlySales,
  getMonthlySalesSummary,
  ReportsApiError,
  type MonthlySalesReport,
  type MonthlySalesSummary,
} from '../api/reportsApi';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notificationTarget,
  type AppNotification,
} from '../api/notificationsApi';
import {
  getTestimonials,
  moderateTestimonial,
  TestimonialApiError,
  type Testimonial,
  type TestimonialStatus,
} from '../api/testimonialsApi';
import {
  getAnnouncements,
  postAnnouncement,
  AnnouncementApiError,
  type Announcement,
} from '../api/announcementsApi';
import { CashPaymentModal } from '../components/admin/CashPaymentModal';
import { DraftItemsEditor } from '../components/admin/DraftItemsEditor';
import EventResourcesModal from '../components/admin/EventResourcesModal';
import { ToastViewport, useToasts } from '../components/ui/Toasts';

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

/* Fallback identity; the signed-in admin account takes precedence. */
const FALLBACK_ADMIN = { name: 'Chris Paul', role: 'Administrator' };

type ResStatus = 'Draft' | 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';

/** Sort order for the Bookings tab list. */
type ResSort = 'date_asc' | 'date_desc';



/* Testimonials and the revenue trend used to be hardcoded arrays here. Both now come
   from the backend — see /api/Testimonials and /api/Reports/monthly-sales. */

/** How many whole months the Revenue Trend chart covers. */
const SALES_MONTHS = 6;

/* ─────────────────────────────────────────────────────────────────────────
   Booking-history snapshots (item 3a)

   Bookingservice.WriteHistorySnapshotAsync serializes a plain anonymous object with
   JsonSerializer.Serialize(snapshot) — no options — so keys are PascalCase and enums
   arrive as their NUMERIC values. These maps decode them back to the labels the rest
   of the dashboard uses; the ordinals mirror the enums in Models/Booking.cs.
───────────────────────────────────────────────────────────────────────── */

const SNAPSHOT_ENUMS: Record<string, string[]> = {
  BookingType: ['Full Service', 'Food Delivery'],
  EventType: ['Wedding', 'Corporate', 'Birthday', 'Others'],
  Status: ['Draft', 'Pending', 'Confirmed', 'Cancelled', 'Completed'],
  DepositStatus: ['Unpaid', 'Reserved', 'Partial', 'Paid'],
};

/** Human labels for the snapshot's PascalCase keys. */
const SNAPSHOT_LABELS: Record<string, string> = {
  BookingName: 'Booking name',
  BookingType: 'Booking type',
  EventDate: 'Event date',
  StartTime: 'Start time',
  EndDate: 'End date',
  EndTime: 'End time',
  EventType: 'Event type',
  VenueAddress: 'Venue',
  GuestCount: 'Guests',
  Status: 'Status',
  DepositStatus: 'Deposit',
  TotalAmount: 'Total',
  MenuPackageId: 'Package',
};

type Snapshot = Record<string, unknown>;

function parseSnapshot(json: string): Snapshot | null {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Snapshot) : null;
  } catch {
    return null;
  }
}

/** Renders one snapshot value the way the dashboard shows that field elsewhere. */
function snapshotValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  const labels = SNAPSHOT_ENUMS[key];
  if (labels && typeof value === 'number') return labels[value] ?? String(value);

  if (key === 'TotalAmount' && typeof value === 'number') return fmt(value);
  if (key === 'MenuPackageId') return typeof value === 'string' ? `${value.slice(0, 8)}…` : '—';
  if ((key === 'EventDate' || key === 'EndDate') && typeof value === 'string') return fmtDate(value);
  if ((key === 'StartTime' || key === 'EndTime') && typeof value === 'string') return value.substring(0, 5);

  return String(value);
}

/**
 * Fields that differ between two snapshots. Revision N holds the state BEFORE the
 * change that produced revision N+1, so diffing consecutive rows is what actually
 * says "this is what changed" — a single snapshot on its own only says "this is how
 * it looked".
 */
function diffSnapshots(before: Snapshot | null, after: Snapshot | null) {
  if (!before || !after) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => ({
      key: k,
      label: SNAPSHOT_LABELS[k] ?? k,
      from: snapshotValue(k, before[k]),
      to: snapshotValue(k, after[k]),
    }));
}

/** The current booking, shaped like a snapshot, so the newest revision can diff against it. */
function bookingAsSnapshot(b: BookingResponse): Snapshot {
  const idx = (labels: string[], v: string | null) => (v === null ? null : labels.indexOf(v));
  return {
    BookingName: b.bookingName,
    BookingType: idx(['FullService', 'FoodDelivery'], b.bookingType),
    EventDate: b.eventDate,
    StartTime: b.startTime,
    EndDate: b.endDate,
    EndTime: b.endTime,
    EventType: idx(['Wedding', 'Corporate', 'Birthday', 'Others'], b.eventType),
    VenueAddress: b.venueAddress,
    GuestCount: b.guestCount,
    Status: idx(['Draft', 'Pending', 'Confirmed', 'Cancelled', 'Completed'], b.status),
    DepositStatus: idx(['Unpaid', 'Reserved', 'Partial', 'Paid'], b.depositStatus),
    TotalAmount: b.totalAmount,
    MenuPackageId: b.menuPackageId,
  };
}

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

const TESTI_STATUS: Record<TestimonialStatus, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--accent)' },
  Approved: { label: 'Approved', color: 'var(--primary)' },
  Rejected: { label: 'Rejected', color: 'var(--danger)' },
};

export const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`;
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

/**
 * "14:30:00" → "2:30 PM". TimeOnly arrives as HH:mm:ss, which isn't a date, so it's
 * parsed positionally. Null/absent renders as an em dash.
 */
const fmtTime = (hms: string | null | undefined) => {
  if (!hms) return '—';
  const [h, m] = hms.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
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

type Tab = 'overview' | 'bookings' | 'payments' | 'packages' | 'menus' | 'rentals' | 'services' | 'testimonials' | 'histories' | 'audit' | 'announcements' | 'placeholder';

/** The sidebar's "Booking Histories" link routes here rather than switching tabs in place. */
const HISTORIES_PATH = '/admin/booking-histories';

/* "Announcements" used to live here — it's a real tab now, backed by
   /api/Announcements. */
const PLACEHOLDER_ITEMS = ['Chat Support'];

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

  const [bookingType, setBookingType] = useState<BookingTypeName>('FullService');
  const [eventType, setEventType] = useState('Wedding');
  const [guests, setGuests] = useState('100');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState<VenueAddress>(emptyVenueAddress);
  const [contact, setContact] = useState('');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  /**
   * Which types need the event fields (end date/time, event type, guest count).
   *
   * Deliberately "not a delivery" rather than "is FullService": RentalService is
   * event-dated too, and the backend's BookingCreateDto.Validate() requires those
   * fields for anything that isn't FoodDelivery. Testing for FullService here hid
   * the inputs for a rental and then posted nulls the server rejects.
   */
  const isFull = bookingType !== 'FoodDelivery';
  const toHms = (t: string) => (t.length === 5 ? `${t}:00` : t);

  /* Walk-ins go through the same Bookingservice.CreateAsync as the customer wizard, so
     the same lead-time rule applies. Fetched rather than hardcoded — it's an
     owner-editable setting. A failed fetch leaves the picker unconstrained and the
     server as the only gate, which is how it behaved before. */
  const [leadRules, setLeadRules] = useState<BookingRules | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBookingRules()
      .then((r) => { if (!cancelled) setLeadRules(r); })
      .catch(() => { if (!cancelled) setLeadRules(null); });
    return () => { cancelled = true; };
  }, []);

  // RentalService follows the full-service lead time; only FoodDelivery is shorter.
  const earliestDate = isFull
    ? leadRules?.earliestFullServiceDate
    : leadRules?.earliestDeliveryDate;
  const leadDays = isFull ? leadRules?.minLeadDaysFullService : leadRules?.minLeadDaysDelivery;
  const dateTooSoon = Boolean(eventDate) && Boolean(earliestDate) && eventDate < earliestDate!;

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

    if (!eventDate || !startTime || !isVenueAddressComplete(venue)) { setError('Fill in date, time, and the venue street and city.'); return; }
    if (dateTooSoon) {
      setError(`This booking type needs ${leadDays} day(s) of notice — the earliest date is ${fmtDate(earliestDate!)}.`);
      return;
    }
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
        if (!wName.trim() || !wEmail.trim() || !isCompletePhPhone(wPhone)) { setError('Fill in the walk-in name, email, and a complete phone number.'); setCreating(false); return; }
        // WalkInCustomerDto enforces E.164, so the display mask is stripped here.
        const made = await createWalkInCustomer(session.token, { fullName: wName.trim(), email: wEmail.trim(), phoneNumber: toE164(wPhone) });
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
        venueAddress: composeVenueAddress(venue),
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
            <div className="form-row"><label>Phone</label><PhoneNumberInput className="adm-input" value={wPhone} onChange={setWPhone} /></div>
          </div>
        )}

        <div className="form-grid">
          <div className="form-row"><label>Booking type</label>
            <select className="adm-input" value={bookingType} onChange={(e) => setBookingType(e.target.value as BookingTypeName)}>
              <option value="FullService">Full-service event</option>
              <option value="FoodDelivery">Food delivery</option>
              <option value="RentalService">Rental items only</option>
            </select>
          </div>
          {isFull && (
            <div className="form-row"><label>Event type</label>
              <select className="adm-input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option>Wedding</option><option>Corporate</option><option>Birthday</option><option>Debut</option><option>Others</option>
              </select>
            </div>
          )}
          {isFull && <div className="form-row"><label>Guests</label><input className="adm-input" type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} /></div>}
          <div className="form-row">
            <label>{isFull ? 'Event date' : 'Delivery date'}</label>
            <input className="adm-input" type="date" min={earliestDate} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            {earliestDate && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 300, color: dateTooSoon ? 'var(--danger)' : 'var(--text-dim)', textTransform: 'none', letterSpacing: 'normal' }}>
                Earliest: {fmtDate(earliestDate)} ({leadDays} days' notice)
              </span>
            )}
          </div>
          <div className="form-row"><label>{isFull ? 'Start time' : 'Delivery time'}</label><input className="adm-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          {isFull && <div className="form-row"><label>End date</label><input className="adm-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>}
          {isFull && <div className="form-row"><label>End time</label><input className="adm-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>}
          <div className="form-row"><label>Contact number (optional)</label><PhoneNumberInput className="adm-input" value={contact} onChange={setContact} /></div>
        </div>

        <VenueAddressFields
          value={venue}
          onChange={setVenue}
          fieldClassName="form-row"
          inputClassName="adm-input"
          labels={{ street: isFull ? 'Venue street' : 'Delivery street' }}
        />

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
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    // A dead hub isn't fatal — the panel still works on manual refresh — but it
    // must not fail silently, or staff sit waiting for messages that never push.
    conn.start().catch(() => {
      notify('info', 'Live chat updates are unavailable. Reopen a thread to refresh it manually.');
    });
    return () => { void conn.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAttachment = () => {
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const reply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    // Words, a file, or both — matching the server's own rule.
    if ((!text && !attachment) || sending || !selectedId) return;
    const session = readSession();
    if (!session) return;
    const file = attachment;
    setInput('');
    clearAttachment();
    setSending(true);
    try {
      await replySupport(session.token, selectedId, text, file);
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
                      {m.attachmentUrl && (
                        m.attachmentIsImage ? (
                          <a href={attachmentUrl(m.attachmentUrl)!} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: m.text ? '0.45rem' : 0 }}>
                            <img
                              src={attachmentUrl(m.attachmentUrl)!}
                              alt={m.attachmentFileName ?? 'Attachment'}
                              style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                            />
                          </a>
                        ) : (
                          <a
                            href={attachmentUrl(m.attachmentUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={m.attachmentFileName ?? undefined}
                            style={{ display: 'inline-block', marginTop: m.text ? '0.45rem' : 0, color: 'inherit', textDecoration: 'underline', fontSize: '0.75rem', wordBreak: 'break-all' }}
                          >
                            📎 {m.attachmentFileName ?? 'Download attachment'}
                          </a>
                        )
                      )}
                      <div style={{ fontSize: '0.55rem', opacity: 0.65, marginTop: '0.25rem' }}>{when(m.createdAt)}</div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              {attachment && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={attachment.name}>
                    📎 {attachment.name}
                  </span>
                  <button type="button" onClick={clearAttachment} aria-label="Remove attachment" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '0.72rem', padding: 0 }}>✕</button>
                </div>
              )}
              <form onSubmit={reply} style={{ display: 'flex', gap: '0.5rem', padding: '0.8rem 1rem', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    // Mirror the server's cap so an oversized file fails instantly.
                    if (file && file.size > 10 * 1024 * 1024) {
                      notify('error', 'Attachment exceeds the maximum size of 10 MB.');
                      clearAttachment();
                      return;
                    }
                    setAttachment(file);
                  }}
                />
                <button
                  type="button"
                  className="adm-iconbtn"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                  aria-label="Attach an image or PDF"
                  title="Attach an image or PDF (max 10 MB)"
                >
                  📎
                </button>
                <input className="adm-input" style={{ flex: 1 }} placeholder="Type a reply…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Reply" />
                <button type="submit" className="adm-btn primary" disabled={sending || (!input.trim() && !attachment)}>{sending ? '…' : 'Send'}</button>
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
  const navigate = useNavigate();

  const adminName = authUser?.name ?? FALLBACK_ADMIN.name;

  const [tab, setTab] = useState<Tab>('overview');
  const [placeholderName, setPlaceholderName] = useState(PLACEHOLDER_ITEMS[0]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [reservations, setReservations] = useState<BookingResponse[]>([]);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

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

  /* testimonials — live from /api/Testimonials (Owner/Assistant moderation queue) */
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [testiLoading, setTestiLoading] = useState(false);
  const [testiError, setTestiError] = useState<string | null>(null);
  const [testiBusyId, setTestiBusyId] = useState<string | null>(null);

  const loadTestimonials = async () => {
    const session = readSession();
    if (!session?.token) {
      setTestiError('You are not signed in. Sign in with an Owner or Assistant account to moderate testimonials.');
      return;
    }
    setTestiLoading(true);
    setTestiError(null);
    try {
      // Always fetch every status: the filter pills show per-status counts, which
      // would be wrong if the server had already filtered the list for us.
      setTestimonials(await getTestimonials(session.token));
    } catch (err) {
      setTestiError(
        err instanceof TestimonialApiError ? err.message : 'Could not load testimonials. Please try again.',
      );
    } finally {
      setTestiLoading(false);
    }
  };

  /* announcements — admin broadcasts, delivered through the customer notification feed */
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [annError, setAnnError] = useState<string | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPosting, setAnnPosting] = useState(false);

  const loadAnnouncements = async () => {
    const session = readSession();
    if (!session?.token) {
      setAnnError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }
    setAnnLoading(true);
    setAnnError(null);
    try {
      setAnnouncements(await getAnnouncements(session.token));
    } catch (err) {
      setAnnError(
        err instanceof AnnouncementApiError ? err.message : 'Could not load announcements. Please try again.',
      );
    } finally {
      setAnnLoading(false);
    }
  };

  const submitAnnouncement = async () => {
    const session = readSession();
    if (!session?.token) { notify('error', 'You are signed out. Sign in as Owner/Assistant.'); return; }
    if (!annTitle.trim() || !annBody.trim()) {
      notify('error', 'An announcement needs both a title and a message.');
      return;
    }

    setAnnPosting(true);
    try {
      const posted = await postAnnouncement(session.token, {
        title: annTitle.trim(),
        body: annBody.trim(),
      });
      setAnnouncements((prev) => [posted, ...prev]);
      setAnnTitle('');
      setAnnBody('');
      // NotifiedCount is the real fan-out result, so say what actually happened
      // rather than assuming everyone was reached.
      notify(
        posted.notifiedCount > 0 ? 'success' : 'info',
        posted.notifiedCount > 0
          ? `Announcement posted — ${posted.notifiedCount} customer${posted.notifiedCount === 1 ? '' : 's'} notified.`
          : 'Announcement posted, but no customers were notified. Check that active customers exist.',
      );
    } catch (err) {
      notify('error', err instanceof AnnouncementApiError ? err.message : 'Could not post the announcement.');
    } finally {
      setAnnPosting(false);
    }
  };

  /* calendar — real per-day lock state from /api/CalendarDays (no invented thresholds) */
  const [calendarDays, setCalendarDays] = useState<Map<string, CalendarDay>>(new Map());
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [lockBusyDate, setLockBusyDate] = useState<string | null>(null);
  const [lockTargetDate, setLockTargetDate] = useState<string | null>(null);
  /* double-clicking a calendar cell opens the day's booking schedule. Reads the
     already-loaded `reservations` array — no extra endpoint. */
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  /* sales report — real money from /api/Reports/monthly-sales, plus the AI read */
  const [salesReport, setSalesReport] = useState<MonthlySalesReport | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesSummary, setSalesSummary] = useState<MonthlySalesSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

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

  /* menus & dishes tab — live data from /api/Menuitems + /api/Menutrays */
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [menuTrays, setMenuTrays] = useState<AdminMenuTray[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuAuthError, setMenuAuthError] = useState(false);
  const [menuCategory, setMenuCategory] = useState<'all' | string>('all');
  const [menuSearch, setMenuSearch] = useState('');

  const [rentalItems, setRentalItems] = useState<AdminRentalItem[]>([]);
  const [rentalSearch, setRentalSearch] = useState('');
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

  /* ── returns / check-in desk ── */
  const [outstandingRentals, setOutstandingRentals] = useState<OutstandingRentalLine[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [returnsFeedback, setReturnsFeedback] = useState<string | null>(null);
  /** Which line is mid-request, so only that row's buttons disable. */
  const [returnsBusyId, setReturnsBusyId] = useState<string | null>(null);
  /** The line being marked Damaged; the note modal is open while this is set. */
  const [damageTarget, setDamageTarget] = useState<OutstandingRentalLine | null>(null);
  const [damageNote, setDamageNote] = useState('');

  const rentalCategoryOptions = ['Linens', 'Chairs', 'Tables', 'Lights', 'Others'] as const;
  const rentalFormValid = Boolean(
    rentalFormItem.itemName.trim() &&
    rentalFormItem.category.trim() &&
    Number(rentalFormItem.totalQuantity) >= 1 &&
    Number(rentalFormItem.unitPrice) >= 0,
  );

  /* service items state — live data from /api/Serviceitems */
  const [serviceItems, setServiceItems] = useState<AdminServiceItem[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
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
  const [resTypeFilter, setResTypeFilter] = useState<'all' | BookingTypeName>('all');
  const [resSearch, setResSearch] = useState('');
  /* The list has always been sorted by event date ascending; this just makes that a
     choice. Soonest-first stays the default — it's the order staff work in. */
  const [resSort, setResSort] = useState<ResSort>('date_asc');
  const [cancelResId, setCancelResId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  /* internal staff notes — one open editor at a time, keyed by booking id */
  const [noteResId, setNoteResId] = useState<string | null>(null);
  /** Booking whose Event Resources modal is open, or null. Mirrors noteResId. */
  const [resourcesResId, setResourcesResId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);

  const openNoteEditor = (b: BookingResponse) => {
    setNoteResId(b.id);
    setNoteDraft(b.adminNote ?? '');
  };

  const saveAdminNote = async (bookingId: string) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setNoteBusyId(bookingId);
    try {
      // Blank clears the note server-side, so "save an empty box" reads as "delete".
      const updated = await setBookingAdminNote(session.token, bookingId, noteDraft.trim() || null);
      setReservations((prev) => prev.map((r) => (r.id === bookingId ? updated : r)));
      setNoteResId(null);
      notify('success', updated.adminNote ? 'Note saved.' : 'Note cleared.');
    } catch (err) {
      notify('error', err instanceof BookingApiError ? err.message : 'Could not save the note.');
    } finally {
      setNoteBusyId(null);
    }
  };

  /* payments tab state */
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentStatusKey>('all');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<'all' | BookingTypeName>('all');
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  /* packages tab state */


  /* testimonials tab state */
  const [testiFilter, setTestiFilter] = useState<'all' | TestimonialStatus>('Pending');

  /* booking-history tab state (item 3a) */
  const [historyBookingId, setHistoryBookingId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<BookingHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');

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
  const pendingTesti = testimonials.filter((t) => t.status === 'Pending').length;

  /* Dates the BACKEND considers locked — isLocked is derived server-side as
     (isManuallyLocked || confirmedCount >= maxCapacity), counting Confirmed bookings
     only. This used to be a frontend guess ("≥2 active reservations"), which had
     nothing to do with the rule that actually blocks a confirmation. */
  const lockedDates = useMemo(
    () => new Set([...calendarDays.values()].filter((d) => d.isLocked).map((d) => d.date)),
    [calendarDays],
  );

  const filteredRes = useMemo(() => {
    const q = resSearch.trim().toLowerCase();
    return reservations
      .filter((r) => resFilter === 'all' || r.status === resFilter)
      // Status and type are independent axes — both must match.
      .filter((r) => resTypeFilter === 'all' || r.bookingType === resTypeFilter)
      .filter(
        (r) =>
          q === '' ||
          (r.bookingName && r.bookingName.toLowerCase().includes(q)) ||
          (r.contactNumber && r.contactNumber.toLowerCase().includes(q)) ||
          (r.eventType && r.eventType.toLowerCase().includes(q)),
      )
      // eventDate is an ISO "YYYY-MM-DD" from the DateOnly converter, which sorts
      // correctly as a plain string — no Date parsing, so a malformed value can't
      // produce a NaN comparison and scramble the order.
      .sort((a, b) => {
        const d = a.eventDate.localeCompare(b.eventDate);
        return resSort === 'date_asc' ? d : -d;
      });
  }, [reservations, resFilter, resTypeFilter, resSearch, resSort]);

  const filteredPayments = payments
    .filter((p) => paymentFilter === 'all' || p.status === paymentFilter)
    .filter((p) => paymentTypeFilter === 'all' || p.bookingType === paymentTypeFilter);

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

  /* Approve/reject writes through to the backend; only Approved rows reach the
     landing page, so this is what actually publishes or pulls a review. */
  const setTestiStatus = async (id: string, status: 'Approved' | 'Rejected') => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setTestiBusyId(id);
    try {
      const updated = await moderateTestimonial(session.token, id, status);
      setTestimonials((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: updated.status, moderatedAt: updated.moderatedAt, moderationNote: updated.moderationNote }
            : t,
        ),
      );
      notify('success', status === 'Approved' ? 'Testimonial published to the landing page.' : 'Testimonial rejected.');
    } catch (err) {
      notify('error', err instanceof TestimonialApiError ? err.message : 'Could not update the testimonial.');
    } finally {
      setTestiBusyId(null);
    }
  };

  const openTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
    // Booking Histories owns a URL of its own; leaving it must drop that URL, or the
    // address bar would keep claiming we're on a page we've navigated away from.
    if (t !== 'histories' && location.pathname === HISTORIES_PATH) navigate('/admin');
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
   * The catalog is reloaded afterwards because returning a line changes that item's
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

      await loadRentalCatalog();
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

  /**
   * Flips a menu item or tray between active and inactive — the same toggle the Rentals
   * and Service Items tabs already have. `nextActive` is the state being moved TO.
   */
  const toggleMenuEntryActive = async (mode: 'item' | 'tray', id: string, nextActive: boolean) => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to change entry status.');
      setMenuAuthError(true);
      return;
    }

    setMenuLoading(true);
    setMenuError(null);

    try {
      if (mode === 'item') {
        await (nextActive ? reactivateMenuItem : deactivateMenuItem)(session.token, id);
        setMenuItems((prev) => prev.map((m) => (m.id === id ? { ...m, isActive: nextActive } : m)));
      } else {
        await (nextActive ? reactivateMenuTray : deactivateMenuTray)(session.token, id);
        setMenuTrays((prev) => prev.map((t) => (t.id === id ? { ...t, isActive: nextActive } : t)));
      }
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError(`Unable to ${nextActive ? 'reactivate' : 'deactivate'} the menu entry. Please try again.`);
      }
    } finally {
      setMenuLoading(false);
    }
  };

  /* ── calendar, sales report, notifications: loaders ── */

  /**
   * Pulls the real lock state for the visible month (padded a week either side, so the
   * leading/trailing cells of the grid are covered too). Dates the backend has no row
   * for have never been booked — they stay absent and read as open.
   */
  const loadCalendar = async (monthStart: Date) => {
    const from = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    to.setDate(to.getDate() + 7);

    setCalendarError(null);
    try {
      const days = await getCalendarDays(toDateKey(from), toDateKey(to));
      setCalendarDays(new Map(days.map((d) => [d.date, d])));
    } catch (err) {
      setCalendarError(
        err instanceof CalendarApiError ? err.message : 'Could not load calendar availability.',
      );
    }
  };

  /** Owner/Assistant: flip the manual lock on one day, then refresh that month. */
  const toggleDayLock = async (dateStr: string, lock: boolean) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setLockBusyDate(dateStr);
    try {
      const updated = await setDayLock(session.token, dateStr, lock);
      setCalendarDays((prev) => new Map(prev).set(updated.date, updated));
      setLockTargetDate(null);
      notify(
        'success',
        lock
          ? `${fmtDate(dateStr)} is locked — no new bookings can be confirmed on it.`
          : updated.isLocked
            ? `Manual lock cleared, but ${fmtDate(dateStr)} is still full (${updated.confirmedCount}/${updated.maxCapacity}).`
            : `${fmtDate(dateStr)} is open again.`,
      );
    } catch (err) {
      notify('error', err instanceof CalendarApiError ? err.message : 'Could not update the calendar lock.');
    } finally {
      setLockBusyDate(null);
    }
  };

  const loadSalesReport = async () => {
    const session = readSession();
    if (!session?.token) return;
    setSalesLoading(true);
    setSalesError(null);
    try {
      setSalesReport(await getMonthlySales(session.token, SALES_MONTHS));
    } catch (err) {
      setSalesError(
        err instanceof ReportsApiError ? err.message : 'Could not load the sales report.',
      );
    } finally {
      setSalesLoading(false);
    }
  };

  /* On demand only: each call may cost a Gemini round trip (the server caches the
     result against the figures, so re-asking for an unchanged window is free). */
  const loadSalesSummary = async () => {
    const session = readSession();
    if (!session?.token) return;
    setSummaryLoading(true);
    try {
      setSalesSummary(await getMonthlySalesSummary(session.token, SALES_MONTHS));
    } catch (err) {
      notify('error', err instanceof ReportsApiError ? err.message : 'Could not generate the summary.');
    } finally {
      setSummaryLoading(false);
    }
  };

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
        setResFilter('all');   // the booking may not match the current status filter
        setResSearch(n.bookingName ?? '');
        openTab('bookings');
        break;
      case 'payment':
        // The admin list expands by payment id, so targetId drops straight in.
        if (n.targetId) setExpandedPayment(n.targetId);
        setPaymentFilter('all');
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

  /* ── booking revision history (item 3a) ── */

  /**
   * Loads the append-only snapshot trail for one booking. Each row holds the BEFORE
   * state of the change that produced the next revision, so the timeline is rendered
   * by diffing consecutive snapshots (and the newest snapshot against the booking as
   * it stands now).
   */
  const openHistory = async (bookingId: string) => {
    const session = readSession();
    if (!session?.token) {
      setHistoryError('You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setHistoryBookingId(bookingId);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryRows([]);
    try {
      setHistoryRows(await getBookingHistory(session.token, bookingId));
    } catch (err) {
      setHistoryError(
        err instanceof BookingApiError ? err.message : 'Could not load this booking’s history.',
      );
    } finally {
      setHistoryLoading(false);
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

  /* refetch every time the tab is opened so admin edits elsewhere show up */
  useEffect(() => {
    if (tab === 'overview' || tab === 'payments') void loadPayments();
    if (tab === 'overview') void loadSalesReport();
    if (tab === 'audit') void loadAuditLogs(1);
    // Overview needs them too: the calendar cells, the day-detail modal and the
    // pending queue all read `reservations`, which used to stay empty until the
    // admin had visited the Bookings tab at least once.
    if (tab === 'overview' || tab === 'bookings' || tab === 'histories') void loadBookings();
    if (tab === 'menus') void loadMenuCatalog();
    if (tab === 'rentals') {
      void loadRentalCatalog();
      void loadOutstandingRentals();
    }
    if (tab === 'services') void loadServiceCatalog();
    if (tab === 'testimonials') void loadTestimonials();
    if (tab === 'announcements') void loadAnnouncements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* The calendar is on Overview but its data is keyed to whichever month is shown,
     so it reloads on navigation as well as on tab entry. */
  useEffect(() => {
    if (tab === 'overview') void loadCalendar(calMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, calMonth]);

  /* The bell is in the topbar, so its feed is loaded once for the whole session
     rather than per tab. */
  useEffect(() => {
    void loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* Booking Histories is a real route (the sidebar has always linked to it — until
     now there was no matching <Route>, so the link bounced admins to the landing
     page). Keep the tab in step with the URL so deep links and Back work. */
  useEffect(() => {
    if (location.pathname === HISTORIES_PATH) setTab('histories');
  }, [location.pathname]);

  const menuCategories = useMemo(
    () => [...new Set(menuItems.map((m) => m.itemCategory))].sort(),
    [menuItems],
  );

  /* Catalog search — same shape as the Bookings tab's `resSearch`: the tabs
     already load their full catalogs, so this filters in memory and never adds
     a request. An empty query matches everything. */
  const matchesQuery = (q: string, ...fields: (string | null | undefined)[]) =>
    q === '' || fields.some((f) => (f ?? '').toLowerCase().includes(q));

  /**
   * The three end states an admin actually reads at a glance:
   *   Pending   — grey, still with us, hasn't gone out
   *   Delivered — amber, out on an event
   *   Damaged   — red, out and needs maintenance before it can go anywhere
   * Returned never appears here; those lines leave the desk.
   */
  const DELIVERY_STATUS_STYLE: Record<DeliveryStatusName, { color: string; label: string }> = {
    Pending: { color: 'var(--text-dim)', label: 'Not yet out' },
    Delivered: { color: 'var(--warning, #d98324)', label: 'Out' },
    Damaged: { color: 'var(--danger)', label: 'Needs maintenance' },
    Returned: { color: 'var(--primary)', label: 'Back in stock' },
  };

  const DELIVERY_ACTION_LABEL: Record<DeliveryStatusName, string> = {
    Delivered: 'Mark Delivered',
    Returned: 'Return',
    Damaged: 'Mark Damaged',
    Pending: 'Reset to Pending',
  };

  /**
   * Outstanding lines bucketed by event date, so a day's returns get processed together
   * after the event rather than hunted for one booking at a time. The backend already
   * orders by event date, so insertion order carries through.
   */
  const outstandingByDate = useMemo(() => {
    const groups = new Map<string, OutstandingRentalLine[]>();
    for (const line of outstandingRentals) {
      const existing = groups.get(line.eventDate);
      if (existing) existing.push(line);
      else groups.set(line.eventDate, [line]);
    }
    return [...groups.entries()];
  }, [outstandingRentals]);

  const visibleMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuItems
      .filter((m) => menuCategory === 'all' || m.itemCategory === menuCategory)
      .filter((m) => matchesQuery(q, m.itemName, m.itemCategory, m.courseCategory, m.description, ...m.dietaryTags));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItems, menuCategory, menuSearch]);

  /* Trays match on their own name or on any dish they contain, so searching a
     dish surfaces the trays it belongs to. */
  const visibleMenuTrays = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuTrays.filter((t) => matchesQuery(q, t.trayName, ...t.dishes.map((d) => d.itemName)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuTrays, menuSearch]);

  const visibleRentalItems = useMemo(() => {
    const q = rentalSearch.trim().toLowerCase();
    return rentalItems.filter((r) => matchesQuery(q, r.itemName, r.category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalItems, rentalSearch]);

  const visibleServiceItems = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    return serviceItems.filter((s) => matchesQuery(q, s.serviceName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceItems, serviceSearch]);

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

  /* Tallest bar in the trend chart. Guarded against an all-zero window, which would
     otherwise divide every bar height by zero. */
  const salesMonths = salesReport?.months ?? [];
  const maxRevenue = Math.max(1, ...salesMonths.map((m) => m.net));

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
                    <div style={{ fontSize: '1.6rem', marginBottom: '0.6rem' }}>🧾</div>
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
      {damageTarget && (
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
        </div>
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
                  <StatusBadge label={RES_STATUS[b.status as ResStatus]?.label ?? b.status} color={RES_STATUS[b.status as ResStatus]?.color ?? '#999'} />
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2.5rem', marginTop: '2.4rem' }}>
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
            <button
              type="button"
              className={`adm-nav-item${tab === 'announcements' ? ' active' : ''}`}
              onClick={() => openTab('announcements')}
            >
              <span className="adm-nav-icon">📣</span>
              Announcements
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
              {tab === 'placeholder' ? placeholderName : tab === 'menus' ? 'Menus & Dishes' : tab === 'services' ? 'Service Items' : tab === 'rentals' ? 'Rentals' : tab === 'audit' ? 'Audit Log' : tab === 'histories' ? 'Booking Histories' : tab === 'announcements' ? 'Announcements' : NAV.find((n) => n.id === tab)?.label}
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
                      color: '#fff', fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700,
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

                  {/* monthly sales report — real collected money, net of refunds */}
                  <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.8rem' }}>
                      <div>
                        <FieldLabel text={`Last ${SALES_MONTHS} Months`} />
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.2rem' }}>
                          Monthly Sales
                        </h3>
                      </div>
                      <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Refresh sales report" onClick={() => void loadSalesReport()} disabled={salesLoading}>
                        ↻
                      </button>
                    </div>

                    {salesError && (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: 'var(--danger)', margin: '0.6rem 0 0' }}>
                        {salesError}
                      </p>
                    )}

                    {salesLoading && !salesReport && (
                      <div className="adm-skel" style={{ height: 150, marginTop: '1rem' }} aria-hidden="true" />
                    )}

                    {salesReport && (
                      <>
                        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                          <span>Net collected: <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(Math.round(salesReport.totalNet))}</strong></span>
                          <span>Refunded: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(Math.round(salesReport.totalRefunds))}</strong></span>
                          {salesReport.bestMonthLabel && <span>Best: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{salesReport.bestMonthLabel}</strong></span>}
                        </div>

                        <div className="adm-chart">
                          {salesMonths.map((m) => (
                            <div key={`${m.year}-${m.month}`} className="col" title={`${m.label}: ${fmt(Math.round(m.net))} from ${m.paymentCount} payment(s) across ${m.bookingCount} booking(s)`}>
                              <span className="val">₱{Math.round(m.net / 1000)}k</span>
                              <div className="bar" style={{ height: `${Math.round((m.net / maxRevenue) * 100)}%` }} />
                              <span className="mon">{m.label.split(' ')[0]}</span>
                            </div>
                          ))}
                        </div>

                        {/* AI summary — on demand, because each fresh window costs a Gemini call */}
                        <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border)' }}>
                          {salesSummary ? (
                            <>
                              <FieldLabel text={salesSummary.generated ? 'AI Summary' : 'Summary Unavailable'} />
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, lineHeight: 1.65, color: salesSummary.generated ? 'var(--text-secondary)' : 'var(--text-dim)', margin: '0.3rem 0 0.6rem' }}>
                                {salesSummary.summary}
                              </p>
                              <button type="button" className="adm-btn outline" onClick={() => void loadSalesSummary()} disabled={summaryLoading}>
                                {summaryLoading ? 'Thinking…' : '↻ Regenerate'}
                              </button>
                            </>
                          ) : (
                            <button type="button" className="adm-btn outline" onClick={() => void loadSalesSummary()} disabled={summaryLoading}>
                              {summaryLoading ? 'Thinking…' : '✦ Summarize these numbers'}
                            </button>
                          )}
                        </div>
                      </>
                    )}
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
                        // Real backend state. A date with no row has never been booked.
                        const cal = calendarDays.get(dateStr);
                        const locked = cal?.isLocked ?? false;
                        const manual = cal?.isManuallyLocked ?? false;
                        const isToday = dateStr === todayISO;
                        const capacityLabel = cal ? `${cal.confirmedCount}/${cal.maxCapacity} confirmed` : 'no bookings';
                        return (
                          <div
                            key={dateStr}
                            className="adm-cal-cell"
                            role="button"
                            tabIndex={0}
                            title={`${fmtDate(dateStr)} — ${capacityLabel}${manual ? ' · manually locked' : locked ? ' · full' : ''}. Click to ${locked && manual ? 'unlock' : 'lock'}, double-click for the day's schedule.`}
                            onClick={() => setLockTargetDate(dateStr)}
                            onDoubleClick={() => setDayDetailDate(dateStr)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLockTargetDate(dateStr); }
                              // Keyboard equivalent of the double-click, so the schedule
                              // isn't mouse-only.
                              if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setDayDetailDate(dateStr); }
                            }}
                            style={{
                              cursor: 'pointer',
                              background: manual
                                ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                                : locked ? 'var(--accent-muted)'
                                : isToday ? 'var(--primary-muted)' : 'transparent',
                              outline: lockTargetDate === dateStr
                                ? '1px solid var(--accent)'
                                : isToday ? '1px solid var(--primary)' : 'none',
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
                            {manual ? (
                              <span className="adm-cal-ev" style={{ color: 'var(--danger)', fontWeight: 600 }}>🔒 locked</span>
                            ) : locked ? (
                              <span className="adm-cal-ev" style={{ color: 'var(--accent)', fontWeight: 600 }}>● full</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {calendarError && (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--danger)', padding: '0 1rem 0.8rem', margin: 0 }}>
                        {calendarError}
                      </p>
                    )}

                    {/* manual lock/unlock — the admin action the backend has always
                        supported (SetDayLockDto) but nothing in the UI ever called */}
                    {lockTargetDate && (() => {
                      const cal = calendarDays.get(lockTargetDate);
                      const manual = cal?.isManuallyLocked ?? false;
                      const busy = lockBusyDate === lockTargetDate;
                      return (
                        <div style={{ borderTop: '1px solid var(--border)', padding: '0.9rem 1rem', display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 180, fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                            <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmtDate(lockTargetDate)}</strong>
                            {' — '}
                            {cal ? `${cal.confirmedCount} of ${cal.maxCapacity} confirmed` : 'nothing booked yet'}
                            {manual && ' · manually locked'}
                            {!manual && (cal?.isLocked ?? false) && ' · at capacity'}
                          </div>
                          <button
                            type="button"
                            className={manual ? 'adm-btn success' : 'adm-btn danger'}
                            disabled={busy}
                            onClick={() => void toggleDayLock(lockTargetDate, !manual)}
                          >
                            {busy ? 'Saving…' : manual ? 'Unlock this day' : 'Lock this day'}
                          </button>
                          <button type="button" className="adm-btn outline" onClick={() => setLockTargetDate(null)}>Close</button>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* day schedule — double-click a calendar cell. Built entirely from the
                    `reservations` array the dashboard already loads, so opening it
                    costs no request. */}
                {dayDetailDate && (() => {
                  const dayBookings = reservations
                    .filter((r) => r.eventDate === dayDetailDate)
                    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
                  const cal = calendarDays.get(dayDetailDate);
                  return (
                    <div className="adm-modal-overlay" onClick={() => setDayDetailDate(null)}>
                      <div
                        className="adm-modal-panel"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Bookings on ${fmtDate(dayDetailDate)}`}
                        style={{ maxWidth: 620 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                          <div>
                            <h3 style={{ marginBottom: '0.2rem' }}>{fmtDate(dayDetailDate)}</h3>
                            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                              {dayBookings.length === 0
                                ? 'Nothing booked for this date.'
                                : `${dayBookings.length} booking${dayBookings.length === 1 ? '' : 's'}`}
                              {cal && ` · ${cal.confirmedCount} of ${cal.maxCapacity} confirmed`}
                              {cal?.isManuallyLocked && ' · manually locked'}
                            </p>
                          </div>
                          <button type="button" className="adm-iconbtn" aria-label="Close" onClick={() => setDayDetailDate(null)}>✕</button>
                        </div>

                        {dayBookings.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                            This date has no reservations yet.
                          </p>
                        ) : (
                          dayBookings.map((r) => {
                            const st = RES_STATUS[r.status as ResStatus];
                            // Multi-day events carry their own end date; same-day ones
                            // only need the time.
                            const spansDays = !!r.endDate && r.endDate !== r.eventDate;
                            return (
                              <div key={r.id} className="adm-row" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '0.8rem 0', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 200 }}>
                                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                    {r.bookingName}
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                    🕑 {fmtTime(r.startTime)} – {fmtTime(r.endTime)}
                                    {spansDays && ` (ends ${fmtDate(r.endDate as string)})`}
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                                    {r.eventType || r.bookingType} · {r.guestCount ?? 'N/A'} guests · {r.venueAddress || 'no venue set'}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <StatusBadge label={st?.label ?? r.status} color={st?.color ?? '#999'} />
                                  <button
                                    type="button"
                                    className="adm-btn outline"
                                    onClick={() => {
                                      // Same hand-off the notification feed uses: search the
                                      // Bookings tab for this booking by name.
                                      setDayDetailDate(null);
                                      setResSearch(r.bookingName);
                                      openTab('bookings');
                                    }}
                                  >
                                    Open
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}

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
                        {lockedDates.has(r.eventDate) && (
                          <StatusBadge
                            label={calendarDays.get(r.eventDate)?.isManuallyLocked ? '🔒 Date locked' : '● Date full'}
                            color={calendarDays.get(r.eventDate)?.isManuallyLocked ? 'var(--danger)' : 'var(--accent)'}
                          />
                        )}
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
                  <select
                    className="adm-input"
                    style={{ flex: '0 1 190px' }}
                    value={resSort}
                    onChange={(e) => setResSort(e.target.value as ResSort)}
                    aria-label="Sort bookings by event date"
                  >
                    <option value="date_asc">Event date · soonest first</option>
                    <option value="date_desc">Event date · latest first</option>
                  </select>
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

                {/* Booking type — a second, independent axis from status. Filters the
                    already-fetched rows client-side; no extra request. */}
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['all', 'FullService', 'FoodDelivery', 'RentalService'] as const).map((k) => {
                    const count = k === 'all' ? reservations.length : reservations.filter((r) => r.bookingType === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${resTypeFilter === k ? ' active' : ''}`} onClick={() => setResTypeFilter(k)}>
                        {k === 'all' ? 'All Types' : BOOKING_TYPE_LABELS[k]}
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
                              <span>Starts: <strong style={{ color: 'var(--primary)', fontWeight: 500 }}>{fmtDate(r.eventDate)} · {fmtTime(r.startTime)}</strong></span>
                              {/* A FoodDelivery order has no end date/time by design. */}
                              {r.bookingType !== 'FoodDelivery' && (
                                <span>Ends: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                  {r.endDate ? fmtDate(r.endDate) : '—'} · {fmtTime(r.endTime)}
                                </strong></span>
                              )}
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
                            {lockedDates.has(r.eventDate) && (r.status === 'Pending' || r.status === 'Confirmed') && (
                              <StatusBadge
                                label={calendarDays.get(r.eventDate)?.isManuallyLocked ? '🔒 Date locked' : '● Date full'}
                                color={calendarDays.get(r.eventDate)?.isManuallyLocked ? 'var(--danger)' : 'var(--accent)'}
                              />
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
                          {/* Sits immediately before Confirm on purpose: logging cash is
                              what makes Confirm usable, and the deposit hint says so. */}
                          {r.status === 'Pending' && (
                            <button
                              type="button"
                              className={r.depositStatus === 'Unpaid' ? 'adm-btn primary' : 'adm-btn outline'}
                              onClick={() => setCashTarget({ bookingId: r.id, bookingName: r.bookingName })}
                            >
                              💵 Log Cash
                            </button>
                          )}
                          {r.status === 'Pending' && (
                            <button
                              type="button"
                              className="adm-btn success"
                              // Mirrors ConfirmBookingAsync's own guard, so the reason is
                              // visible before the click rather than as a 400 after it.
                              disabled={r.depositStatus === 'Unpaid'}
                              title={r.depositStatus === 'Unpaid'
                                ? 'No payment recorded yet — log the deposit first.'
                                : undefined}
                              onClick={() => setResStatus(r.id, 'Confirmed')}
                            >
                              Confirm
                            </button>
                          )}
                          {r.status === 'Confirmed' && (
                            <button type="button" className="adm-btn info" onClick={() => setResStatus(r.id, 'Completed')}>Mark Completed</button>
                          )}
                          {/* Submit issues the invoice, so it exists from Pending
                              onward — viewing it is useful at both stages, and there is
                              nothing to "generate". */}
                          {(r.status === 'Pending' || r.status === 'Confirmed') && (
                            <button
                              type="button"
                              className="adm-btn outline"
                              disabled={invoiceBusyId === r.id}
                              onClick={() => void openInvoiceFor(r)}
                            >
                              {invoiceBusyId === r.id ? 'Loading…' : '🧾 Invoice'}
                            </button>
                          )}
                          {/* Draft gets it too, and leads with it: the detail view is
                              where items are added, which is the whole point of a Draft.
                              "Submit for Customer" above is useless until that's done. */}
                          {(r.status === 'Confirmed' || r.status === 'Draft') && (
                            <button
                              type="button"
                              className={r.status === 'Draft' ? 'adm-btn primary' : 'adm-btn outline'}
                              disabled={detailBusyId === r.id}
                              onClick={() => void openBookingDetail(r)}
                            >
                              {detailBusyId === r.id
                                ? 'Loading…'
                                : r.status === 'Draft' ? '🍽 Add Items' : '🔍 View Details'}
                            </button>
                          )}
                          {r.status === 'Confirmed' && (
                            <button
                              type="button"
                              className="adm-btn outline"
                              disabled={contractBusyId === r.id}
                              onClick={() => void openContract(r)}
                            >
                              {contractBusyId === r.id ? 'Preparing…' : 'Generate Contract'}
                            </button>
                          )}
                          {r.status === 'Confirmed' && (
                            <button
                              type="button"
                              className="adm-btn outline"
                              onClick={() => (noteResId === r.id ? setNoteResId(null) : openNoteEditor(r))}
                            >
                              {r.adminNote ? '📝 Edit Note' : '📝 Add Note'}
                            </button>
                          )}
                          {/* Sits BESIDE the note button rather than replacing it — the
                              note is a separate capability (allergies, site access) with
                              its own endpoint, and it is most useful on exactly these
                              bookings.

                              Shown from Confirmed onward, and deliberately still shown
                              once Completed: a booking spends the rest of its life in
                              that state, and "what did we actually send to that event?"
                              is precisely what staff look back for. Hiding it there
                              would make the record permanently unreachable in the UI, so
                              Completed opens the same modal read-only instead.

                              Draft/Pending are hidden because nothing is committed yet,
                              and Cancelled because the server refuses it outright. */}
                          {(r.status === 'Confirmed' || r.status === 'Completed') && (
                            <button
                              type="button"
                              className="adm-btn outline"
                              onClick={() => setResourcesResId(r.id)}
                            >
                              {/* One label, always. The affordance for "already has a
                                  plan" is the ✓ suffix, not a different verb — the button
                                  changing its name based on state is what made this
                                  control hard to find across revisions. */}
                              🧰 Allocate Resources{r.resourceAllocation?.isApproved ? ' ✓' : ''}
                            </button>
                          )}
                          <button
                            type="button"
                            className="adm-btn outline"
                            onClick={() => { openTab('histories'); void openHistory(r.id); }}
                          >
                            View History
                          </button>
                          {(r.status === 'Pending' || r.status === 'Confirmed') && !cancelling && (
                            <button type="button" className="adm-btn danger" onClick={() => { setCancelResId(r.id); setCancelReason(''); }}>Cancel</button>
                          )}
                        </div>

                        {/* Internal staff note. Shown read-only when set and the editor
                            is closed, so it's visible at a glance without a click. */}
                        {r.status === 'Confirmed' && r.adminNote && noteResId !== r.id && (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.8rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', padding: '0.55rem 0.8rem', borderLeft: '2px solid var(--border-accent)', whiteSpace: 'pre-wrap' }}>
                            <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Staff note:</strong> {r.adminNote}
                          </p>
                        )}

                        {noteResId === r.id && (
                          <div style={{ marginTop: '0.9rem' }}>
                            <FieldLabel text="Internal staff note — not shown to the customer" />
                            <textarea
                              className="adm-input"
                              style={{ width: '100%', minHeight: 80, marginTop: '0.35rem', resize: 'vertical' }}
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              maxLength={2000}
                              placeholder="Allergies, venue access, who to call on site…"
                            />
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                              <button type="button" className="adm-btn primary" disabled={noteBusyId === r.id} onClick={() => void saveAdminNote(r.id)}>
                                {noteBusyId === r.id ? 'Saving…' : 'Save Note'}
                              </button>
                              <button type="button" className="adm-btn outline" onClick={() => setNoteResId(null)}>Cancel</button>
                            </div>
                          </div>
                        )}

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
                  <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Cash is logged against a booking, and the picker below lists the
                        ones that can still take one — Pending or Confirmed but not yet
                        fully paid. A Draft has no invoice to pay against. */}
                    <select
                      className="adm-input"
                      style={{ flex: '0 1 260px' }}
                      value=""
                      aria-label="Log cash payment for a booking"
                      onChange={(e) => {
                        const b = reservations.find((x) => x.id === e.target.value);
                        if (b) setCashTarget({ bookingId: b.id, bookingName: b.bookingName });
                      }}
                    >
                      <option value="">💵 Log cash payment for…</option>
                      {reservations
                        .filter((b) => (b.status === 'Pending' || b.status === 'Confirmed') && b.depositStatus !== 'Paid')
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bookingName} — {fmtDate(b.eventDate)} ({b.depositStatus})
                          </option>
                        ))}
                    </select>
                    <button type="button" className="adm-btn outline" onClick={() => void loadPayments()} disabled={paymentsLoading}>
                      {paymentsLoading ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>
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

                {/* Booking type of the payment's booking — carried on the list DTO. */}
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['all', 'FullService', 'FoodDelivery', 'RentalService'] as const).map((k) => {
                    const count = k === 'all' ? payments.length : payments.filter((p) => p.bookingType === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${paymentTypeFilter === k ? ' active' : ''}`} onClick={() => setPaymentTypeFilter(k)}>
                        {k === 'all' ? 'All Types' : BOOKING_TYPE_LABELS[k]}
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
                                  {/* Refunding requires an open request from the customer —
                                      the server enforces it, so the button is disabled
                                      rather than shown and then rejected. */}
                                  {(p.status === 'Success' || p.status === 'PartiallyRefunded') && p.amountPaid - p.refundedAmount > 0 && (
                                    <button
                                      type="button"
                                      className="adm-btn outline"
                                      disabled={paymentActionBusy === p.id || !p.refundRequested}
                                      title={p.refundRequested ? undefined : 'The customer has not requested a refund on this payment.'}
                                      onClick={() => void runPaymentAction(p.id, 'refund')}
                                    >
                                      {paymentActionBusy === p.id
                                        ? 'Working…'
                                        : p.refundRequested
                                          ? `Refund ${fmt(p.amountPaid - p.refundedAmount)}`
                                          : 'Refund — no request on file'}
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
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="adm-title">Testimonial Moderation</h2>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                      Live from the backend — <code style={{ fontSize: '0.66rem' }}>/api/Testimonials</code> · approved reviews appear on the landing page
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                      {pendingTesti} pending review
                    </span>
                    <button type="button" className="adm-btn outline" onClick={() => void loadTestimonials()} disabled={testiLoading}>
                      {testiLoading ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>
                </div>

                {testiError && (
                  <div className="adm-card" style={{ padding: '1.4rem 1.6rem', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
                      {testiError}
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['Pending', 'Approved', 'Rejected', 'all'] as const).map((k) => {
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
                            {t.authorName.charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{t.authorName}</span>
                              <span style={{ color: 'var(--accent)', fontSize: '0.8rem' }}>
                                {'★'.repeat(t.rating)}
                                <span style={{ color: 'var(--border-strong)' }}>{'★'.repeat(5 - t.rating)}</span>
                              </span>
                            </div>
                            <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 0.4rem' }}>
                              "{t.body}"
                            </p>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                              Submitted {fmtDate(t.submittedAt)} · {t.customerEmail} · reviewing “{t.bookingName}” ({fmtDate(t.eventDate)})
                            </span>
                          </div>
                          <StatusBadge label={st.label} color={st.color} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                          {t.status !== 'Approved' && (
                            <button type="button" className="adm-btn success" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Approved')}>
                              {testiBusyId === t.id ? 'Saving…' : '✓ Approve — publish to landing page'}
                            </button>
                          )}
                          {t.status !== 'Rejected' && (
                            <button type="button" className="adm-btn danger" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Rejected')}>
                              ✕ {t.status === 'Approved' ? 'Remove from landing page' : 'Reject'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ══════════ BOOKING HISTORIES (live backend data) ══════════ */}
            {tab === 'histories' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div>
                  <h2 className="adm-title">Booking Histories</h2>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                    Live from the backend — <code style={{ fontSize: '0.66rem' }}>/api/Bookings/{'{id}'}/history</code>. Every mutating call writes a
                    snapshot of the booking as it was <em>before</em> the change.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 4fr) minmax(320px, 8fr)', gap: '1.2rem', alignItems: 'start' }} className="adm-overview-cols">

                  {/* booking picker */}
                  <div className="adm-card" style={{ padding: '1.1rem 1.2rem' }}>
                    <FieldLabel text="Select a booking" />
                    <input
                      className="adm-input square"
                      style={{ margin: '0.5rem 0 0.8rem' }}
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search by name…"
                    />
                    <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                      {reservations
                        .filter((r) => {
                          const q = historySearch.trim().toLowerCase();
                          return q === '' || (r.bookingName ?? '').toLowerCase().includes(q);
                        })
                        .map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => void openHistory(r.id)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                              border: 'none', borderBottom: '1px solid var(--border)',
                              background: historyBookingId === r.id ? 'var(--primary-muted)' : 'transparent',
                              padding: '0.6rem 0.4rem',
                            }}
                          >
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                              {r.bookingName}
                            </div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                              {fmtDate(r.eventDate)} · {r.status}
                            </div>
                          </button>
                        ))}
                      {reservations.length === 0 && (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, color: 'var(--text-muted)', margin: '1rem 0' }}>
                          No bookings loaded.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* revision timeline */}
                  <div className="adm-card" style={{ padding: '1.3rem 1.5rem' }}>
                    {!historyBookingId ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-muted)', textAlign: 'center', margin: '2.5rem 0' }}>
                        Pick a booking to see how it changed over time.
                      </p>
                    ) : historyLoading ? (
                      <>
                        <div className="adm-skel" style={{ height: '0.9rem', width: '45%', marginBottom: '1rem' }} aria-hidden="true" />
                        <div className="adm-skel" style={{ height: '3.6rem', marginBottom: '0.7rem' }} aria-hidden="true" />
                        <div className="adm-skel" style={{ height: '3.6rem' }} aria-hidden="true" />
                      </>
                    ) : historyError ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
                        {historyError}
                      </p>
                    ) : historyRows.length === 0 ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-muted)', textAlign: 'center', margin: '2.5rem 0' }}>
                        No revisions recorded — this booking hasn't been changed since it was created.
                      </p>
                    ) : (() => {
                      const current = reservations.find((r) => r.id === historyBookingId);
                      // Newest first, and each row is compared against the state that
                      // FOLLOWED it: the next snapshot, or the booking as it stands now.
                      const ordered = [...historyRows].sort((a, b) => b.revisionNumber - a.revisionNumber);
                      return (
                        <>
                          <FieldLabel text={`${historyRows.length} revision${historyRows.length === 1 ? '' : 's'}`} />
                          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0.1rem 0 1.1rem' }}>
                            {current?.bookingName ?? 'Booking'}
                          </h3>

                          {ordered.map((row) => {
                            const before = parseSnapshot(row.snapshotJson);
                            const nextRow = historyRows.find((h) => h.revisionNumber === row.revisionNumber + 1);
                            const after = nextRow
                              ? parseSnapshot(nextRow.snapshotJson)
                              : current ? bookingAsSnapshot(current) : null;
                            const changes = diffSnapshots(before, after);

                            return (
                              <div key={row.id} className="adm-row" style={{ padding: '0.9rem 0' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {row.changeReason || 'Edited'}
                                  </span>
                                  <StatusBadge label={`rev ${row.revisionNumber}`} color="var(--text-dim)" />
                                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                                    {fmtDateTime(row.snapshotAt)}
                                    {' · '}
                                    {/* A null ChangedById means the customer or the system
                                        made the change, not a staff account. */}
                                    {row.changedById
                                      ? `staff ${row.changedById.slice(0, 8)}…`
                                      : 'customer or system'}
                                  </span>
                                </div>

                                {changes.length === 0 ? (
                                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                                    No field-level differences recorded for this revision (line items changed, or the snapshot is identical).
                                  </p>
                                ) : (
                                  <div style={{ display: 'grid', gap: '0.25rem' }}>
                                    {changes.map((c) => (
                                      <div key={c.key} style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                                        <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{c.label}:</strong>{' '}
                                        <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{c.from}</span>
                                        {' → '}
                                        <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{c.to}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                </div>
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
                    <input
                      className="adm-input"
                      type="search"
                      placeholder="Search dishes and trays…"
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      style={{ flex: '0 1 260px' }}
                      aria-label="Search menus and dishes"
                    />
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
                          {menuSearch.trim() ? `No dishes match “${menuSearch.trim()}”.` : 'No dishes in this category.'}
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
                                className={`adm-btn ${m.isActive ? 'danger' : 'success'}`}
                                onClick={() => void toggleMenuEntryActive('item', m.id, !m.isActive)}
                                disabled={menuLoading}
                              >
                                {m.isActive ? 'Deactivate' : 'Activate'}
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
                          Party Trays ({visibleMenuTrays.length})
                        </h3>
                      </div>
                      {menuTrays.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                          No trays configured yet.
                        </p>
                      ) : visibleMenuTrays.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                          No trays match “{menuSearch.trim()}”.
                        </p>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                          {visibleMenuTrays.map((t) => (
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
                                  className={`adm-btn ${t.isActive ? 'danger' : 'success'}`}
                                  onClick={() => void toggleMenuEntryActive('tray', t.id, !t.isActive)}
                                  disabled={menuLoading}
                                >
                                  {t.isActive ? 'Deactivate' : 'Activate'}
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

                      {/* Just the field grid — this used to also carry
                          `adm-modal-panel`, nesting a second bordered, padded,
                          `max-height: 92vh; overflow-y: auto` panel inside the
                          modal. That nested scroll container is what produced the
                          double scrollbar and the doubled padding. */}
                      <div className="form-grid full">
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
                        <input
                          className="adm-input"
                          type="search"
                          placeholder="Search name or category…"
                          value={rentalSearch}
                          onChange={(e) => setRentalSearch(e.target.value)}
                          style={{ flex: '0 1 260px' }}
                          aria-label="Search rental items"
                        />
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
                              Items ({visibleRentalItems.length})
                            </h3>
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)' }}>
                            {visibleRentalItems.filter((item) => item.isActive).length} active
                          </div>
                        </div>
                        {rentalItems.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            No rental inventory items are configured yet.
                          </p>
                        ) : visibleRentalItems.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            No rental items match “{rentalSearch.trim()}”.
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
                                {visibleRentalItems.map((item) => (
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

                    {/* ── Returns / check-in desk ───────────────────────────────
                        Grouped by event date so a day's returns get processed together
                        after the event. Actions offered per row come from
                        DELIVERY_NEXT_STATUSES, which mirrors the backend state machine —
                        the UI never offers a move the server would reject. */}
                    <div className="adm-card" style={{ padding: '1.4rem 1.6rem', marginTop: '1.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
                        <div>
                          <FieldLabel text="Returns / Check-in" />
                          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                            Outstanding Lines ({outstandingRentals.length})
                          </h3>
                        </div>
                        <button type="button" className="adm-btn outline" onClick={() => void loadOutstandingRentals()} disabled={returnsLoading}>
                          {returnsLoading ? 'Refreshing…' : '↻ Refresh'}
                        </button>
                      </div>

                      {returnsFeedback && (
                        <div style={{ marginBottom: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--primary)' }}>{returnsFeedback}</div>
                        </div>
                      )}

                      {returnsError && (
                        <div style={{ marginBottom: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', border: '1px solid var(--danger)' }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--danger)' }}>{returnsError}</div>
                        </div>
                      )}

                      {returnsLoading && outstandingRentals.length === 0 ? (
                        <div aria-hidden="true">
                          {[0, 1, 2].map((i) => (
                            <div key={i} className="adm-skel" style={{ height: '1rem', width: `${70 - i * 10}%`, marginBottom: '0.9rem' }} />
                          ))}
                        </div>
                      ) : outstandingRentals.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                          Nothing outstanding — every rental line on a confirmed booking is either back in stock or not yet due out.
                        </p>
                      ) : (
                        outstandingByDate.map(([eventDate, lines]) => (
                          <div key={eventDate} style={{ marginBottom: '1.4rem' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.4rem' }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {fmtDate(eventDate)}
                              </span>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 400, color: 'var(--text-dim)' }}>
                                {lines.length} line{lines.length === 1 ? '' : 's'}
                              </span>
                            </div>

                            {lines.map((line) => {
                              const style = DELIVERY_STATUS_STYLE[line.deliveryStatus];
                              const busy = returnsBusyId === line.rentalId;
                              return (
                                <div
                                  key={line.rentalId}
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border)', opacity: busy ? 0.55 : 1 }}
                                >
                                  <div style={{ minWidth: 220, flex: '1 1 260px' }}>
                                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.94rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                      {line.quantity} × {line.itemName}
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                                      {line.customerName}
                                      {line.endDate && line.endDate !== line.eventDate ? ` · through ${fmtDate(line.endDate)}` : ''}
                                    </div>
                                    {line.damageNote && (
                                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--danger)', marginTop: '0.2rem' }}>
                                        ⚠ {line.damageNote}
                                      </div>
                                    )}
                                  </div>

                                  <StatusBadge label={style.label} color={style.color} />

                                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                    {DELIVERY_NEXT_STATUSES[line.deliveryStatus].map((next) => (
                                      <button
                                        key={next}
                                        type="button"
                                        className={`adm-btn ${next === 'Returned' ? 'success' : next === 'Damaged' ? 'danger' : 'info'}`}
                                        disabled={busy}
                                        onClick={() => {
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
                                </div>
                              );
                            })}
                          </div>
                        ))
                      )}
                    </div>

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

                          {/* Field grid only — see the menu form modal above for
                              why `adm-modal-panel` doesn't belong here. */}
                          <div className="form-grid full">
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
                        <input
                          className="adm-input"
                          type="search"
                          placeholder="Search service name…"
                          value={serviceSearch}
                          onChange={(e) => setServiceSearch(e.target.value)}
                          style={{ flex: '0 1 260px' }}
                          aria-label="Search service items"
                        />
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
                              Services ({visibleServiceItems.length})
                            </h3>
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)' }}>
                            {visibleServiceItems.filter((item) => item.isActive).length} active
                          </div>
                        </div>
                        {serviceItems.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            No service items configured yet.
                          </p>
                        ) : visibleServiceItems.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            No services match “{serviceSearch.trim()}”.
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
                                {visibleServiceItems.map((item) => (
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

                          {/* Field grid only — see the menu form modal above for
                              why `adm-modal-panel` doesn't belong here. */}
                          <div className="form-grid full">
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

                {/* ══════════ ANNOUNCEMENTS ══════════ */}
                {tab === 'announcements' && (
                  <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div>
                      <h2 className="adm-title">Announcements</h2>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                        Posting one notifies every active customer through their notification bell.
                      </p>
                    </div>

                    {/* compose */}
                    <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                      <FieldLabel text="New Announcement" />
                      <div className="form-grid full" style={{ marginTop: '0.7rem' }}>
                        <div className="form-row">
                          <label htmlFor="ann-title">Title</label>
                          <input
                            id="ann-title"
                            className="adm-input"
                            maxLength={150}
                            placeholder="Holiday hours for December"
                            value={annTitle}
                            onChange={(e) => setAnnTitle(e.target.value)}
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="ann-body">Message</label>
                          <textarea
                            id="ann-body"
                            className="adm-input"
                            rows={5}
                            maxLength={2000}
                            placeholder="What do you want every customer to know?"
                            value={annBody}
                            onChange={(e) => setAnnBody(e.target.value)}
                            style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
                          />
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-dim)', textAlign: 'right' }}>
                            {annBody.length} / 2000
                          </div>
                        </div>
                      </div>
                      {/* No edit or unsend: a notification a customer has already read
                          can't be recalled, so say so before they post. */}
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)', marginRight: 'auto' }}>
                          Announcements can't be edited or unsent once posted.
                        </span>
                        <button
                          type="button"
                          className="adm-btn primary"
                          disabled={annPosting || !annTitle.trim() || !annBody.trim()}
                          onClick={() => void submitAnnouncement()}
                        >
                          {annPosting ? 'Posting…' : 'Post & Notify Customers'}
                        </button>
                      </div>
                    </div>

                    {annError && !annLoading && (
                      <div className="adm-card" style={{ padding: '2.75rem 2rem', textAlign: 'center', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>⚠️</div>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
                          Couldn't load announcements
                        </h3>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.83rem', fontWeight: 300, color: 'var(--danger)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.65 }}>
                          {annError}
                        </p>
                        <button type="button" className="adm-btn outline" onClick={() => void loadAnnouncements()}>Try Again</button>
                      </div>
                    )}

                    {annLoading && (
                      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
                        <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
                        {[0, 1, 2].map((i) => (
                          <div key={i} style={{ padding: '0.75rem 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                            <div className="adm-skel" style={{ height: '0.9rem', width: '35%', marginBottom: '0.45rem' }} />
                            <div className="adm-skel" style={{ height: '0.6rem', width: '75%' }} />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* history */}
                    {!annLoading && !annError && (
                      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                        <div style={{ marginBottom: '1rem' }}>
                          <FieldLabel text="History" />
                          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                            Posted ({announcements.length})
                          </h3>
                        </div>
                        {announcements.length === 0 ? (
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                            Nothing posted yet. Your first announcement will appear here.
                          </p>
                        ) : (
                          announcements.map((a) => (
                            <div key={a.id} className="adm-row" style={{ padding: '0.9rem 0' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                    {a.title}
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                    {a.body}
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.45rem' }}>
                                    {a.createdByName} · {fmtDateTime(a.createdAt)}
                                  </div>
                                </div>
                                {/* 0 reached means the fan-out failed, not that it was
                                    skipped — surface it rather than hiding a zero. */}
                                <StatusBadge
                                  label={a.notifiedCount > 0 ? `${a.notifiedCount} notified` : 'none notified'}
                                  color={a.notifiedCount > 0 ? 'var(--primary)' : 'var(--danger)'}
                                />
                              </div>
                            </div>
                          ))
                        )}
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
