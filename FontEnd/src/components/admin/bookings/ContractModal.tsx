/**
 * The printable service contract for a Confirmed booking, over any tab.
 *
 * Presentational: the page fetches the booking detail and invoice and hands them
 * in. `id="adm-contract"` and `adm-contract-noprint` are what the page's print
 * stylesheet targets; they must survive any restyle.
 */
import type { BookingDetailResponse, InvoiceResponseDto } from '../../../api/bookingApi';
import { fmt, fmtDate } from '../../../lib/format';
import { FieldLabel } from '../shared/StatusBadge';

export interface ContractModalProps {
  detail: BookingDetailResponse;
  /** Null when no invoice exists yet; the contract then defers the final price to it. */
  invoice: InvoiceResponseDto | null;
  onClose: () => void;
}

export function ContractModal({ detail, invoice, onClose }: ContractModalProps) {
  const b = detail.booking;
  const lineTotal =
    detail.rentals.reduce((s, r) => s + r.subtotal, 0) +
    detail.services.reduce((s, sv) => s + sv.totalCost, 0) +
    detail.menuItems.reduce((s, m) => s + m.lineTotal, 0) +
    detail.menuTrays.reduce((s, t) => s + t.lineTotal, 0);

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
      onClick={onClose}
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
            <button type="button" className="adm-btn outline" onClick={onClose}>Close</button>
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
              {detail.package && (
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0' }}>
                    <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Package — {detail.package.packageName}</strong>
                    {detail.package.inclusions.length > 0 && (
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{detail.package.inclusions.join(' · ')}</div>
                    )}
                  </td>
                  <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(detail.package.basePrice)}</td>
                </tr>
              )}
              {detail.menuItems.map((m) => (
                <tr key={m.itemId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0' }}>{m.itemName} × {m.quantity}</td>
                  <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(m.lineTotal)}</td>
                </tr>
              ))}
              {detail.menuTrays.map((t) => (
                <tr key={t.trayId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0' }}>{t.trayName} × {t.quantity}</td>
                  <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(t.lineTotal)}</td>
                </tr>
              ))}
              {detail.rentals.map((r) => (
                <tr key={r.lineId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0' }}>Rental — {r.itemName} × {r.quantity}</td>
                  <td style={{ padding: '0.4rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.subtotal)}</td>
                </tr>
              ))}
              {detail.services.map((sv) => (
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
            {invoice ? (
              <>
                {invoice.taxAmount > 0 && (
                  <span>Tax: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(invoice.taxAmount)}</strong></span>
                )}
                <span style={{ fontSize: '0.9rem' }}>
                  Total contract price:{' '}
                  <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(invoice.grandTotal)}</strong>
                </span>
                <span>Paid to date: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(invoice.paidTotal)}</strong> · Balance: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmt(invoice.grandTotal - invoice.paidTotal)}</strong></span>
                <span>Invoice due: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmtDate(invoice.dueDate)}</strong></span>
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
}
