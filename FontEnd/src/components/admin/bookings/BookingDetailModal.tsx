/**
 * The booking-detail popup: a read-only picture of one booking, over any tab, with
 * the Draft-only item editor and the rental lines' delivery actions inline.
 *
 * Presentational apart from DraftItemsEditor, which owns its own form. The page
 * keeps the open booking and its invoice, and the two things that change them:
 * a rental line moving status (shared with the Rentals returns desk, including the
 * damage-note prompt) and the refetch after Draft items change.
 */
import type { ReactNode } from 'react';
import {
  BOOKING_TYPE_LABELS,
  DELIVERY_NEXT_STATUSES,
  type BookingDetailResponse,
  type BookingTypeName,
  type DeliveryStatusName,
  type InvoiceResponseDto,
} from '../../../api/bookingApi';
import { fmt, fmtDate, fmtTime } from '../../../lib/format';
import { scopeLabel, servingStyleLabel } from '../../../lib/serviceScope';
import { FieldLabel, StatusBadge } from '../shared/StatusBadge';
import { RES_STATUS, type ResStatus } from '../shared/statusMeta';
import { DELIVERY_ACTION_LABEL, DELIVERY_STATUS_STYLE } from '../rentals/deliveryStatus';
import { DraftItemsEditor } from '../DraftItemsEditor';

export interface BookingDetailModalProps {
  detail: BookingDetailResponse;
  /** The booking's invoice, or null when none has been issued yet. */
  invoice: InvoiceResponseDto | null;
  /** The rental line mid-request, so only its buttons disable. */
  busyLineId: string | null;
  onClose: () => void;
  onRentalAction: (line: BookingDetailResponse['rentals'][number], next: DeliveryStatusName) => void;
  /** Draft items changed; refetch so the totals shown are the server's. */
  onItemsChanged: () => Promise<void> | void;
  notify: (kind: 'success' | 'error' | 'info', message: string) => void;
}

/* Module level, not inside the modal: a component declared in a render function is
   a new type every render, so React remounted every field on each update. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <FieldLabel text={label} />
      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
        {value}
      </div>
    </div>
  );
}

export function BookingDetailModal({
  detail,
  invoice,
  busyLineId,
  onClose,
  onRentalAction,
  onItemsChanged,
  notify,
}: BookingDetailModalProps) {
  const b = detail.booking;
  const isDelivery = b.bookingType === 'FoodDelivery';
  const lineTotal =
    detail.rentals.reduce((s, r) => s + r.subtotal, 0) +
    detail.services.reduce((s, sv) => s + sv.totalCost, 0) +
    detail.menuItems.reduce((s, m) => s + m.lineTotal, 0) +
    detail.menuTrays.reduce((s, t) => s + t.lineTotal, 0);
  const hasLines =
    detail.rentals.length + detail.services.length +
    detail.menuItems.length + detail.menuTrays.length > 0;

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
      onClick={onClose}
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
            <button type="button" className="adm-iconbtn" aria-label="Close" onClick={onClose}>✕</button>
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
              {!isDelivery && b.bookingType !== 'RentalService' && (
                <Row label="Service" value={scopeLabel(b.serviceScope)} />
              )}
              {b.servingStyle && <Row label="Serving style" value={servingStyleLabel(b.servingStyle) ?? b.servingStyle} />}
              <Row label="Deposit" value={b.depositStatus} />
            </div>
            <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.9rem' }}>
              <Row label={isDelivery ? 'Delivery address' : 'Venue'} value={b.venueAddress} />
              <Row label="Contact number" value={b.contactNumber || '—'} />
            </div>
          </div>

          {/* Dietary requirements sit above the line items, in their own panel: the
              kitchen has to see them, and a row in a grid of eight is where they get
              missed. */}
          {b.dietaryRequirements && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--text-primary)', background: 'var(--accent-muted)', borderRadius: 'var(--r-lg)', padding: '0.7rem 0.9rem', borderLeft: '3px solid var(--accent)', margin: 0, whiteSpace: 'pre-wrap' }}>
              <strong style={{ fontWeight: 600 }}>Dietary requirements:</strong> {b.dietaryRequirements}
            </p>
          )}

          {(b.motif || b.theme) && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', margin: 0 }}>
              <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Styling:</strong>{' '}
              {[b.motif && `motif ${b.motif}`, b.theme && `theme ${b.theme}`].filter(Boolean).join(' · ')}
            </p>
          )}

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
            {!hasLines && !detail.package ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                Nothing has been added to this booking yet.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300 }}>
                <tbody>
                  {detail.package && (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.45rem 0' }}>
                        <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Package — {detail.package.packageName}</strong>
                      </td>
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
                                disabled={busyLineId === r.lineId}
                                onClick={() => onRentalAction(r, next)}
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
                  {detail.services.map((sv) => (
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
                detail={detail}
                notify={notify}
                onChanged={onItemsChanged}
              />
            </div>
          )}

          <div>
            <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, margin: '0 0 0.7rem' }}>Money</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.9rem' }}>
              <Row label="Line items" value={fmt(lineTotal)} />
              <Row label="Booking total" value={fmt(b.totalAmount)} />
              {invoice ? (
                <>
                  {invoice.taxAmount > 0 && <Row label="Tax" value={fmt(invoice.taxAmount)} />}
                  <Row label="Grand total" value={<span style={{ color: 'var(--primary)' }}>{fmt(invoice.grandTotal)}</span>} />
                  <Row label="Paid" value={fmt(invoice.paidTotal)} />
                  <Row label="Balance" value={fmt(invoice.grandTotal - invoice.paidTotal)} />
                  <Row label="Invoice status" value={invoice.status} />
                  <Row label="Due date" value={fmtDate(invoice.dueDate)} />
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
}
