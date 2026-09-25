/**
 * The printable service contract for a Confirmed booking, over any tab.
 *
 * The page fetches the booking detail and invoice and hands them in. The Terms
 * section is the one part fetched here: the server drafts it for this booking
 * (standard clauses filled from its facts, adapted by AI when available and checked
 * against those facts). Staff can edit the clauses or ask for a new draft before
 * printing; edits live only in this modal and are printed as shown.
 *
 * `id="adm-contract"` and `adm-contract-noprint` are what the page's print
 * stylesheet targets; they must survive any restyle.
 */
import { useEffect, useState } from 'react';
import {
  BookingApiError,
  draftContractTerms,
  type BookingDetailResponse,
  type ContractClause,
  type ContractTerms,
  type InvoiceResponseDto,
} from '../../../api/bookingApi';
import { fmt, fmtDate } from '../../../lib/format';
import { readSession } from '../../../lib/tokenStorage';
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

  const [terms, setTerms] = useState<ContractTerms | null>(null);
  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const loadTerms = async (regenerate: boolean) => {
    const session = readSession();
    if (!session?.token) {
      setTermsError('You are not signed in.');
      setTermsLoading(false);
      return;
    }
    setTermsLoading(true);
    setTermsError(null);
    try {
      const t = await draftContractTerms(session.token, b.id, regenerate);
      setTerms(t);
      setClauses(t.clauses);
      setEditing(false);
    } catch (err) {
      setTermsError(err instanceof BookingApiError ? err.message : 'Could not draft the contract terms.');
    } finally {
      setTermsLoading(false);
    }
  };

  useEffect(() => {
    void loadTerms(false);
    // Once per opened contract: the modal is remounted for each booking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editClause = (i: number, patch: Partial<ContractClause>) =>
    setClauses((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

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
            <button type="button" className="adm-btn primary" disabled={termsLoading || clauses.length === 0} onClick={() => window.print()}>Print / Save as PDF</button>
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
          {/* Staff-only strip: how the terms were made, and the controls to change them. */}
          <div className="adm-contract-noprint" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 0.7rem', padding: '0.55rem 0.75rem', borderRadius: '10px', background: 'var(--surface-muted, rgba(0,0,0,0.04))', fontFamily: 'var(--font-body)', fontSize: '0.7rem', lineHeight: 1.5, color: 'var(--text-muted)' }}>
            <span style={{ flex: '1 1 220px' }}>
              {termsLoading
                ? 'Drafting terms for this booking…'
                : termsError
                  ? termsError
                  : <><strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{terms?.source === 'Gemini' ? 'AI-drafted terms.' : 'Standard terms.'}</strong> {terms?.note}</>}
            </span>
            {!termsLoading && terms && (
              <>
                <button type="button" className="adm-btn outline" onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Done Editing' : 'Edit Terms'}
                </button>
                <button type="button" className="adm-btn outline" onClick={() => void loadTerms(true)}>
                  {terms.source === 'Gemini' ? 'Redraft' : 'Try AI Again'}
                </button>
              </>
            )}
            {!termsLoading && termsError && (
              <button type="button" className="adm-btn outline" onClick={() => void loadTerms(false)}>Retry</button>
            )}
          </div>

          {editing ? (
            <div className="adm-contract-noprint" style={{ display: 'grid', gap: '0.6rem' }}>
              {clauses.map((c, i) => (
                <div key={i} style={{ display: 'grid', gap: '0.3rem' }}>
                  <input
                    className="adm-input"
                    aria-label={`Clause ${i + 1} title`}
                    value={c.title}
                    onChange={(e) => editClause(i, { title: e.target.value })}
                  />
                  <textarea
                    className="adm-input"
                    aria-label={`Clause ${i + 1} text`}
                    rows={5}
                    value={c.text}
                    onChange={(e) => editClause(i, { text: e.target.value })}
                    style={{ resize: 'vertical', fontFamily: 'var(--font-body)', borderRadius: '12px' }}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {/* The printed terms. Also a live preview while the editor above is open. */}
          <ol style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, lineHeight: 1.75, color: 'var(--text-muted)', paddingLeft: '1.1rem', margin: editing ? '0.9rem 0 0' : 0 }}>
            {clauses.map((c, i) => (
              <li key={i}>
                <strong style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{c.title}.</strong> {c.text}
              </li>
            ))}
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
