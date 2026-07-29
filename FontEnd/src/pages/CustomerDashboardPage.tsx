import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { ChatWidget } from '../components/landing/ChatWidget';
import { HubConnectionBuilder } from '@microsoft/signalr';
import {
  LayoutDashboard, CalendarDays, CreditCard, Package,
  Utensils, Tent, CheckCircle, Clock, MapPin, Users, HeartHandshake,
  Cake, PartyPopper, Building2, Landmark, Calendar, ListTodo, LogOut, Sun, Moon
} from 'lucide-react';
import {
  getAllBookings,
  getBookingDetail,
  getPackageSelections,
  getInvoiceByBooking,
  getInvoiceById,
  getPaymentSchedule,
  getPaymentsByInvoice,
  checkout,
  submitBooking,
  cancelBooking as cancelBookingRequest,
  requestCancellation,
  requestRefund,
  BookingApiError,
  API_BASE_URL,
  type BookingResponse as BookingResponseDto,
  type BookingDetailResponse as BookingDetailDto,
  type PackageSelectionResponse as BookingPackageSelectionDto,
  type InvoiceResponseDto,
  type PaymentScheduleDto,
  type PaymentRecord,
} from '../api/bookingApi';
import { readSession } from '../lib/tokenStorage';
import { ToastViewport, useToasts } from '../components/ui/Toasts';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '../api/notificationsApi';
import {
  getMyTestimonials,
  submitTestimonial,
  TestimonialApiError,
  type Testimonial as MyTestimonial,
} from '../api/testimonialsApi';


const normalizeType = (ty: string | null) => {
  if (!ty) return 'wedding';
  const l = ty.toLowerCase();
  if (l.includes('wed')) return 'wedding';
  if (l.includes('birth')) return 'birthday';
  if (l.includes('debut')) return 'debut';
  if (l.includes('corp')) return 'corporate';
  return 'wedding';
};
const normalizeStatus = (st: string | null) => {
  if (!st) return 'pending';
  const l = st.toLowerCase();
  if (l.includes('cancel')) return 'cancelled';
  if (l.includes('secur')) return 'secured';
  if (l.includes('fee')) return 'pending_fee';
  return 'pending';
};


const EVENT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  wedding: { label: 'Wedding Event', icon: <HeartHandshake size={16} /> },
  birthday: { label: 'Birthday Celebration', icon: <Cake size={16} /> },
  debut: { label: 'Debut Celebration', icon: <PartyPopper size={16} /> },
  corporate: { label: 'Corporate Event', icon: <Building2 size={16} /> },
};

const BOOKING_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending Approval', color: 'var(--accent)' },
  pending_fee: { label: 'Awaiting Fee', color: 'var(--accent)' },
  secured: { label: 'Secured', color: 'var(--primary)' },
  cancelled: { label: 'Cancelled', color: 'var(--danger)' },
};

const fmt = (n: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

const fmtDate = (iso: string) => {

  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
};

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span

      style={{
        fontFamily: 'var(--font-body)', fontSize: '0.56rem',
        letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500,
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        padding: '0.3rem 0.7rem', borderRadius: 'var(--r-full)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function FieldLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)', fontSize: '0.52rem',
        letterSpacing: '0.26em', textTransform: 'uppercase', fontWeight: 500,
        color: 'var(--text-dim)', display: 'block', marginBottom: '0.4rem',
      }}
    >
      {text}
    </span>
  );
}

const PIPELINE_STEPS = ['Unpaid', 'Reserved', 'Partial', 'Paid'];

function pipelineStep(booking: BookingResponseDto) {
  switch (booking.depositStatus) {
    case 'Paid': return 3;
    case 'Partial': return 2;
    case 'Reserved': return 1;
    case 'Unpaid':
    default: return 0;
  }
}

