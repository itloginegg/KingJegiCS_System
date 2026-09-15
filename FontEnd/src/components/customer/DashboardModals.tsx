/**
 * The customer dashboard's three modals, plus the small primitives they share.
 *
 * Lifted out of CustomerDashboardPage, where they sat above a 1,500-line
 * component and pushed that one file past 2,400 lines. Nothing here reads the
 * dashboard's state: each takes the row it is showing as a prop and fetches its
 * own detail, which is what made them separable in the first place.
 *
 * StatusBadge and FieldLabel below are near-duplicates of the admin ones in
 * components/admin/shared/StatusBadge.tsx. They are left duplicated rather than
 * merged because the two surfaces size and space them differently, and folding
 * them together would mean a props API for what is currently a literal — worth
 * revisiting, but not while moving files.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getBookingDetail,
  getPackageSelections,
  getInvoiceById,
  getPaymentSchedule,
  checkout,
  submitBooking,
  BookingApiError,
  type BookingResponse as BookingResponseDto,
  type BookingDetailResponse as BookingDetailDto,
  type PackageSelectionResponse as BookingPackageSelectionDto,
  type InvoiceResponseDto,
  type PaymentScheduleDto,
} from '../../api/bookingApi';
import { readSession } from '../../lib/tokenStorage';
import {
  bookingMeta,
  derivedStatusOf,
  fmt,
  fmtDate,
  fmtTime,
} from './bookingStatus';
import { PENDING_PAYMENT_KEY } from '../../lib/pendingPayment';

export function StatusBadge({ label, color }: { label: string; color: string }) {
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

export function FieldLabel({ text }: { text: string }) {
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

export function pipelineStep(booking: BookingResponseDto) {
  switch (booking.depositStatus) {
    case 'Paid': return 3;
    case 'Partial': return 2;
    case 'Reserved': return 1;
    case 'Unpaid':
    default: return 0;
  }
}

export function Pipeline({ current, cancelled }: { current: number; cancelled: boolean }) {

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

export function BookingDetailModal({ booking, onClose, statusBadge, notify, onSubmitted }: {
  booking: BookingResponseDto;
  onClose: () => void;
  statusBadge?: { label: string; color: string };
  notify?: (type: 'success' | 'error' | 'info', message: string) => void;
  onSubmitted?: () => void;
}) {
  const [detail, setDetail] = useState<BookingDetailDto | null>(null);
  const [selections, setSelections] = useState<BookingPackageSelectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
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
        // Previously this returned silently, leaving a permanently empty modal.
        const message = 'You are signed out. Please sign in again to see the full booking.';
        setDetailError(message);
        notify?.('error', message);
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
        // A failed fetch used to console.error only, so the modal just sat blank
        // with no explanation. Surface it the way every other call site does.
        const message = err instanceof BookingApiError
          ? err.message
          : 'Could not load the full details for this booking. Please try again.';
        setDetailError(message);
        notify?.('error', message);
      } finally {
        setLoading(false);
      }
    };
    void fetchDetail();
    /* `notify` is the useToasts callback the dashboard passes down (see the
       BookingDetailModal call site), and useToasts memoises it, so listing it
       cannot re-trigger this fetch — it just stops the array from claiming this
       effect uses nothing but the id. */
  }, [booking.id, notify]);

  const meta = bookingMeta(booking);
  // Same derivation as the caller's, so the modal can never disagree with the card
  // that opened it.
  const st = statusBadge || derivedStatusOf(booking);
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
          <button className="cds-modal-close" onClick={onClose} aria-label="Close details">×</button>
        </div>

        <div className="cds-modal-body" style={{ overflowY: 'auto', padding: '1.6rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem', marginBottom: '1.5rem' }}>
            <div><FieldLabel text="Event Date" /><strong className="cds-value">{(booking.eventDate ? fmtDate(booking.eventDate) : 'TBD')}</strong></div>
            <div><FieldLabel text="Start Time" /><strong className="cds-value">{fmtTime(booking.startTime)}</strong></div>
            {/* End date/time only exist on event-style bookings — a FoodDelivery order
                has neither by backend design, so showing empty rows would be noise. */}
            {booking.bookingType !== 'FoodDelivery' && (
              <>
                <div><FieldLabel text="End Date" /><strong className="cds-value">{booking.endDate ? fmtDate(booking.endDate) : '—'}</strong></div>
                <div><FieldLabel text="End Time" /><strong className="cds-value">{fmtTime(booking.endTime)}</strong></div>
              </>
            )}
            <div><FieldLabel text="Status" /><strong className="cds-value" style={{ color: st.color }}>{st.label}</strong></div>
            <div><FieldLabel text="Venue" /><strong className="cds-value">{booking.venueAddress}</strong></div>
            {/* Same reason the end date/time row is conditional: a delivery and a
                rental both have a null guestCount by backend design, and this row
                was rendering the label over an empty value for both. */}
            {booking.guestCount != null && (
              <div><FieldLabel text="Guests" /><strong className="cds-value">{booking.guestCount}</strong></div>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-body)' }}>Loading additional details...</div>
          ) : detailError ? (
            <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
              <div style={{ fontSize: '1.3rem', marginBottom: '0.6rem' }}>⚠️</div>
              <p style={{ fontSize: '0.84rem', fontWeight: 300, color: 'var(--danger)', lineHeight: 1.6, margin: '0 0 1.2rem' }}>
                {detailError}
              </p>
              <p style={{ fontSize: '0.74rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                The summary above is still accurate — only the itemised breakdown failed to load.
              </p>
            </div>
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
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{mi.itemName} × {mi.quantity}</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{fmt(mi.lineTotal)}</span>
                      </div>
                    ))}
                    {detail?.menuTrays.map(mt => (
                      <div key={mt.trayId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{mt.trayName} × {mt.quantity}</span>
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
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{r.itemName} × {r.quantity}</span>
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
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{s.serviceName} × {s.quantity}</span>
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

export function InvoiceModal({ order, customer, onClose }: { order: InvoiceResponseDto; customer: { name: string; email: string }; onClose: () => void; }) {
  const [invoice, setInvoice] = useState<InvoiceResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /* Keyed on the id alone, not the whole `order` object: the parent rebuilds that
     object on every dashboard refresh, so depending on the object would refetch
     the invoice each time while depending on the id refetches only when the modal
     is actually showing a different invoice. */
  const fetchInvoice = useCallback(async () => {
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
  }, [order.id]);

  useEffect(() => {
    if (order.id) void fetchInvoice();
  }, [order.id, fetchInvoice]);

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
  // Same pairing the invoice list uses, and off --success, which is undefined.
  const stColor = isPaid ? 'var(--status-paid)' : 'var(--status-unpaid)';

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
            Invoice · #{invoice.id.substring(0,8)}
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
              {/* VAT was removed, so new invoices carry 0 and the row is noise. An
                  invoice issued while VAT applied keeps its tax and still shows it. */}
              {invoice.taxAmount > 0 && (
                <tr>
                  <td style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>Tax</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(invoice.taxAmount)}</td>
                </tr>
              )}
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


export function PaymentScheduleModal({ order, invoice, onClose }: { order: BookingResponseDto; invoice: InvoiceResponseDto | undefined; onClose: () => void; }) {
  const [schedule, setSchedule] = useState<PaymentScheduleDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const remaining = invoice ? (invoice.grandTotal - invoice.paidTotal) : 0;
  const [amount, setAmount] = useState<number>(remaining);
  /* Which schedule row the amount came from, or null when it was typed by hand.
     Tracked rather than derived by comparing `amount` to each row's figure: two
     rows can legitimately owe the same sum, and the highlight would then land on
     both. */
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  /* Same shape as InvoiceModal's fetch above, and keyed on the id for the same
     reason: the parent hands down a freshly built `order` on every refresh. */
  const fetchSchedule = useCallback(async () => {
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
  }, [order.id]);

  useEffect(() => {
    if (order.id) void fetchSchedule();
  }, [order.id, fetchSchedule]);

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
        // Remember what we're paying for. PayMongo's SuccessUrl is a static, configured
        // URL with no per-payment context, so /payment/success has no other way to know
        // which payment to wait on. sessionStorage, not localStorage: this is scoped to
        // the tab making the payment and shouldn't outlive it.
        try {
          sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
            invoiceId: invoice.id,
            paymentId: data.payment?.id ?? null,
          }));
        } catch {
          // Storage blocked (private mode) — the return page degrades to a generic
          // "check your payments" message rather than a false confirmation.
        }
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
          <button className="cds-modal-close" onClick={onClose} aria-label="Close details">×</button>
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

          {/* The schedule IS the stage picker.
              These rows used to be read-only, with a duplicate row of "Pay a stage"
              buttons underneath — the same three stages listed twice, and listed with
              DIFFERENT figures, because a row showed m.amountDue (that stage alone)
              while its button charged the cumulative catch-up. Merging them removes
              the duplication, but only works if the row is honest about which of the
              two numbers the click actually charges; hence the "Pays …" line below. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', margin: '1.5rem 0' }}>
            {milestones.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-dim)' }}>
                No active schedule yet.
              </div>
            ) : milestones.map((m, i) => {
              // Milestones are CUMULATIVE targets, not independent invoices: once
              // something has been paid, m.amountDue is no longer what is owed for
              // that stage. What settles it is the cumulative target minus everything
              // paid so far, capped at the remaining balance.
              const owed = Math.min(remaining, Math.max(0, m.cumulativeDue - schedule.paidTotal));
              const done = m.status === 'Paid' || owed <= 0;
              const payable = Boolean(invoice) && remaining > 0 && !done;
              const selected = selectedStage === i;
              // Only worth spelling out when the two figures differ — on the first
              // unpaid stage they are the same and the extra line would be noise.
              const catchUp = payable && Math.abs(owed - m.amountDue) > 0.005;

              return (
                <button
                  key={i}
                  type="button"          /* inside a <form>: without this it submits */
                  onClick={() => {
                    if (!payable) return;
                    setSelectedStage(i);
                    setAmount(owed);
                    setCheckoutError('');
                  }}
                  disabled={!payable || isSubmitting}
                  aria-pressed={selected}
                  style={{
                    all: 'unset',
                    boxSizing: 'border-box',
                    width: '100%',
                    background: selected ? 'var(--accent-muted)' : 'var(--bg-subtle)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-md)',
                    padding: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    fontFamily: 'var(--font-body)',
                    cursor: payable ? 'pointer' : 'default',
                    opacity: done ? 0.6 : 1,
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.label}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Due: {m.dueDate}</div>
                    {catchUp && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        Pays {fmt(owed)} — settles everything through this stage
                      </div>
                    )}
                    {payable && !catchUp && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        {selected ? 'Selected' : 'Tap to pay this stage'}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(m.amountDue)}</div>
                    {m.status === 'Paid' ? (
                      <StatusBadge label="Paid" color="var(--status-paid)" />
                    ) : (
                      <StatusBadge label={m.status} color="var(--status-unpaid)" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {invoice && remaining > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1rem', marginTop: 0 }}>Checkout</h3>
              
              {/* The stage buttons that used to sit here are gone: the schedule rows
                  above are the picker now, so listing every stage a second time was
                  pure duplication — and the two lists disagreed on the amount. */}

              <div style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="customer-dashboard-payment-amount" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                  Payment Amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={remaining}
                  value={amount}
                  onChange={(e) => { setAmount(Number(e.target.value)); setSelectedStage(null); }}
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
                id="customer-dashboard-payment-amount"/>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                  Tap a stage above, or enter any partial amount.
                </p>
              </div>

              {checkoutError && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: '1rem', textAlign: 'center' }}>{checkoutError}</div>}
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
