import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HubConnectionBuilder } from '@microsoft/signalr';
import {
  LayoutGrid, CalendarDays, Wallet, Package, Star,
  UtensilsCrossed, Tent, Wrench, ScrollText, Megaphone, Circle, CalendarClock,
  X, LogOut, AlertTriangle, RotateCw, Check, Pencil, Users,
} from 'lucide-react';
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
  discardDraft,
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
import {
  fetchGalleryForAdmin,
  uploadGalleryImage,
  deleteGalleryImage,
  getFullImageUrl as getGalleryImageUrl,
  GalleryApiError,
  GALLERY_ACCEPTED_TYPES,
  GALLERY_MAX_IMAGES,
  GALLERY_MAX_IMAGE_BYTES,
  type GalleryImageAdmin,
} from '../api/galleryApi';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { PaymentsToolbar } from '../components/admin/payments/PaymentsToolbar';
import { PaymentsTable } from '../components/admin/payments/PaymentsTable';
import { RefundConfirmModal } from '../components/admin/payments/RefundConfirmModal';
import { BookingsTreeMenu } from '../components/admin/bookings/BookingsTreeMenu';
import { BookingsToolbar } from '../components/admin/bookings/BookingsToolbar';
import { BookingsTable } from '../components/admin/bookings/BookingsTable';
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

export type ResStatus = 'Draft' | 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';

/** Sort order for the Bookings tab list. */



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

/**
 * Booking status → badge colour.
 *
 * Every entry reads the status ramp, never --accent or --primary. Those two were
 * survivable under the teal palette, where --accent was a bronze and --primary a
 * deep teal; under the plum direction --accent is the rose #A62A57 and --danger
 * the red #DC2626, so a Pending badge and a Cancelled one became two reds, and
 * Confirmed on --primary rendered as near-black body text rather than a status.
 * The ramp exists precisely so these five stay separable — see the note on it in
 * index.css.
 */
export const RES_STATUS: Record<ResStatus, { label: string; color: string }> = {
  Draft: { label: 'Draft', color: 'var(--text-dim)' },
  Pending: { label: 'Pending', color: 'var(--warning)' },
  Confirmed: { label: 'Confirmed', color: 'var(--status-paid)' },
  Completed: { label: 'Completed', color: 'var(--status-info)' },
  Cancelled: { label: 'Cancelled', color: 'var(--danger)' },
};

type PaymentStatusKey = 'Pending' | 'Success' | 'Failed' | 'PartiallyRefunded' | 'Refunded';

/* Same reasoning as RES_STATUS above: ramp roles only. Pending was --accent and
   Success --primary, which under the plum palette put Pending next to Failed as a
   second red and rendered Success as near-black text. */
const PAYMENT_STATUS: Record<PaymentStatusKey, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--warning)' },
  Success: { label: 'Success', color: 'var(--status-paid)' },
  Failed: { label: 'Failed', color: 'var(--danger)' },
  PartiallyRefunded: { label: 'Partially Refunded', color: 'var(--status-refund)' },
  Refunded: { label: 'Refunded', color: 'var(--status-refund)' },
};

const paymentStatusMeta = (status: string) =>
  PAYMENT_STATUS[status as PaymentStatusKey] ?? { label: status, color: 'var(--text-dim)' };