function Pipeline({ current, cancelled }: { current: number; cancelled: boolean }) {

  return (
    <div className="cds-pipeline" aria-label="Booking progress">
      {PIPELINE_STEPS.map((step, idx) => {
        const active = !cancelled && idx <= current;
        return (
          <div key={step} className="cds-pipeline-step">
            {idx > 0 && <div className="bar" style={{ background: active ? 'var(--primary)' : 'var(--border)' }} />}
            <div
              className="dot"
              style={{
                background: active ? 'var(--primary)' : 'var(--border-strong)',
                boxShadow: active ? '0 0 0 3px var(--primary-muted)' : 'none',
              }}
            />
            <span style={{ color: active ? 'var(--text-primary)' : 'var(--text-dim)', fontWeight: active ? 600 : 400 }}>
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Modals
ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */

function BookingDetailModal({ booking, onClose, statusBadge, notify, onSubmitted }: {
  booking: BookingResponseDto;
  onClose: () => void;
  statusBadge?: { label: string; color: string };
  notify?: (type: 'success' | 'error' | 'info', message: string) => void;
  onSubmitted?: () => void;
}) {
  const [detail, setDetail] = useState<BookingDetailDto | null>(null);
  const [selections, setSelections] = useState<BookingPackageSelectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  /* A Draft (from the wizard, a materialized budget plan, or an admin walk-in) can be
     submitted for review here — the parity fix so every Draft has a Submit path. */
  const handleSubmit = async () => {
    const session = readSession();
    if (!session) { notify?.('error', 'You are signed out. Please sign in again.'); return; }
    setSubmitting(true);
    try {
      await submitBooking(session.token, booking.id);
      notify?.('success', 'Booking submitted for review.');
      onSubmitted?.();
    } catch (err) {
      notify?.('error', err instanceof BookingApiError ? err.message : 'Could not submit this booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const fetchDetail = async () => {
      const session = readSession();
      if (!session) {
        setLoading(false);
        return;
      }
      try {
        const [dData, sData] = await Promise.all([
          getBookingDetail(session.token, booking.id),
          getPackageSelections(session.token, booking.id),
        ]);
        setDetail(dData);
        setSelections(sData);
      } catch (err) {
        console.error('Failed to fetch details:', err);
      } finally {
        setLoading(false);
      }
    };
    void fetchDetail();
  }, [booking.id]);

  const meta = EVENT_META[normalizeType(booking.eventType)] || EVENT_META.wedding;
  const st = statusBadge || BOOKING_STATUS[normalizeStatus(booking.status)] || BOOKING_STATUS.pending;
  return (
    <div className="cds-overlay" onClick={onClose}>
      <div className="cds-modal" style={{ maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${meta.label} details`}>
        <div className="cds-modal-head" style={{ flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
              {meta.label}

            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.3rem', letterSpacing: '0.08em' }}>
              #{booking.id}
            </p>
          </div>
          <button className="cds-modal-close" onClick={onClose} aria-label="Close details">├ù</button>
        </div>

        <div className="cds-modal-body" style={{ overflowY: 'auto', padding: '1.6rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem', marginBottom: '1.5rem' }}>
            <div><FieldLabel text="Event Date" /><strong className="cds-value">{(booking.eventDate ? fmtDate(booking.eventDate) : 'TBD')}</strong></div>
            <div><FieldLabel text="Status" /><strong className="cds-value" style={{ color: st.color }}>{st.label}</strong></div>
            <div><FieldLabel text="Venue" /><strong className="cds-value">{booking.venueAddress}</strong></div>
            <div><FieldLabel text="Guests" /><strong className="cds-value">{booking.guestCount}</strong></div>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-body)' }}>Loading additional details...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Package Details */}
              {detail?.package && (
                <div>
                  <FieldLabel text="Selected Package" />
                  <div style={{ border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '1rem', background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{detail.package.packageName}</strong>
                      <strong style={{ color: 'var(--text-primary)' }}>{fmt(detail.package.basePrice)}</strong>
                    </div>
                    {detail.package.inclusions && detail.package.inclusions.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
                        {detail.package.inclusions.map((inc, i) => (
                          <li key={i}>{inc}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* Package Dish Selections */}
              {selections && selections.length > 0 && (
                <div>
                  <FieldLabel text="Package Dish Selections" />
                  <div style={{ border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '0.5rem 1rem', background: 'var(--bg-card)' }}>
                    {selections.map(sel => (
                      <div key={sel.slotId + sel.menuItemId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{sel.slotLabel}</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{sel.menuItemName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* A La Carte Items */}
              {((detail?.menuItems && detail.menuItems.length > 0) || (detail?.menuTrays && detail.menuTrays.length > 0)) && (
                <div>
                  <FieldLabel text="A La Carte Food & Trays" />
                  <div style={{ border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '0.5rem 1rem', background: 'var(--bg-card)' }}>
                    {detail?.menuItems.map(mi => (
                      <div key={mi.itemId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{mi.itemName} ├ù {mi.quantity}</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{fmt(mi.lineTotal)}</span>
                      </div>
                    ))}
                    {detail?.menuTrays.map(mt => (
                      <div key={mt.trayId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{mt.trayName} ├ù {mt.quantity}</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{fmt(mt.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rentals */}
              {detail?.rentals && detail.rentals.length > 0 && (
                <div>
                  <FieldLabel text="Rentals" />
                  <div style={{ border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '0.5rem 1rem', background: 'var(--bg-card)' }}>
                    {detail.rentals.map(r => (
                      <div key={r.lineId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{r.itemName} ├ù {r.quantity}</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{fmt(r.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Services */}
              {detail?.services && detail.services.length > 0 && (
                <div>
                  <FieldLabel text="Services" />
                  <div style={{ border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '0.5rem 1rem', background: 'var(--bg-card)' }}>
                    {detail.services.map(s => (
                      <div key={s.lineId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{s.serviceName} ├ù {s.quantity}</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{fmt(s.totalCost)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {booking.status === 'Draft' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', borderTop: '1px solid var(--border)', paddingTop: '1.1rem' }}>
              <button type="button" className="cds-btn primary" disabled={submitting} onClick={() => void handleSubmit()}>
                {submitting ? 'Submitting…' : 'Submit Booking'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InvoiceModal({ order, customer, onClose }: { order: InvoiceResponseDto; customer: { name: string; email: string }; onClose: () => void; }) {
  const [invoice, setInvoice] = useState<InvoiceResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchInvoice = async () => {
    const session = readSession();
    if (!session) {
      setError('You are signed out. Please sign in again.');
      setIsLoading(false);
      return;
    }
    try {
      setInvoice(await getInvoiceById(session.token, order.id));
    } catch (e) {
      setError(e instanceof BookingApiError ? e.message : 'Invoice pending generation by admin.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (order?.id) fetchInvoice();
  }, [order?.id]);

  if (isLoading) {
    return (
      <div className="cds-overlay" onClick={onClose}>
        <div className="cds-modal" onClick={(e) => e.stopPropagation()} style={{ padding: '2rem', textAlign: 'center' }}>
          Loading invoice...
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="cds-overlay" onClick={onClose}>
        <div className="cds-modal" onClick={(e) => e.stopPropagation()} style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', marginBottom: '1rem' }}>{error || 'Not found'}</div>
          <button className="cds-btn outline" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const remaining = invoice.grandTotal - invoice.paidTotal;
  const isPaid = invoice.status === 'Paid';
  const stColor = isPaid ? 'var(--success)' : 'var(--text-dim)';

  return (
    <div className="cds-overlay" onClick={onClose}>

      <div id="cds-invoice" className="cds-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Invoice">
        <div className="cds-modal-head" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '0.15rem' }}>
          <button className="cds-modal-close" onClick={onClose} aria-label="Close invoice" style={{ position: 'absolute', top: '1.1rem', right: '1.1rem' }}>✕</button>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, letterSpacing: '0.14em', color: 'var(--accent)' }}>
            KING JEGI
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.52rem', letterSpacing: '0.4em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
            Events & Catering
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.8rem' }}>
            Invoice ┬╖ #{invoice.id.substring(0,8)}
          </span>
        </div>


        <div className="cds-modal-body">
          <div
            style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem',
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)', padding: '1rem 1.2rem',
              fontFamily: 'var(--font-body)', fontSize: '0.78rem',
            }}
          >
            <span style={{ color: 'var(--text-dim)' }}>Client: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{customer?.name}</strong></span>
            <span style={{ color: 'var(--text-dim)' }}>Issued: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{invoice.issueDate}</strong></span>
            <span style={{ color: 'var(--text-dim)' }}>Email: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{customer?.email}</strong></span>
            <span style={{ color: 'var(--text-dim)' }}>Due: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{invoice.dueDate}</strong></span>
          </div>

          <table className="cds-table">
            <thead>
              <tr>
                <th>Category</th><th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>Food & Catering</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(invoice.foodTotal)}</td>
              </tr>
              <tr>
                <td style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>Rentals & Equipment</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(invoice.rentalTotal)}</td>
              </tr>
              <tr>
                <td style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>Services & Add-ons</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(invoice.serviceTotal)}</td>
              </tr>
              <tr>
                <td style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>Tax</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(invoice.taxAmount)}</td>
              </tr>
            </tbody>
          </table>


          <div
            style={{
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)', padding: '1.1rem 1.3rem',
              display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'flex-end',
            }}
          >
            <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'baseline' }}>
              <FieldLabel text="Grand Total" />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(invoice.grandTotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'baseline', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>
              <FieldLabel text="Paid" />
              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(invoice.paidTotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'baseline', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>
              <FieldLabel text="Remaining" />

              <span style={{ color: remaining > 0 ? 'var(--danger)' : 'var(--text-dim)', fontWeight: 600 }}>{fmt(remaining)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <StatusBadge label={invoice.status} color={stColor} />
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button className="cds-btn outline" onClick={onClose}>Close</button>
              <button className="cds-btn primary" onClick={() => window.print()}>Print</button>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function PaymentScheduleModal({ order, invoice, onClose }: { order: BookingResponseDto; invoice: InvoiceResponseDto | undefined; onClose: () => void; }) {
  const [schedule, setSchedule] = useState<PaymentScheduleDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const remaining = invoice ? (invoice.grandTotal - invoice.paidTotal) : 0;
  const [amount, setAmount] = useState<number>(remaining);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  const fetchSchedule = async () => {
    const session = readSession();
    if (!session) {
      setError('You are signed out. Please sign in again.');
      setIsLoading(false);
      return;
    }
    try {
      setSchedule(await getPaymentSchedule(session.token, order.id));
    } catch (e) {
      setError(e instanceof BookingApiError ? e.message : 'Schedule not available yet.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (order?.id) fetchSchedule();
  }, [order?.id]);

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.grandTotal - invoice.paidTotal);
    }
  }, [invoice]);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    if (amount <= 0 || amount > remaining) {
      setCheckoutError(`Amount must be between 1 and ${remaining}`);
      return;
    }
    
    setIsSubmitting(true);
    setCheckoutError('');

    const session = readSession();
    if (!session) {
      setCheckoutError('You are signed out. Please sign in again.');
      setIsSubmitting(false);
      return;
    }

    try {
      const data = await checkout(session.token, { invoiceId: invoice.id, amount });
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setCheckoutError('Failed to initiate checkout.');
        setIsSubmitting(false);
      }
    } catch (err) {
      setCheckoutError(
        err instanceof BookingApiError
          ? err.message
          : 'An error occurred while connecting to the payment gateway.',
      );
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cds-overlay" onClick={onClose}>
        <div className="cds-modal" onClick={(e) => e.stopPropagation()} style={{ padding: '2rem', textAlign: 'center' }}>
          Loading payment schedule...
        </div>
      </div>
    );
  }

  if (error || !schedule) {
    return (
      <div className="cds-overlay" onClick={onClose}>
        <div className="cds-modal" onClick={(e) => e.stopPropagation()} style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', marginBottom: '1rem' }}>{error || 'Not found'}</div>
          <button className="cds-btn outline" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const milestones = schedule.milestones || [];

  return (
    <div className="cds-overlay" onClick={onClose}>
      <div className="cds-modal" style={{ maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Payment Schedule and Checkout">
        <div className="cds-modal-head" style={{ flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Payment Schedule
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
              Booking #{order.id.substring(0, 8)}
            </p>
          </div>
          <button className="cds-modal-close" onClick={onClose} aria-label="Close details">├ù</button>
        </div>

        <form onSubmit={handleCheckout} className="cds-modal-body" style={{ overflowY: 'auto', padding: '1.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Grand Total</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(schedule.grandTotal)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Remaining Balance</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(schedule.balance)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', margin: '1.5rem 0' }}>
            {milestones.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-dim)' }}>
                No active schedule yet.
              </div>
            ) : milestones.map((m, i) => (
              <div key={i} style={{
                background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.label}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Due: {m.dueDate}</div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(m.amountDue)}</div>
                  {m.status === 'Paid' ? (
                    <StatusBadge label="Paid" color="var(--success)" />
                  ) : (
                    <StatusBadge label={m.status} color="var(--accent)" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {invoice && remaining > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1rem', marginTop: 0 }}>Checkout</h3>
              
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                  Payment Amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={remaining}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    fontFamily: 'var(--font-body)',
                    fontSize: '1rem',
                    border: '1px solid var(--border)',
                    borderRadius: '0.3rem',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)'
                  }}
                  required
                  disabled={isSubmitting}
                />
                <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                  You may enter a partial amount to pay.
                </p>
              </div>

              {checkoutError && <div style={{ color: 'var(--accent)', fontSize: '0.8rem', marginBottom: '1rem', textAlign: 'center' }}>{checkoutError}</div>}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', paddingTop: '0.5rem' }}>
            <button type="button" className="cds-btn outline" onClick={onClose} disabled={isSubmitting}>Close</button>
            {invoice && remaining > 0 && (
              <button type="submit" className="cds-btn primary" disabled={isSubmitting}>
                {isSubmitting ? 'Processing...' : '₱ Pay Balance'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}


type Tab = 'overview' | 'bookings' | 'payments';
const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { id: 'bookings', label: 'My Bookings', icon: <CalendarDays size={20} /> },
  { id: 'payments', label: 'Payments', icon: <CreditCard size={20} /> },
];


export function CustomerDashboardPage() {
  const { theme, toggleTheme } = useTheme();
  const { user: authUser, logout } = useAuth();
  const location = useLocation();

  /* the signed-in account; static persona only as a dev fallback */
  const account = {
    name: authUser?.name ?? 'Maria Santos',
    email: authUser?.email ?? 'maria.santos@example.com',
  };

  const [tab, setTab] = useState<Tab>('overview');
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
    conn.on('AssistantNudge', (payload: { customerId?: string; conversationId?: string }) => {
      const myId = readSession()?.user.id;
      if (!myId || payload?.customerId !== myId) return;
      notify('info', 'Your assistant has a new message — open the chat bubble to see it.');
    });

    conn.start().catch((err) => console.error('SignalR error:', err));

    return () => {
      void conn.stop();
    };
  }, [fetchDashboard, notify]);


  const [detailBooking, setDetailBooking] = useState<BookingResponseDto | null>(null);
    const [invoiceOrder, setInvoiceOrder] = useState<any>(null);
  const [paymentScheduleOrder, setPaymentScheduleOrder] = useState<any>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
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
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');
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
  const deriveBookingStatus = (b: BookingResponseDto) => {
    if (b.status.toLowerCase().includes('cancel')) return { label: 'Cancelled', color: 'var(--danger)' };
    const order = invoiceOf(b);
    if (!order) return BOOKING_STATUS[normalizeStatus(b.status) as keyof typeof BOOKING_STATUS] || BOOKING_STATUS.pending;
    if (order.status === 'Unpaid') return { label: 'Pending', color: 'var(--accent)' };
    if (order.status === 'Partial' || order.status === 'Reserved') return { label: 'Confirmed', color: 'var(--primary)' };
    if (order.status === 'Paid') return { label: 'Completed', color: 'var(--success)' };
    return BOOKING_STATUS[normalizeStatus(b.status) as keyof typeof BOOKING_STATUS] || BOOKING_STATUS.pending;
  };

  const activeBookings = bookings.filter((b) => !b.status.toLowerCase().includes('cancel'));
  const confirmedCount = bookings.filter((b) => b.status.toLowerCase() === 'confirmed').length;



  const nextBooking = [...activeBookings]
    .filter((b) => new Date(b.eventDate || '') >= new Date())
    .sort((a, b) => +new Date(a.eventDate || '') - +new Date(b.eventDate || ''))[0];

  const totalValue = invoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalPaid = invoices.reduce((s, i) => s + i.paidTotal, 0);
  const totalDue = totalValue - totalPaid;
  const paidPct = totalValue > 0 ? Math.round((totalPaid / totalValue) * 100) : 0;


  const filteredBookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings
      .filter((b) => statusFilter === 'all' || b.status === statusFilter)
      .filter((b) => {
        const meta = EVENT_META[normalizeType(b.eventType) as keyof typeof EVENT_META] || EVENT_META.wedding;
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
                          onClick={() => void readNotification(n)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', border: 'none',
                            borderBottom: '1px solid var(--border)', cursor: n.readAt ? 'default' : 'pointer',
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

            <button
              type="button"
              className="cds-iconbtn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{ color: 'var(--accent)' }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
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
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', fontWeight: 600, color: '#fff', lineHeight: 1 }}>
                        {new Date(nextBooking.eventDate || '').getDate()}
                      </span>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.6)' }}>
                        {new Date(nextBooking.eventDate || '').getFullYear()}
                      </span>
                    </div>
                    <div style={{ flex: 1, padding: '1.4rem 1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.5rem' }}>
                      <div><StatusBadge label={deriveBookingStatus(nextBooking).label} color={deriveBookingStatus(nextBooking).color} /></div>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0, lineHeight: 1.15 }}>
                        {(EVENT_META[normalizeType(nextBooking.eventType)] || EVENT_META.wedding).label}
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
                        <div className="cds-glyph">{EVENT_META[normalizeType(b.bookingType) as keyof typeof EVENT_META].icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {EVENT_META[normalizeType(b.bookingType) as keyof typeof EVENT_META].label}
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
                  <select className="cds-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
                    <option value="all">All statuses</option>
                    <option value="secured">Secured</option>
                    <option value="pending">Pending approval</option>
                    <option value="pending_fee">Awaiting fee</option>
                    <option value="cancelled">Cancelled</option>
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
                    const meta = EVENT_META[normalizeType(b.eventType) as keyof typeof EVENT_META] || EVENT_META.wedding;
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
                              <StatusBadge label="Cancellation Requested" color="var(--accent)" />
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
                                color={myReviews.find((r) => r.bookingId === b.id)!.status === 'Approved' ? 'var(--success)' : 'var(--accent)'}
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
  
                  const stColor = inv.status === 'Paid' ? 'var(--success)' : 'var(--accent)';
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
                            #{o.id} ┬╖ {o.issueDate}
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
                              p.status === 'Success' ? 'var(--primary)'
                              : p.status === 'Failed' ? 'var(--danger)'
                              : p.status === 'Pending' ? 'var(--accent)'
                              : '#4a90d9';
                            const refundable =
                              (p.status === 'Success' || p.status === 'PartiallyRefunded') &&
                              p.refundableRemaining > 0 && !p.refundRequested;
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
                                    color={p.refundRequested ? 'var(--accent)' : stColor}
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
                    style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)', opacity: cancelBusy ? 0.6 : 1 }}
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
      <ChatWidget />
    </>
  );
}
