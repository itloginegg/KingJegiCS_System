/**
 * The invoice popup: the invoice Submit already issued, printable, over any tab.
 *
 * Presentational. The page owns the open invoice because more than one flow
 * writes to it - the Bookings row action opens it, issuing a missing invoice
 * fills it in, and logging a cash payment refreshes its paid total while it is
 * open - so this file only renders what it is handed and reports two clicks.
 *
 * `id="adm-invoice"` and the `adm-invoice-*` classes are what the page's print
 * stylesheet targets; they must survive any restyle.
 */
import { ScrollText } from 'lucide-react';
import type { BookingDetailResponse, BookingResponse, InvoiceResponseDto } from '../../../api/bookingApi';
import { fmt, fmtDate, fmtTime } from '../../../lib/format';
import { FieldLabel, StatusBadge } from '../shared/StatusBadge';

export interface InvoiceView {
  booking: BookingResponse;
  /** Null only when the booking reached Pending without one being issued. */
  invoice: InvoiceResponseDto | null;
  /** Line descriptions. Figures always come from `invoice`, never from here. */
  detail: BookingDetailResponse | null;
}

export interface InvoiceModalProps {
  view: InvoiceView;
  /** An invoice is being issued for this booking right now. */
  issuing: boolean;
  onClose: () => void;
  onIssueInvoice: (booking: BookingResponse) => void;
}

/* Declared at module level rather than inside the modal: a component defined in a
   render function is a new type on every render, so React remounted every row. */
function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.3rem 0', fontFamily: 'var(--font-body)', fontSize: strong ? '0.95rem' : '0.8rem', fontWeight: strong ? 600 : 300, color: strong ? 'var(--text-primary)' : 'var(--text-muted)' }}>
      <span>{label}</span>
      <span style={{ whiteSpace: 'nowrap', color: strong ? 'var(--primary)' : undefined }}>{value}</span>
    </div>
  );
}

export function InvoiceModal({ view, issuing, onClose, onIssueInvoice }: InvoiceModalProps) {
  const { booking: ib, invoice, detail } = view;
  const close = onClose;
  const balance = invoice ? invoice.grandTotal - invoice.paidTotal : 0;

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
                disabled={issuing}
                onClick={() => onIssueInvoice(ib)}
              >
                {issuing ? 'Issuing…' : 'Issue invoice now'}
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
}