/**
 * Booking.DepositStatus → badge colour.
 *
 * Deliberately NOT PAYMENT_STATUS, despite both being "payment" colours: that map is
 * keyed by the *Payment record's* status (Pending/Success/Failed/PartiallyRefunded/
 * Refunded) and shares not one key with DepositStatus. Reusing it would silently fall
 * through to the grey default on every booking row.
 *
 * Same { label, color } shape as the maps above, so StatusBadge and the bookings
 * table derive the soft wash from one value via color-mix.
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
  DEPOSIT_STATUS[status as DepositStatusKey] ?? { label: status, color: 'var(--text-dim)' };

const TESTI_STATUS: Record<TestimonialStatus, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--warning)' },
  Approved: { label: 'Approved', color: 'var(--status-paid)' },
  Rejected: { label: 'Rejected', color: 'var(--danger)' },
};

export const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`;

/** Zero-pads a month/day for building a local "YYYY-MM-DD" without UTC drift. */
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Rounds a chart axis maximum up to a readable step, so the gridline labels land
 * on round pesos instead of whatever the tallest bar happened to be. The ladder is
 * deliberately fine-grained — a coarse 1/2/5 one leaves the tallest bar stranded
 * at ~60% of the plot on a lot of real windows.
 */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const niceCeil = (v: number) => {
  if (v <= 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (NICE_STEPS.find((s) => n <= s) ?? 10) * mag;
};

/** Compact peso for axis ticks: ₱1.2M, ₱12k, ₱850. */
const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `₱${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return `₱${Math.round(n)}`;
};

/** Minimal line icons for the overview KPI cards. */
/**
 * The one error card for every admin tab.
 *
 * Section 11 of the design direction asks for exactly this: the eight tabs each
 * carried a near-identical block — same padding, same 30%-danger border, same
 * ⚠️ glyph, same heading weight, same retry — differing only in their title and
 * message. Five copies meant five places to fix whenever the treatment moved,
 * and they had already drifted apart in the danger tint they used.
 */
function AdmErrorCard({ title, message, onRetry, retryLabel = 'Try Again', extraAction }: {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Rendered beside the retry. Carries the auth-expiry route back to sign-in,
      which the menu tab needs and the others do not. */
  extraAction?: React.ReactNode;
}) {
  return (
    <div
      className="adm-card"
      role="alert"
      style={{
        padding: '2.75rem 2rem', textAlign: 'center',
        borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)',
      }}
    >
      {/* Lucide in a tinted disc, per section 11 — the ⚠️ emoji rendered as a
          fixed-colour platform image and could not follow the danger token. */}
      <div
        style={{
          width: 48, height: 48, margin: '0 auto 0.9rem',
          borderRadius: 'var(--r-full)', background: 'var(--danger-muted)',
          color: 'var(--danger)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <AlertTriangle size={22} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
        {title}
      </h3>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8125rem', fontWeight: 400, color: 'var(--danger-ink)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.55 }}>
        {message}
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="adm-btn outline" onClick={onRetry}>{retryLabel}</button>
        {extraAction}
      </div>
    </div>
  );
}

function AdminTabHeader({
  title,
  endpoints,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  actions,
  onRefresh,
  refreshing,
}: {
  title: string;
  endpoints?: React.ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  actions?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {endpoints && (
          <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            Live from the backend — {endpoints}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {onSearchChange && (
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, color: 'var(--text-primary)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '999px', padding: '11px 15px', minWidth: '220px' }}
          />
        )}
        {actions}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            style={{ width: '36px', height: '36px', borderRadius: '999px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1 }}
          >
            <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" className={refreshing ? 'spin' : ''} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
      </div>
    </div>
  );
}

function OvIcon({ name }: { name: 'wallet' | 'clock' | 'calendar' | 'inbox' }) {
  const paths = {
    wallet: (
      <>
        <rect x="2.6" y="5" width="14.8" height="11" rx="2.6" />
        <path d="M2.6 8.6h14.8" />
        <circle cx="14" cy="12.2" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    clock: (
      <>
        <circle cx="10" cy="10" r="7.1" />
        <path d="M10 5.9v4.4l2.9 1.7" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4.6" width="14" height="12.4" rx="2.6" />
        <path d="M3 8.6h14M7 3.1v3M13 3.1v3" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 11.6 5.2 5.3A1.6 1.6 0 0 1 6.7 4.2h6.6a1.6 1.6 0 0 1 1.5 1.1l2.2 6.3v2.9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
        <path d="M3 11.6h3.6l.9 1.9h5l.9-1.9H17" />
      </>
    ),
  }[name];
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}
export const fmtDate = (iso: string) => {
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
export const fmtTime = (hms: string | null | undefined) => {
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

  return createPortal(
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
    </div>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Chat Support (item 3) — customer ↔ staff. Lists every thread, opens one to
   reply, live-refreshes via the "SupportMessage" event on the payment hub.
───────────────────────────────────────────────────────────────────────── */
/* Inbox ordering: urgency band first, most-recent-activity within each band. Threads
   with no draft yet (every thread while drafting is off) share one rank, so the list
   falls back to exactly the LastMessageAt ordering it has always had. */
const URGENCY_RANK: Record<string, number> = { Urgent: 0, Attention: 1, Routine: 2 };
const urgencyRank = (u?: string | null) => (u ? URGENCY_RANK[u] ?? 3 : 3);

/** Small caps label used for the topic and urgency chips in the thread list. */
function InboxChip({ label, tone }: { label: string; tone: 'urgent' | 'attention' | 'neutral' }) {
  const palette = {
    urgent: { bg: 'var(--accent)', fg: 'var(--accent-text)' },
    attention: { bg: 'var(--primary-muted)', fg: 'var(--text-primary)' },
    neutral: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' },
  }[tone];
  return (
    <span style={{
      background: palette.bg, color: palette.fg, fontSize: '0.5rem', fontWeight: 600,
      letterSpacing: '0.08em', textTransform: 'uppercase', borderRadius: 'var(--r-full)',
      padding: '0.1rem 0.4rem', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

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
  /* The draft already poured into the composer. Tracked so a thread refresh (the hub
     fires on every message) cannot re-fill the box underneath someone who is typing. */
  const prefilledDraftRef = useRef<string | null>(null);

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
    prefilledDraftRef.current = null;
    setInput('');
    try {
      setThread(await getSupportThread(session.token, id));
      await loadThreads();   // unread counts change after marking read
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not open the conversation.');
    }
  };

  useEffect(() => { setLoadingThreads(true); void loadThreads(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread]);

  /* Pre-fill the composer from a new draft — once, and never over anything already
     typed. Pre-filling is the ONLY thing a draft does: the box stays fully editable and
     Send always posts whatever is actually in it. */
  useEffect(() => {
    const draft = thread?.draft;
    if (!draft || prefilledDraftRef.current === draft.id) return;
    prefilledDraftRef.current = draft.id;
    setInput((current) => (current.trim() ? current : draft.text));
  }, [thread]);

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
      // Provenance only — the server records Sent or Edited by comparing what was
      // actually posted against the draft text.
      await replySupport(session.token, selectedId, text, file, thread?.draft?.id ?? null);
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    const draft = thread?.draft;
    if (!draft || !selectedId) return;
    const session = readSession();
    if (!session) return;
    try {
      await discardDraft(session.token, selectedId, draft.id);
      setInput('');
      prefilledDraftRef.current = null;
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not discard the draft.');
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

      <div className="adm-split">
        <div className="adm-card" style={{ padding: '0.4rem', maxHeight: '62vh', overflowY: 'auto' }}>
          {loadingThreads ? (
            <div style={{ padding: '1.2rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading…</div>
          ) : threads.length === 0 ? (
            <div style={{ padding: '1.2rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No support threads yet.</div>
          ) : [...threads]
              .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency)
                || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
              .map((t) => (
            <button key={t.id} type="button" onClick={() => void openThread(t.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
              padding: '0.7rem 0.8rem', borderRadius: 'var(--r-lg)', marginBottom: '0.2rem',
              background: selectedId === t.id ? 'var(--primary-muted)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <strong style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.customerName}</strong>
                {t.unreadFromCustomer > 0 && <span style={{ background: 'var(--accent)', color: 'var(--accent-text)', fontSize: '0.55rem', fontWeight: 600, borderRadius: 'var(--r-full)', padding: '0.1rem 0.4rem' }}>{t.unreadFromCustomer}</span>}
                {t.status === 'Closed' && <span style={{ color: 'var(--text-dim)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Closed</span>}
              </div>
              {(t.topic || t.urgency) && (
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                  {t.urgency && <InboxChip label={t.urgency} tone={t.urgency === 'Urgent' ? 'urgent' : t.urgency === 'Attention' ? 'attention' : 'neutral'} />}
                  {t.topic && <InboxChip label={t.topic} tone="neutral" />}
                </div>
              )}
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
              {thread.draft && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.draft.toolsUsed.length > 0
                      ? `Drafted from: ${thread.draft.toolsUsed.join(', ')}`
                      : 'Drafted reply — review before sending'}
                  </span>
                  <button type="button" onClick={() => void discard()} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '0.65rem', padding: 0, textDecoration: 'underline' }}>
                    Discard
                  </button>
                </div>
              )}
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

  /* ── gallery images ───────────────────────────────────────────────────────
     The public "Events by King Jegi" gallery. Deliberately independent of the
     announcement composer above: separate state, separate submit, separate
     endpoint. Posting an announcement never touches these, and uploading here
     never creates an announcement. */
  const [galleryImages, setGalleryImages] = useState<GalleryImageAdmin[]>([]);
  const [galLoading, setGalLoading] = useState(false);
  const [galError, setGalError] = useState<string | null>(null);
  const [galUploading, setGalUploading] = useState(false);
  const [galDeletingId, setGalDeletingId] = useState<string | null>(null);
  const [galCaption, setGalCaption] = useState('');

  const loadGallery = async () => {
    const session = readSession();
    if (!session?.token) {
      setGalError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }
    setGalLoading(true);
    setGalError(null);
    try {
      setGalleryImages(await fetchGalleryForAdmin(session.token));
    } catch (err) {
      setGalError(
        err instanceof GalleryApiError ? err.message : 'Could not load the gallery. Please try again.',
      );
    } finally {
      setGalLoading(false);
    }
  };

  const uploadGalleryImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the same file be re-picked after a removal
    if (picked.length === 0) return;

    const session = readSession();
    if (!session?.token) {
      setGalError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }

    const room = GALLERY_MAX_IMAGES - galleryImages.length;
    const problems: string[] = [];
    const queue: File[] = [];
    for (const file of picked) {
      if (!GALLERY_ACCEPTED_TYPES.includes(file.type)) {
        problems.push(`${file.name} — only JPG, PNG or WebP.`);
      } else if (file.size > GALLERY_MAX_IMAGE_BYTES) {
        problems.push(`${file.name} — over 5 MB.`);
      } else if (queue.length >= room) {
        problems.push(`${file.name} — the gallery is full at ${GALLERY_MAX_IMAGES} images.`);
      } else {
        queue.push(file);
      }
    }

    setGalUploading(true);
    setGalError(null);
    let uploaded = 0;
    try {
      for (const file of queue) {
        // The caption applies to the whole batch — one caption box, so a
        // multi-file pick shares it rather than silently captioning only the first.
        const saved = await uploadGalleryImage(session.token, file, galCaption);
        uploaded += 1;
        // Merged as each lands, so a mid-batch failure still shows what succeeded.
        setGalleryImages((prev) => [...prev, saved]);
      }
      if (uploaded > 0) setGalCaption('');
    } catch (err) {
      problems.push(err instanceof GalleryApiError ? err.message : 'One of the uploads failed.');
    } finally {
      setGalUploading(false);
      setGalError(problems.length > 0 ? problems.join(' ') : null);
      if (uploaded > 0) {
        notify('success', `${uploaded} image${uploaded === 1 ? '' : 's'} added to the gallery.`);
      }
    }
  };

  const removeGalleryImage = async (id: string) => {
    const session = readSession();
    if (!session?.token) {
      setGalError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }
    setGalDeletingId(id);
    setGalError(null);
    try {
      await deleteGalleryImage(session.token, id);
      setGalleryImages((prev) => prev.filter((img) => img.id !== id));
      notify('success', 'Image removed from the gallery.');
    } catch (err) {
      setGalError(err instanceof GalleryApiError ? err.message : 'Could not remove that image.');
    } finally {
      setGalDeletingId(null);
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
  /**
   * The Payments table's own fetch, scoped to one day server-side.
   *
   * Separate from loadPayments so narrowing the table to a date can't narrow the
   * array the Overview tiles and the refund queue read from.
   */
  const loadDatedPayments = async (date: string) => {
    const session = readSession();
    if (!session) {
      setDatedError('You are not signed in. Sign in with an Owner or Assistant account to load payments.');
      setDatedAuthError(true);
      return;
    }
    setDatedLoading(true);
    setDatedError(null);
    setDatedAuthError(false);
    try {
      setDatedPayments(await getRecentPayments(session.token, 200, date));
    } catch (err) {
      if (err instanceof PaymentApiError) {
        setDatedError(err.message);
        setDatedAuthError(err.isAuthError);
      } else {
        setDatedError('Unable to load payments. Please try again.');
      }
    } finally {
      setDatedLoading(false);
    }
  };

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
      // Both: loadPayments backs the Overview tiles and the refund queue, while the
      // dated list is what the table actually renders.
      await Promise.all([loadPayments(), loadDatedPayments(paymentDate)]);
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
  /* A refused request is a different failure from a broken one: retrying it will
     fail the same way until the admin signs in again. 11d gives that case its own
     action rather than a Try Again that cannot succeed. */
  const [servicesAuthError, setServicesAuthError] = useState(false);
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
  /** Whether the toolbar's Filter panel (the booking-type axis) is expanded. */
  const [resFilterOpen, setResFilterOpen] = useState(false);
  const [resSearch, setResSearch] = useState('');
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
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentFilterOpen, setPaymentFilterOpen] = useState(false);

  /* The Payments table is scoped to one day, server-side. It gets its own state and
     loader rather than sharing `payments`: that array also feeds the Overview revenue
     tiles and the refund queue, and narrowing it to a single day would quietly wrong
     those numbers. Defaults to today — never a hardcoded date. */
  const [paymentDate, setPaymentDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
  const [datedPayments, setDatedPayments] = useState<AdminPaymentRecord[]>([]);
  const [datedLoading, setDatedLoading] = useState(false);
  const [datedError, setDatedError] = useState<string | null>(null);
  const [datedAuthError, setDatedAuthError] = useState(false);

  /** Payment awaiting refund confirmation, or null. Nothing reaches the endpoint without it. */
  const [refundTarget, setRefundTarget] = useState<AdminPaymentRecord | null>(null);

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
      // Name / email / phone / event type. Email joined in from Customer on the list
      // read — before that the placeholder claimed to search it and never could.
      .filter(
        (r) =>
          q === '' ||
          (r.bookingName && r.bookingName.toLowerCase().includes(q)) ||
          (r.customerEmail && r.customerEmail.toLowerCase().includes(q)) ||
          (r.contactNumber && r.contactNumber.toLowerCase().includes(q)) ||
          (r.eventType && r.eventType.toLowerCase().includes(q)),
      )
      // Ordering belongs to BookingsTable now — it sorts per column, per group.
  }, [reservations, resFilter, resTypeFilter, resSearch]);

  /* Status / method / booking-type / free-text, over the day the server already
     narrowed to. The date itself is NOT filtered here — doing that over a `take`-capped
     page would report an empty day for any date older than the newest 50 payments. */
  const filteredPayments = useMemo(() => {
    const q = paymentSearch.trim().toLowerCase();
    return datedPayments
      .filter((p) => paymentFilter === 'all' || p.status === paymentFilter)
      .filter((p) => paymentTypeFilter === 'all' || p.bookingType === paymentTypeFilter)
      .filter((p) => paymentMethodFilter === 'all' || p.method === paymentMethodFilter)
      .filter(
        (p) =>
          q === '' ||
          p.invoiceId.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q) ||
          p.customerEmail.toLowerCase().includes(q) ||
          p.bookingName.toLowerCase().includes(q) ||
          (p.transactionReference ?? '').toLowerCase().includes(q),
      );
  }, [datedPayments, paymentFilter, paymentTypeFilter, paymentMethodFilter, paymentSearch]);

  /** Bookings that can still take a cash payment — the Log Cash dropdown's source. */
  const cashCandidates = useMemo(
    () => reservations.filter(
      (b) => (b.status === 'Pending' || b.status === 'Confirmed') && b.depositStatus !== 'Paid',
    ),
    [reservations],
  );

  /** The open refund request for a payment, if the queue has one. */
  const findRefundRequest = (paymentId: string) =>
    refundQueue.find((r) => r.paymentId === paymentId);

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
      setServicesAuthError(true);
      return;
    }

    setServicesLoading(true);
    setServicesError(null);
    setServicesAuthError(false);
    setServiceFeedback(null);

    try {
      const items = await fetchServiceItems(session.token);
      setServiceItems(items);
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServicesError(err.message);
        setServicesAuthError(err.isAuthError);
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
        setServicesAuthError(err.isAuthError);
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
        // 'all' because the booking may not match the current status filter.
        setResSearch(n.bookingName ?? '');
        selectBookingStatus('all');
        break;
      case 'payment':
        /* The old list expanded a row by payment id; the table has no expandable row,
           so the hand-off is a search instead — the same shape as the booking case.
           The date is reset to today because the table is scoped to a single day and a
           payment notification is, by definition, about one that just happened. */
        setPaymentSearch(n.bookingName ?? '');
        setPaymentFilter('all');
        setPaymentMethodFilter('all');
        setPaymentTypeFilter('all');
        {
          const d = new Date();
          const todayIso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
          setPaymentDate(todayIso);
          void loadDatedPayments(todayIso);
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

  /* Row counts per status for the bookings tree-menu. Counted off `reservations`, not
     `filteredRes`, so the numbers don't collapse to the group you already picked. */
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
     calls, so nothing here changes what a click does. */
  const bookingActions: BookingRowActions = {
    onSubmitDraft: (b) => void submitDraftFor(b),
    onOpenDetail: (b) => void openBookingDetail(b),
    onLogCash: (b) => setCashTarget({ bookingId: b.id, bookingName: b.bookingName }),
    onConfirm: (b) => void setResStatus(b.id, 'Confirmed'),
    onMarkCompleted: (b) => void setResStatus(b.id, 'Completed'),
    onOpenInvoice: (b) => void openInvoiceFor(b),
    onGenerateContract: (b) => void openContract(b),
    onAllocateResources: (b) => setResourcesResId(b.id),
    onEditNote: (b) => (noteResId === b.id ? setNoteResId(null) : openNoteEditor(b)),
    onViewHistory: (b) => { openTab('histories'); void openHistory(b.id); },
    onCancel: (b) => { setCancelResId(b.id); setCancelReason(''); },
  };

  /* refetch every time the tab is opened so admin edits elsewhere show up */
  useEffect(() => {
    if (tab === 'overview' || tab === 'payments') void loadPayments();
    if (tab === 'payments') void loadDatedPayments(paymentDate);
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
    if (tab === 'announcements') { void loadAnnouncements(); void loadGallery(); }
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
    Delivered: { color: 'var(--warning)', label: 'Out' },
    Damaged: { color: 'var(--danger)', label: 'Needs maintenance' },
    Returned: { color: 'var(--status-paid)', label: 'Back in stock' },
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

  const salesMonths = salesReport?.months ?? [];
  /* Chart scale. Net and refunds share one axis so a heavy refund month isn't
     clipped, and the ceiling is rounded up to a readable step. Guarded against an
     all-zero window, which would otherwise divide every bar height by zero. */
  const chartTop = niceCeil(Math.max(0, ...salesMonths.map((m) => Math.max(m.net, m.refunds))));
  const chartTicks = [4, 3, 2, 1, 0].map((i) => (chartTop / 4) * i);
  const barPct = (v: number) => (chartTop > 0 ? Math.round((v / chartTop) * 100) : 0);

  /* KPI cards. Only revenue has a real historical series behind it (netChangeRatio
     = first vs. last month); the other three report the share of their queue that
     needs attention, which is the closest honest figure the API exposes. All four
     read 0% on an empty dataset. */
  const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const revenueTrend = Math.round((salesReport?.netChangeRatio ?? 0) * 100);
  const activeRes = reservations.filter((r) => r.status === 'Pending' || r.status === 'Confirmed').length;

  const ovMetrics: {
    label: string; value: string; sub: string;
    icon: 'wallet' | 'clock' | 'calendar' | 'inbox';
    accent: boolean; trend: number; dir: 'up' | 'down'; trendHint: string;
  }[] = [
    {
      label: 'Total Revenue', value: fmt(totalRevenue), sub: 'from confirmed payments',
      icon: 'wallet', accent: true,
      trend: revenueTrend, dir: revenueTrend < 0 ? 'down' : 'up',
      trendHint: `Net collected, first vs. last of the past ${SALES_MONTHS} months`,
    },
    {
      label: 'Pending Payments', value: String(pendingPayments.length),
      sub: `${fmt(pendingPayTotal)} awaiting confirmation`,
      icon: 'clock', accent: false,
      trend: share(pendingPayments.length, payments.length), dir: 'down',
      trendHint: 'Share of all payments still unconfirmed',
    },
    {
      label: 'Upcoming Events', value: String(upcomingCount), sub: 'within the next 30 days',
      icon: 'calendar', accent: false,
      trend: share(upcomingCount, activeRes), dir: 'up',
      trendHint: 'Share of active bookings landing in the next 30 days',
    },
    {
      label: 'Pending Reservations', value: String(pendingRes.length), sub: 'awaiting your review',
      icon: 'inbox', accent: false,
      trend: share(pendingRes.length, reservations.length), dir: 'up',
      trendHint: 'Share of all reservations still waiting on a decision',
    },
  ];

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

        .adm-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(27, 16, 36, 0.32); display: none; }

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
            radial-gradient(120% 95% at 92% 4%, rgba(242, 193, 209, 0.38) 0%, rgba(242, 193, 209, 0) 58%),
            linear-gradient(142deg, #4a2c60 0%, #2e1a3e 52%, #1b1024 100%);
          box-shadow: 0 10px 30px rgba(27, 16, 36, 0.28);
        }
        .adm-ov-kpi.accent .lbl { color: rgba(247, 239, 244, 0.9); }
        .adm-ov-kpi.accent .num { color: #f7eff4; }
        .adm-ov-kpi.accent .foot { color: rgba(247, 239, 244, 0.84); }
        .adm-ov-kpi.accent .ico { background: rgba(247, 239, 244, 0.16); color: #f7eff4; }

        .adm-ov-badge {
          display: inline-flex; align-items: center; gap: 0.15rem;
          padding: 0.16rem 0.44rem; border-radius: 999px;
          font-size: 0.655rem; font-weight: 600; letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .adm-ov-badge.up   { background: var(--ov-lime-soft); color: var(--ov-lime-ink); }
        .adm-ov-badge.down { background: var(--ov-neg); color: var(--ov-neg-ink); }
        .adm-ov-kpi.accent .adm-ov-badge { background: rgba(242, 193, 209, 0.20); color: #f2c1d1; }

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
                  <StatusBadge label={RES_STATUS[b.status as ResStatus]?.label ?? b.status} color={RES_STATUS[b.status as ResStatus]?.color ?? 'var(--text-muted)'} />
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
              <div className="fade-up adm-ov" style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
                <div>
                  <h1 className="adm-title" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.1rem)' }}>
                    Good day,{' '}
                    <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{adminName.split(' ')[0]}</em>
                  </h1>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    Here's the business at a glance.
                  </p>
                </div>

                {/* ── top region: KPI grid + sales panel ── */}
                <div className="adm-ov-top">

                  {/* metrics — 2x2 */}
                  <div className="adm-ov-kpis">
                    {ovMetrics.map((m) => (
                      <div key={m.label} className={`adm-ov-surface adm-ov-kpi${m.accent ? ' accent' : ''}`}>
                        <div className="top">
                          <span className="lbl">{m.label}</span>
                          <span className="ico"><OvIcon name={m.icon} /></span>
                        </div>
                        <div className="num">{m.value}</div>
                        <div className="foot">
                          <span className={`adm-ov-badge ${m.dir}`} title={m.trendHint}>
                            {m.dir === 'up' ? '↑' : '↓'} {Math.abs(m.trend)}%
                          </span>
                          <span>{m.sub}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* monthly sales report — real collected money, net of refunds */}
                  <div className="adm-ov-surface adm-ov-panel">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.9rem', flexWrap: 'wrap' }}>
                      <div>
                        <h3>Monthly Sales</h3>
                        <p className="sub">
                          Net collected: <b>{fmt(Math.round(salesReport?.totalNet ?? 0))}</b>
                          {'  |  '}
                          Refunded: <b>{fmt(Math.round(salesReport?.totalRefunds ?? 0))}</b>
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <div className="adm-ov-legend">
                          <span><i style={{ background: 'var(--ov-lime)' }} />Net Collected</span>
                          <span><i style={{ background: 'var(--ov-charcoal)' }} />Refunded</span>
                        </div>
                        <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Refresh sales report" onClick={() => void loadSalesReport()} disabled={salesLoading}>
                          ↻
                        </button>
                      </div>
                    </div>

                    {salesError && (
                      <p style={{ fontSize: '0.74rem', color: 'var(--danger)', margin: '0.7rem 0 0' }}>
                        {salesError}
                      </p>
                    )}

                    {salesLoading && !salesReport && (
                      <div className="adm-skel" style={{ height: 178, marginTop: '1.15rem', borderRadius: 14 }} aria-hidden="true" />
                    )}

                    {salesReport && (
                      <>
                        <div className="adm-ov-chart">
                          <div className="ax">
                            {chartTicks.map((t, i) => <span key={i}>{fmtCompact(t)}</span>)}
                          </div>
                          <div className="adm-ov-plot">
                            <div className="grid" aria-hidden="true">
                              {chartTicks.map((_, i) => <i key={i} />)}
                            </div>
                            <div className="bars">
                              {salesMonths.map((m) => (
                                <div
                                  key={`${m.year}-${m.month}`}
                                  className="adm-ov-grp"
                                  title={`${m.label} — net ${fmt(Math.round(m.net))}, refunded ${fmt(Math.round(m.refunds))}, from ${m.paymentCount} payment(s) across ${m.bookingCount} booking(s)`}
                                >
                                  <div className="adm-ov-bar net" style={{ height: `${barPct(m.net)}%` }} />
                                  <div className="adm-ov-bar ref" style={{ height: `${barPct(m.refunds)}%` }} />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="adm-ov-months">
                            {salesMonths.map((m) => <span key={`${m.year}-${m.month}`}>{m.label.split(' ')[0]}</span>)}
                          </div>
                        </div>

                        {/* AI summary — on demand, because each fresh window costs a Gemini call */}
                        <div className="adm-ov-ai">
                          {salesSummary ? (
                            <>
                              <span className="cap">{salesSummary.generated ? 'AI Summary' : 'Summary Unavailable'}</span>
                              <p style={{ color: salesSummary.generated ? undefined : 'var(--ov-muted)' }}>
                                {salesSummary.summary}
                              </p>
                              <button type="button" className="adm-ov-btn" onClick={() => void loadSalesSummary()} disabled={summaryLoading}>
                                {summaryLoading ? 'Thinking…' : <><RotateCw size={13} strokeWidth={2} aria-hidden="true" /> Regenerate</>}
                              </button>
                            </>
                          ) : (
                            <button type="button" className="adm-ov-btn" onClick={() => void loadSalesSummary()} disabled={summaryLoading}>
                              {summaryLoading ? 'Thinking…' : '✦ Summarize these numbers'}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ── event calendar — spans the full width beneath both ── */}
                <div className="adm-ov-surface adm-ov-cal">
                  <div className="adm-cal-head">
                    <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Previous month" onClick={() => setCalMonth(new Date(calYear, calMo - 1, 1))}>
                      ‹
                    </button>
                    <span className="adm-cal-title">
                      {calMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                    </span>
                    <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Next month" onClick={() => setCalMonth(new Date(calYear, calMo + 1, 1))}>
                      ›
                    </button>
                  </div>
                  <div className="adm-cal-grid">
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
                            // Longhand rather than the `background` shorthand, which
                            // would also reset background-image/position on every cell.
                            backgroundColor: manual
                              ? 'var(--ov-neg)'
                              : locked ? 'var(--ov-lime-soft)'
                              : isToday ? 'var(--ov-lime)' : 'var(--ov-chip)',
                            borderColor: lockTargetDate === dateStr ? 'var(--ov-charcoal)' : 'transparent',
                          }}
                        >
                          <div className="d" style={{ color: isToday ? 'var(--ov-charcoal)' : undefined }}>{day}</div>
                          {dayEvents.slice(0, 2).map((ev) => {
                            const c = RES_STATUS[ev.status as ResStatus]?.color || 'var(--text-muted)';
                            return (
                              <span key={ev.id} className="adm-cal-ev" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
                                {ev.bookingName}
                              </span>
                            );
                          })}
                          {manual ? (
                            <span className="adm-cal-ev" style={{ color: 'var(--ov-neg-ink)', fontWeight: 600 }}>🔒 locked</span>
                          ) : locked ? (
                            <span className="adm-cal-ev" style={{ color: 'var(--ov-lime-ink)', fontWeight: 600 }}>● full</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {calendarError && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--danger)', padding: '0 1.25rem 0.8rem', margin: 0 }}>
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
                      <div className="adm-cal-foot">
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <strong style={{ color: 'var(--ov-ink)', fontWeight: 600 }}>{fmtDate(lockTargetDate)}</strong>
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
                        <button type="button" className="adm-ov-btn" onClick={() => setLockTargetDate(null)}>Close</button>
                      </div>
                    );
                  })()}
                </div>

                {/* day schedule — double-click a calendar cell. Built entirely from the
                    `reservations` array the dashboard already loads, so opening it
                    costs no request. */}
                {dayDetailDate && (() => {
                  const dayBookings = reservations
                    .filter((r) => r.eventDate === dayDetailDate)
                    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
                  const cal = calendarDays.get(dayDetailDate);
                  return createPortal(
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
                                  <StatusBadge label={st?.label ?? r.status} color={st?.color ?? 'var(--text-muted)'} />
                                  <button
                                    type="button"
                                    className="adm-btn outline"
                                    onClick={() => {
                                      // Same hand-off the notification feed uses: search the
                                      // Bookings tab for this booking by name.
                                      setDayDetailDate(null);
                                      setResSearch(r.bookingName);
                                      // Clears the status filter too: without it, opening a
                                      // Confirmed booking while the filter sat on Draft landed
                                      // on an empty table.
                                      selectBookingStatus('all');
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
                    </div>,
                    document.body
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
                    <button type="button" className="adm-btn outline" onClick={() => selectBookingStatus('Pending')}>Review All →</button>
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
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <h2 className="adm-title">Bookings</h2>

                <BookingsToolbar
                  search={resSearch}
                  onSearchChange={setResSearch}
                  typeFilter={resTypeFilter}
                  onTypeFilterChange={setResTypeFilter}
                  filterOpen={resFilterOpen}
                  onToggleFilter={() => setResFilterOpen((o) => !o)}
                  onAddBooking={() => setNewBookingOpen(true)}
                />

                {newBookingOpen && (
                  <NewBookingModal
                    onClose={() => setNewBookingOpen(false)}
                    onCreated={() => { setNewBookingOpen(false); void loadBookings(); }}
                    notify={notify}
                  />
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', minWidth: 0 }}>
                  {/* Cancellation requests are the one thing that has to be visible
                      without opening a row — the customer is waiting on a decision. */}
                  {filteredRes.some((r) => r.cancellationRequested) && (
                    <div className="adm-card" style={{ padding: '0.9rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <FieldLabel text="Cancellation requested" />
                      {filteredRes.filter((r) => r.cancellationRequested).map((r) => (
                        <p key={r.id} style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', margin: 0 }}>
                          <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.bookingName}</strong>
                          {' — '}{r.cancellationRequestReason || 'no reason given'}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Staff-note editor. Opened from the row menu; kept out of the table
                      so a 2000-character textarea can't stretch a cell. */}
                  {noteResId && (() => {
                    const target = reservations.find((r) => r.id === noteResId);
                    if (!target) return null;
                    return (
                      <div className="adm-card" style={{ padding: '1rem 1.15rem' }}>
                        <FieldLabel text={`Internal staff note · ${target.bookingName} — not shown to the customer`} />
                        <textarea
                          className="adm-input"
                          style={{ width: '100%', minHeight: 80, marginTop: '0.35rem', resize: 'vertical' }}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          maxLength={2000}
                          placeholder="Allergies, venue access, who to call on site…"
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          <button type="button" className="adm-btn primary" disabled={noteBusyId === noteResId} onClick={() => void saveAdminNote(noteResId)}>
                            {noteBusyId === noteResId ? 'Saving…' : 'Save Note'}
                          </button>
                          <button type="button" className="adm-btn outline" onClick={() => setNoteResId(null)}>Cancel</button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Cancel still routes through the existing reason prompt — the
                      server requires one, so the menu item opens this rather than
                      firing cancelReservation straight off a click. */}
                  {cancelResId && (() => {
                    const target = reservations.find((r) => r.id === cancelResId);
                    if (!target) return null;
                    return (
                      <div className="adm-card" style={{ padding: '1rem 1.15rem', display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <FieldLabel text={`Reason for cancelling ${target.bookingName}`} />
                          <input className="adm-input square" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Required" />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="adm-btn danger" disabled={!cancelReason.trim()} onClick={() => cancelReservation(cancelResId)}>
                            Confirm Cancel
                          </button>
                          <button type="button" className="adm-btn outline" onClick={() => setCancelResId(null)}>Back</button>
                        </div>
                      </div>
                    );
                  })()}

                  <BookingsTable
                    rows={filteredRes}
                    activeGroup={resFilter}
                    actions={bookingActions}
                    busy={{ submitBusyId, detailBusyId, invoiceBusyId, contractBusyId }}
                    onViewAll={(g) => selectBookingStatus(g)}
                  />
                </div>
              </div>
            )}

            {/* ══════════ PAYMENTS (live backend data) ══════════ */}
            {tab === 'payments' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                  <div>
                    <h2 className="adm-title">Payments</h2>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                      Live from the backend — <code style={{ fontSize: '0.66rem' }}>/api/Payments/recent</code>
                    </p>
                  </div>

                <PaymentsToolbar
                  search={paymentSearch}
                  onSearchChange={setPaymentSearch}
                  statusFilter={paymentFilter}
                  onStatusFilterChange={(k) => setPaymentFilter(k as 'all' | PaymentStatusKey)}
                  typeFilter={paymentTypeFilter}
                  onTypeFilterChange={setPaymentTypeFilter}
                  methodFilter={paymentMethodFilter}
                  onMethodFilterChange={setPaymentMethodFilter}
                  filterOpen={paymentFilterOpen}
                  onToggleFilter={() => setPaymentFilterOpen((o) => !o)}
                  date={paymentDate}
                  onDateChange={(d) => { setPaymentDate(d); void loadDatedPayments(d); }}
                  cashCandidates={cashCandidates}
                  onLogCash={(b) => setCashTarget({ bookingId: b.id, bookingName: b.bookingName })}
                />

                {/* Failure of the UNDATED load — the refund queue and the Overview
                    totals ride on it. The table reports its own dated load separately,
                    so without this a broken queue fetch would fail silently. */}
                {paymentsError && (
                  <div className="adm-card" style={{ padding: '0.85rem 1.1rem', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)', display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', color: 'var(--danger)', flex: 1, minWidth: 200 }}>
                      Refund queue unavailable — {paymentsError}
                    </span>
                    {paymentsAuthError
                      ? <Link to="/login" className="adm-btn primary">Go to Sign In</Link>
                      : <button type="button" className="adm-btn outline" onClick={() => void loadPayments()}>Try Again</button>}
                  </div>
                )}

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

                <PaymentsTable
                  rows={filteredPayments}
                  busyId={paymentActionBusy}
                  loading={datedLoading}
                  error={datedError}
                  isAuthError={datedAuthError}
                  onRetry={() => void loadDatedPayments(paymentDate)}
                  findRequest={findRefundRequest}
                  statusMeta={paymentStatusMeta}
                  actions={{
                    onConfirm: (p) => void runPaymentAction(p.id, 'confirm'),
                    onReject: (p) => void runPaymentAction(p.id, 'reject'),
                    // Never straight to the endpoint — the modal is the confirmation step.
                    onRefund: (p) => setRefundTarget(p),
                    onDenyRefund: (p) => { setDenyTargetId(p.id); setDenyReason(''); },
                  }}
                />

                {/* Deny prompt for a row-menu denial. The queue panel above has its own
                    inline version; both call the same handler. */}
                {denyTargetId && !refundQueue.some((r) => r.paymentId === denyTargetId) && (
                  <div className="adm-card" style={{ padding: '1rem 1.15rem', display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <FieldLabel text="Reason shown to the customer" />
                      <input className="adm-input square" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Required" />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="adm-btn danger"
                        disabled={!denyReason.trim() || paymentActionBusy === denyTargetId}
                        onClick={() => void runPaymentAction(denyTargetId, 'deny', { reason: denyReason.trim() })}
                      >
                        Confirm Denial
                      </button>
                      <button type="button" className="adm-btn outline" onClick={() => setDenyTargetId(null)}>Back</button>
                    </div>
                  </div>
                )}

                {refundTarget && (
                  <RefundConfirmModal
                    payment={refundTarget}
                    request={findRefundRequest(refundTarget.id)}
                    busy={paymentActionBusy === refundTarget.id}
                    onCancel={() => setRefundTarget(null)}
                    onConfirm={(amount) => {
                      const id = refundTarget.id;
                      setRefundTarget(null);
                      void runPaymentAction(id, 'refund', { amount });
                    }}
                  />
                )}
              </div>
            )}

            {/* ══════════ AUDIT LOG (live backend data, Owner-only) ══════════ */}
            {tab === 'audit' && (
              <div className="fade-up" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>Audit Log</h2>
                    <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
                      Live from the backend — <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--text-muted)' }}>/api/Auditlogs</span> · Owner only
                    </p>
                  </div>
                  <span onClick={() => void loadAuditLogs(auditPage)} style={{ width: '34px', height: '34px', borderRadius: '999px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {auditLoading ? <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--text-secondary)', animation: 'spin 1s linear infinite' }} /> : <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />}
                  </span>
                </div>

                {auditError && !auditLoading && (
                  <div style={{ padding: '1.4rem 1.6rem', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: '14px', background: 'var(--surface)' }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
                      {auditError}
                    </p>
                  </div>
                )}

                {auditLoading && (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.4rem 1.6rem' }} aria-hidden="true">
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
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                        {auditPage === 1 ? 'No audit entries recorded yet.' : 'No more entries.'}
                      </div>
                    ) : (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '4px 18px' }}>
                        {auditRows.map((row, idx) => {
                          const actionColor = row.action === 'CREATE' ? 'var(--primary)' : row.action === 'DELETE' ? 'var(--danger)' : 'var(--warning)';
                          const actionBg = row.action === 'CREATE' ? 'rgba(46,26,62,.12)' : row.action === 'DELETE' ? 'rgba(220,38,38,.12)' : 'rgba(180,116,26,.14)';
                          return (
                            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: idx < auditRows.length - 1 ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                              <div style={{ flex: 1, minWidth: '220px' }}>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                                  {row.targetTable}<span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)' }}> · {row.targetId.substring(0, 8)}</span>
                                </div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)', marginTop: '4px' }}>
                                  {fmtDateTime(row.changedAt)} · admin {row.adminId.substring(0, 8)}
                                </div>
                              </div>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', background: actionBg, color: actionColor }}>
                                {row.action}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <button type="button" disabled={auditPage <= 1} onClick={() => void loadAuditLogs(auditPage - 1)} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', padding: '11px 18px', borderRadius: '999px', opacity: auditPage <= 1 ? 0.45 : 1, cursor: auditPage <= 1 ? 'not-allowed' : 'pointer' }}>
                        ‹ Newer
                      </button>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)' }}>Page {auditPage}</span>
                      <button type="button" disabled={auditRows.length < AUDIT_PAGE_SIZE} onClick={() => void loadAuditLogs(auditPage + 1)} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', padding: '11px 18px', borderRadius: '999px', opacity: auditRows.length < AUDIT_PAGE_SIZE ? 0.45 : 1, cursor: auditRows.length < AUDIT_PAGE_SIZE ? 'not-allowed' : 'pointer' }}>
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
              <div className="fade-up" style={{ background: 'var(--band-bg)', border: '1px solid var(--band-glass-border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', lineHeight: 1.1, color: 'var(--band-text)' }}>Testimonial Moderation</h2>
                    <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.5, color: 'var(--band-muted)' }}>
                      Live from the backend — <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--band-muted)' }}>/api/Testimonials</span> · approved reviews appear on the landing page
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1, color: 'var(--band-muted)' }}>
                      {pendingTesti} pending review
                    </span>
                    <span onClick={() => void loadTestimonials()} style={{ width: '34px', height: '34px', borderRadius: '999px', background: 'rgba(247,239,244,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      {testiLoading ? <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--band-text)', animation: 'spin 1s linear infinite' }} /> : <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--band-text)' }} />}
                    </span>
                  </div>
                </div>

                {testiError && (
                  <div style={{ padding: '1.4rem 1.6rem', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: '16px' }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
                      {testiError}
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                  {(['Pending', 'Approved', 'Rejected', 'all'] as const).map((k) => {
                    const count = k === 'all' ? testimonials.length : testimonials.filter((t) => t.status === k).length;
                    const isActive = testiFilter === k;
                    return (
                      <span
                        key={k}
                        onClick={() => setTestiFilter(k)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: isActive ? 600 : 500, lineHeight: 1, padding: '10px 15px', borderRadius: '999px', background: isActive ? 'var(--accent)' : 'rgba(247,239,244,.07)', color: isActive ? 'var(--band-bg)' : 'var(--band-muted)', cursor: 'pointer' }}
                      >
                        {k === 'all' ? 'All' : TESTI_STATUS[k].label}
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 500, lineHeight: 1, color: isActive ? 'var(--band-bg)' : 'var(--band-muted)' }}>{count}</span>
                      </span>
                    );
                  })}
                </div>

                {filteredTesti.length === 0 ? (
                  <div style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--band-muted)', background: 'var(--band-glass)', border: '1px solid var(--band-glass-border)', borderRadius: '18px' }}>
                    No testimonials in this view.
                  </div>
                ) : (
                  filteredTesti.map((t) => {
                    return (
                      <div key={t.id} style={{ background: 'var(--band-glass)', border: '1px solid var(--band-glass-border)', borderRadius: '18px', padding: '20px 22px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
                          <span style={{ flex: 'none', width: '42px', height: '42px', borderRadius: '999px', background: 'rgba(232,112,154,.16)', border: '1px solid rgba(232,112,154,.34)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: 600, lineHeight: 1, color: 'var(--accent)' }}>
                            {t.authorName.charAt(0)}
                          </span>
                          <div style={{ flex: 1, minWidth: '220px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--band-text)' }}>{t.authorName}</span>
                              <span style={{ display: 'flex', gap: '2px' }} aria-label={`${t.rating} out of 5`}>
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star key={i} size={13} strokeWidth={1.75} fill={i < t.rating ? 'var(--band-accent)' : 'var(--band-border)'} color={i < t.rating ? 'var(--band-accent)' : 'var(--band-border)'} />
                                ))}
                              </span>
                            </div>
                            <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-body)', fontSize: '15px', fontWeight: 400, lineHeight: 1.6, fontStyle: 'italic', color: 'var(--band-muted)' }}>
                              "{t.body}"
                            </p>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--band-muted)' }}>
                              Submitted {fmtDate(t.submittedAt)} · {t.customerEmail} · reviewing "{t.bookingName}" ({fmtDate(t.eventDate)})
                            </span>
                          </div>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', background: t.status === 'Pending' ? 'rgba(232,180,95,.18)' : t.status === 'Approved' ? 'rgba(31,122,51,.18)' : 'rgba(220,38,38,.18)', color: t.status === 'Pending' ? '#E8B45F' : t.status === 'Approved' ? '#4ade80' : '#f87171' }}>
                            {t.status}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap', marginTop: '16px' }}>
                          {t.status !== 'Approved' && (
                            <button type="button" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Approved')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: '#1F7A33', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '999px', cursor: 'pointer' }}>
                              {testiBusyId === t.id ? 'Saving...' : <><Check size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: '#fff' }} /> Approve — publish to landing page</>}
                            </button>
                          )}
                          {t.status !== 'Rejected' && (
                            <button type="button" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Rejected')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: '#DC2626', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '999px', cursor: 'pointer' }}>
                              {testiBusyId === t.id ? 'Saving...' : <><X size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: '#fff' }} /> {t.status === 'Approved' ? 'Remove from landing page' : 'Reject'}</>}
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
              <div className="fade-up" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>Booking Histories</h2>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-muted)', maxWidth: '56ch' }}>
                    Live from the backend — <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--text-muted)' }}>/api/Bookings/[id]/history</span>. Every mutating call writes a snapshot of the booking as it was <em>before</em> the change.
                  </p>
                </div>

                <div className="adm-split adm-split--history">

                  {/* booking picker */}
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '16px' }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>Select a booking</div>
                    <input
                      placeholder="Search by name…"
                      style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '11px', marginBottom: '12px' }}
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
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
                              display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
                              padding: '10px 4px', borderBottom: '1px solid var(--border)',
                              background: historyBookingId === r.id ? 'rgba(46,26,62,.07)' : 'transparent',
                              borderRadius: historyBookingId === r.id ? '8px' : '0'
                            }}
                          >
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                              {r.bookingName}
                            </div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.3, color: 'var(--text-muted)', marginTop: '3px' }}>
                              {fmtDate(r.eventDate)} · {r.status}
                            </div>
                          </button>
                        ))}
                      {reservations.length === 0 && (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', margin: '10px 4px' }}>
                          No bookings loaded.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* revision timeline */}
                  {!historyBookingId ? (
                    <div style={{ background: 'var(--bg)', border: '1px dashed var(--border-strong)', borderRadius: '14px', padding: '22px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                      Pick a booking to see how it changed over time.
                    </div>
                  ) : (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px 20px' }}>
                      {historyLoading ? (
                        <>
                          <div className="adm-skel" style={{ height: '0.9rem', width: '45%', marginBottom: '1rem' }} aria-hidden="true" />
                          <div className="adm-skel" style={{ height: '3.6rem', marginBottom: '0.7rem' }} aria-hidden="true" />
                          <div className="adm-skel" style={{ height: '3.6rem' }} aria-hidden="true" />
                        </>
                      ) : historyError ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, color: 'var(--danger)', margin: 0 }}>
                          {historyError}
                        </p>
                      ) : historyRows.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)', textAlign: 'center', margin: '2rem 0' }}>
                          No revisions recorded — this booking hasn't been changed since it was created.
                        </p>
                      ) : (() => {
                        const current = reservations.find((r) => r.id === historyBookingId);
                        const ordered = [...historyRows].sort((a, b) => b.revisionNumber - a.revisionNumber);
                        return (
                          <>
                            {ordered.map((row, idx) => {
                              const before = parseSnapshot(row.snapshotJson);
                              const nextRow = historyRows.find((h) => h.revisionNumber === row.revisionNumber + 1);
                              const after = nextRow ? parseSnapshot(nextRow.snapshotJson) : current ? bookingAsSnapshot(current) : null;
                              const changes = diffSnapshots(before, after);
                              
                              const isLast = idx === ordered.length - 1;
                              const isFirst = idx === 0;

                              return (
                                <div key={row.id} style={{ display: 'flex', gap: '14px', paddingBottom: isLast ? '0' : '16px', paddingTop: isFirst ? '0' : '16px', borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                                  <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ width: '9px', height: '9px', borderRadius: '999px', background: isFirst ? 'var(--accent)' : 'var(--border-strong)' }}></span>
                                    {!isLast && <span style={{ width: '1px', flex: 1, background: 'var(--border)' }}></span>}
                                  </span>
                                  <span style={{ flex: 1 }}>
                                    {changes.length === 0 ? (
                                      <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                                        {row.changeReason || `Revision ${row.revisionNumber}`}
                                      </span>
                                    ) : (
                                      changes.map((c) => (
                                        <span key={c.key} style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                          {c.label} <span style={{ opacity: 0.6, textDecoration: 'line-through' }}>{c.from}</span> → {c.to}
                                        </span>
                                      ))
                                    )}
                                    <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)', marginTop: '4px' }}>
                                      {fmtDateTime(row.snapshotAt)} · {row.changedById ? `staff ${row.changedById.slice(0, 8)}` : 'customer'}
                                    </span>
                                  </span>
                                </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ══════════ MENUS & DISHES (live backend data) ══════════ */}
            {tab === 'menus' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <AdminTabHeader
                  title="Menus & Dishes"
                  endpoints={<><code style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>/api/Menuitems</code> · <code style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>/api/Menutrays</code></>}
                  searchPlaceholder="Search dishes and trays…"
                  searchValue={menuSearch}
                  onSearchChange={setMenuSearch}
                  onRefresh={() => void loadMenuCatalog()}
                  refreshing={menuLoading}
                  actions={
                    <>
                      <button type="button" onClick={() => openMenuForm('item', 'create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
                        + Add Dish
                      </button>
                      <button type="button" onClick={() => openMenuForm('tray', 'create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--status-paid)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
                        + Add Tray
                      </button>
                    </>
                  }
                />

                {/* ── error state ── */}
                {menuError && !menuLoading && (
                  <AdmErrorCard
                    title="Couldn't load the menu catalog"
                    message={menuError}
                    onRetry={() => void loadMenuCatalog()}
                    extraAction={menuAuthError ? <Link to="/login" className="adm-btn primary">Go to Sign In</Link> : undefined}
                  />
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
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 44px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Dish</span>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Category</span>
                            <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Per tray</span>
                            <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Serves</span>
                            <span style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</span>
                            <span></span>
                          </div>
                          <div>
                            {visibleMenuItems.map((m) => (
                              <div key={m.id} className="adm-datarow" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 44px', gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', opacity: m.isActive ? 1 : 0.55 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                  <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {m.imageUrl ? (
                                      <img src={getFullImageUrl(m.imageUrl)!} alt={m.itemName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '13px' }} />
                                    ) : (
                                      <UtensilsCrossed size={22} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                                    )}
                                  </div>
                                  <div>
                                    <h4 style={{ margin: '0 0 3px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--text-primary)' }}>{m.itemName}</h4>
                                    <p style={{ margin: '0 0 6px', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>{m.description}</p>
                                    {m.dietaryTags.length > 0 && (
                                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                        {m.dietaryTags.map((t) => (
                                          <span key={t} style={{ display: 'inline-block', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 500, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-muted)', border: '1px solid var(--border-accent)', borderRadius: '999px', padding: '3px 8px' }}>
                                            {t}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, color: 'var(--primary)', background: 'var(--primary-muted)', padding: '5px 9px 5px 5px', borderRadius: '6px' }}>
                                    <span style={{ width: '4px', height: '14px', borderRadius: '999px', background: 'var(--primary)' }}></span>
                                    {m.itemCategory}
                                  </span>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>
                                    {m.pricePerTray != null ? fmt(m.pricePerTray) : '—'}
                                  </span>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)' }}>
                                    {m.servesPerTray != null ? m.servesPerTray : '—'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: m.isActive ? 'var(--accent-text)' : 'var(--text-primary)', background: m.isActive ? 'var(--accent)' : 'var(--bg-subtle)', border: m.isActive ? 'none' : '1px solid var(--border)', padding: '5px 9px', borderRadius: '999px' }}>
                                    {m.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                  <button type="button" onClick={() => openMenuForm('item', 'edit', { itemName: m.itemName, itemCategory: m.itemCategory, courseCategory: m.courseCategory, description: m.description, dietaryTags: m.dietaryTags, pricePerTray: m.pricePerTray, servesPerTray: m.servesPerTray, menuPackageId: m.menuPackageId, imageUrl: m.imageUrl }, m.id)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                    <Pencil size={14} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
                                  </button>
                                  <button type="button" onClick={() => void toggleMenuEntryActive('item', m.id, !m.isActive)} disabled={menuLoading} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                    {m.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
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
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 110px 100px 90px 44px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tray Name</span>
                            <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Per tray</span>
                            <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Serves</span>
                            <span style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</span>
                            <span></span>
                          </div>
                          <div>
                            {visibleMenuTrays.map((t) => (
                              <div key={t.id} className="adm-datarow adm-datarow--onfill" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 110px 100px 90px 44px', gap: '10px', padding: '16px 26px', alignItems: 'center', background: 'var(--primary)', borderBottom: '1px solid var(--border)', opacity: t.isActive ? 1 : 0.55 }}>
                                <div>
                                  <h4 style={{ margin: '0 0 3px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--primary-text)' }}>{t.trayName}</h4>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {t.dishes.map((d, i) => (
                                      <React.Fragment key={d.id}>
                                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'color-mix(in srgb, var(--primary-text) 72%, transparent)' }}>{d.itemName}</span>
                                        {i < t.dishes.length - 1 && <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'color-mix(in srgb, var(--primary-text) 34%, transparent)' }}>·</span>}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--primary-text)' }}>{fmt(t.pricePerTray)}</span>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'color-mix(in srgb, var(--primary-text) 72%, transparent)' }}>{t.servesMin} - {t.servesMax}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: t.isActive ? 'var(--accent-text)' : 'var(--primary-text)', background: t.isActive ? 'var(--accent)' : 'color-mix(in srgb, var(--primary-text) 12%, transparent)', padding: '5px 9px', borderRadius: '999px' }}>
                                    {t.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                  <button type="button" onClick={() => openMenuForm('tray', 'edit', { trayName: t.trayName, pricePerTray: t.pricePerTray, servesMin: t.servesMin, servesMax: t.servesMax, dishItemIds: t.dishes.map((d) => d.id) }, t.id)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--primary-text) 22%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                    <Pencil size={14} strokeWidth={2} style={{ color: 'color-mix(in srgb, var(--primary-text) 72%, transparent)' }} />
                                  </button>
                                  <button type="button" onClick={() => void toggleMenuEntryActive('tray', t.id, !t.isActive)} disabled={menuLoading} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--primary-text) 22%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                    {t.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {menuFormOpen && createPortal(
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
                  </div>,
                  document.body
                )}
              </div>
            )}

            {/* ══════════ RENTALS (live backend data) ══════════ */}
            {tab === 'rentals' && (
                  <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <AdminTabHeader
                      title="Rentals"
                      endpoints="Manage party rental equipment and sync changes with the C# backend."
                      searchPlaceholder="Search name or category…"
                      searchValue={rentalSearch}
                      onSearchChange={setRentalSearch}
                      onRefresh={() => void loadRentalCatalog()}
                      refreshing={rentalsLoading}
                      actions={
                        <button type="button" onClick={() => openRentalForm('create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
                          + Add Rental Item
                        </button>
                      }
                    />

                    {rentalFeedback && (
                      <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--status-paid) 35%, transparent)', background: 'color-mix(in srgb, var(--status-paid) 10%, transparent)' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--status-paid)' }}>{rentalFeedback}</div>
                      </div>
                    )}

                    {rentalsError && !rentalsLoading && (
                      <AdmErrorCard
                        title="Rental inventory unavailable"
                        message={rentalsError}
                        onRetry={() => void loadRentalCatalog()}
                      />
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
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 60px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Item</span>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Category</span>
                              <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Unit price</span>
                              <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total</span>
                              <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Out</span>
                              <span></span>
                            </div>
                            <div>
                              {visibleRentalItems.map((item) => (
                                <div key={item.id} className="adm-datarow" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 60px', gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', opacity: item.isActive ? 1 : 0.6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                      {item.imageUrl ? (
                                        <img src={getFullImageUrl(item.imageUrl)!} alt={item.itemName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '13px' }} />
                                      ) : (
                                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 500, color: 'var(--accent)' }}>{item.itemName.charAt(0).toUpperCase()}</span>
                                      )}
                                    </div>
                                    <div>
                                      <h4 style={{ margin: '0 0 3px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--text-primary)' }}>{item.itemName}</h4>
                                    </div>
                                  </div>
                                  <div>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, color: 'var(--primary)', background: 'var(--primary-muted)', padding: '5px 9px 5px 5px', borderRadius: '6px' }}>
                                      <span style={{ width: '4px', height: '14px', borderRadius: '999px', background: 'var(--primary)' }}></span>
                                      {item.category}
                                    </span>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>{fmt(item.unitPrice)}</span>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)' }}>{item.totalQuantity}</span>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    {item.quantityOut === item.totalQuantity && item.totalQuantity > 0 ? (
                                      <span style={{ display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--danger)', background: 'rgba(220,38,38,.12)', padding: '4px 8px', borderRadius: '4px' }}>{item.quantityOut}</span>
                                    ) : (
                                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)' }}>{item.quantityOut}</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                    <button type="button" onClick={() => openRentalForm('edit', item)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                      <Pencil size={14} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
                                    </button>
                                    <button type="button" onClick={() => void toggleRentalActive(item)} disabled={rentalSaving} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                      {item.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
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
                          {returnsLoading ? 'Refreshing…' : <><RotateCw size={13} strokeWidth={2} aria-hidden="true" /> Refresh</>}
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

                    {rentalFormOpen && createPortal(
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
                      </div>,
                      document.body
                    )}
                  </div>
                )}

                {/* ══════════ SERVICE ITEMS (live backend data) ══════════ */}
                {tab === 'services' && (
                  <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <AdminTabHeader
                      title="Service Items"
                      endpoints="Manage event service offerings (e.g., sound systems, DJs, photo booths) and sync with the C# backend."
                      searchPlaceholder="Search service name…"
                      searchValue={serviceSearch}
                      onSearchChange={setServiceSearch}
                      onRefresh={() => void loadServiceCatalog()}
                      refreshing={servicesLoading}
                      actions={
                        <button type="button" onClick={() => openServiceForm('create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
                          + Add Service Item
                        </button>
                      }
                    />

                    {serviceFeedback && (
                      <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--status-paid) 35%, transparent)', background: 'color-mix(in srgb, var(--status-paid) 10%, transparent)' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--status-paid)' }}>{serviceFeedback}</div>
                      </div>
                    )}

                    {servicesError && !servicesLoading && (
                      <AdmErrorCard
                        title="Service catalog unavailable"
                        message={servicesError}
                        onRetry={() => void loadServiceCatalog()}
                        extraAction={servicesAuthError ? <Link to="/login" className="adm-btn primary">Go to Sign In</Link> : undefined}
                      />
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
                              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 100px 90px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Service Name</span>
                                <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Unit Cost</span>
                                <span style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</span>
                                <span></span>
                              </div>
                              <div>
                                {visibleServiceItems.map((item) => (
                                  <div key={item.id} className="adm-datarow" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 100px 90px', gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', opacity: item.isActive ? 1 : 0.6 }}>
                                    <div>
                                      <h4 style={{ margin: '0', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--text-primary)' }}>{item.serviceName}</h4>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                      <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>{fmt(item.unitCost)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: item.isActive ? 'var(--accent-text)' : 'var(--text-primary)', background: item.isActive ? 'var(--accent)' : 'var(--bg-subtle)', border: item.isActive ? 'none' : '1px solid var(--border)', padding: '5px 9px', borderRadius: '999px' }}>
                                        {item.isActive ? 'Active' : 'Inactive'}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                      <button type="button" onClick={() => openServiceForm('edit', item)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                        <Pencil size={14} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
                                      </button>
                                      <button type="button" onClick={() => void toggleServiceActive(item)} disabled={serviceSaving} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                        {item.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                        )}
                      </div>
                    )}

                    {serviceFormOpen && createPortal(
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
                      </div>,
                      document.body
                    )}
                  </div>
                )}

                {/* ══════════ ANNOUNCEMENTS ══════════ */}
                {tab === 'announcements' && (
                  <div className="fade-up" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>Announcements</h2>
                      <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
                        Posting one notifies every active customer through their notification bell.
                      </p>
                    </div>

                    {/* compose */}
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '22px' }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '16px' }}>New Announcement</div>
                      <label htmlFor="ann-title" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Title</label>
                      <input
                        id="ann-title"
                        maxLength={150}
                        placeholder="Holiday hours for December"
                        value={annTitle}
                        onChange={(e) => setAnnTitle(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '13px', marginBottom: '16px' }}
                      />
                      <label htmlFor="ann-body" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Message</label>
                      <textarea
                        id="ann-body"
                        rows={5}
                        maxLength={2000}
                        placeholder="What do you want every customer to know?"
                        value={annBody}
                        onChange={(e) => setAnnBody(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1.55, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '13px', minHeight: '104px', resize: 'vertical' }}
                      />
                      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)', marginTop: '8px' }}>
                        {annBody.length} / 2000
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginTop: '16px' }}>
                        <span style={{ flex: 1, minWidth: '200px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
                          Announcements can't be edited or unsent once posted.
                        </span>
                        <button
                          type="button"
                          disabled={annPosting || !annTitle.trim() || !annBody.trim()}
                          onClick={() => void submitAnnouncement()}
                          style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 600, lineHeight: 1, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '14px 22px', borderRadius: '999px', opacity: (annPosting || !annTitle.trim() || !annBody.trim()) ? 0.45 : 1, cursor: (annPosting || !annTitle.trim() || !annBody.trim()) ? 'not-allowed' : 'pointer' }}
                        >
                          {annPosting ? 'Posting...' : 'Post announcement'}
                        </button>
                      </div>
                    </div>

                    {/* ── Event gallery ── */}
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '22px' }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '16px' }}>Event Gallery</div>

                      <label htmlFor="gal-caption" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Caption</label>
                      <input
                        id="gal-caption"
                        maxLength={200}
                        placeholder="Golden anniversary at Villa Estrella"
                        value={galCaption}
                        disabled={galUploading}
                        onChange={(e) => setGalCaption(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '13px', marginBottom: '4px' }}
                      />
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px' }}>Optional, used as alt text.</div>

                      <label htmlFor="gal-images" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Photos</label>
                      <input
                        id="gal-images"
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        disabled={galUploading || galleryImages.length >= GALLERY_MAX_IMAGES}
                        onChange={uploadGalleryImages}
                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '10px 13px', marginBottom: '4px' }}
                      />
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-muted)' }}>JPG/PNG/WebP, 5 MB each. Uploading here notifies nobody and posts nothing.</div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginTop: '16px' }}>
                        <span style={{ flex: 1, minWidth: '200px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
                          {galUploading
                            ? 'Uploading…'
                            : `${galleryImages.length} of ${GALLERY_MAX_IMAGES} images in the gallery`}
                        </span>
                        <button
                          type="button"
                          disabled={galLoading || galUploading}
                          onClick={() => void loadGallery()}
                          style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 600, lineHeight: 1, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '14px 22px', borderRadius: '999px', opacity: (galLoading || galUploading) ? 0.45 : 1, cursor: (galLoading || galUploading) ? 'not-allowed' : 'pointer' }}
                        >
                          {galLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                      </div>

                      {galError && (
                        <div
                          role="alert"
                          style={{
                            marginTop: '0.7rem', padding: '0.6rem 0.8rem',
                            border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
                            borderRadius: 'var(--r-lg)', background: 'var(--danger-muted)',
                            fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--danger)', lineHeight: 1.5,
                          }}
                        >
                          {galError}
                        </div>
                      )}

                      {galLoading ? (
                        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.7rem' }} aria-hidden="true">
                          {[0, 1, 2].map((i) => (
                            <div key={i} className="adm-skel" style={{ height: 104, flex: 1, borderRadius: 'var(--r-lg)' }} />
                          ))}
                        </div>
                      ) : galleryImages.length === 0 ? (
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.9rem' }}>
                          No gallery photos yet. The public gallery section stays hidden until you add one.
                        </p>
                      ) : (
                        <div
                          style={{
                            marginTop: '0.9rem', display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem',
                          }}
                        >
                          {galleryImages.map((img, i) => (
                            <div
                              key={img.id}
                              style={{
                                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                                overflow: 'hidden', background: 'var(--bg-subtle)',
                                display: 'flex', flexDirection: 'column',
                              }}
                            >
                              <img
                                src={getGalleryImageUrl(img.url) ?? undefined}
                                alt={img.caption ?? `Gallery photo ${i + 1}`}
                                loading="lazy"
                                style={{ width: '100%', height: 104, objectFit: 'cover', display: 'block' }}
                              />
                              <div style={{ padding: '0.45rem 0.55rem', flex: 1 }}>
                                <div
                                  title={img.caption ?? undefined}
                                  style={{
                                    fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 500,
                                    color: img.caption ? 'var(--text-primary)' : 'var(--text-dim)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}
                                >
                                  {img.caption ?? 'No caption'}
                                </div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                                  {img.uploadedByName} · {fmtDateTime(img.uploadedAt)}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="adm-btn danger"
                                disabled={galDeletingId === img.id}
                                onClick={() => void removeGalleryImage(img.id)}
                                aria-label={`Remove gallery photo ${i + 1}`}
                                style={{ width: '100%', fontSize: '0.55rem', padding: '0.32rem', borderRadius: 0 }}
                              >
                                {galDeletingId === img.id ? 'Removing…' : 'Remove'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {annError && !annLoading && (
                      <div style={{ padding: '1.4rem 1.6rem', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: '16px', background: 'var(--surface)' }}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
                          {annError}
                        </p>
                      </div>
                    )}

                    {annLoading && (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.4rem 1.6rem' }} aria-hidden="true">
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
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '4px 20px' }}>
                        {announcements.length === 0 ? (
                          <div style={{ padding: '15px 0', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-muted)' }}>
                            Nothing posted yet. Your first announcement will appear here.
                          </div>
                        ) : (
                          announcements.map((a, idx) => (
                            <div key={a.id} style={{ padding: '15px 0', borderBottom: idx < announcements.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                                {a.title}
                              </div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: '5px', whiteSpace: 'pre-wrap' }}>
                                {a.body}
                              </div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)', marginTop: '8px' }}>
                                Posted {fmtDate(a.createdAt)} · sent to {a.notifiedCount} customers
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
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
