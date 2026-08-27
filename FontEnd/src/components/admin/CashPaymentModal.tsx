import { useEffect, useState } from 'react';
import { readSession } from '../../lib/tokenStorage';
import {
  getInvoiceByBooking,
  recordCashPayment,
  BookingApiError,
  type CashPaymentResult,
  type InvoiceResponseDto,
} from '../../api/bookingApi';

const fmt = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface CashPaymentModalProps {
  bookingId: string;
  bookingName: string;
  onClose: () => void;
  /** Fires with the server's result so the caller can re-render without refetching. */
  onRecorded: (result: CashPaymentResult) => void;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
}

/**
 * Log cash against a booking's invoice.
 *
 * Deliberately not the generic "record a payment" form: this posts to the cash
 * endpoint, which verifies in the same call. Recording cash the old way left the
 * payment Pending, the deposit Unpaid, and the booking un-confirmable with the money
 * already in the till.
 *
 * Resolves the invoice from the booking itself rather than taking an invoiceId, so
 * both call sites (the Bookings tab and the Payments tab) pass the same thing, and
 * the remaining balance shown here is always read fresh rather than inherited from a
 * possibly-stale list row.
 */
export function CashPaymentModal({ bookingId, bookingName, onClose, onRecorded, notify }: CashPaymentModalProps) {
  const [invoice, setInvoice] = useState<InvoiceResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = readSession()?.token ?? '';

    getInvoiceByBooking(token, bookingId)
      .then((inv) => { if (!cancelled) setInvoice(inv); })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            'This booking has no invoice yet. An invoice is issued when the booking is submitted — ' +
            'a Draft has nothing to pay against.',
          );
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [bookingId]);

  const remaining = invoice ? invoice.grandTotal - invoice.paidTotal : 0;
  const parsed = Number(amount);
  // The server enforces all of this too (ValidatePayableAsync); checking here just
  // saves a round trip and gives a message next to the field.
  const amountValid = amount.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= remaining + 1e-9;
  const amountError =
    amount.trim() === '' ? null
      : !Number.isFinite(parsed) || parsed <= 0 ? 'Enter an amount greater than zero.'
      : parsed > remaining + 1e-9 ? `That exceeds the remaining balance of ${fmt(remaining)}.`
      : null;

  const submit = async () => {
    const session = readSession();
    if (!session?.token || !invoice) return;

    setSaving(true);
    try {
      const result = await recordCashPayment(session.token, {
        invoiceId: invoice.id,
        amountPaid: parsed,
        transactionReference: reference,
      });
      onRecorded(result);
      notify(
        'success',
        `${fmt(parsed)} cash recorded and verified. Deposit is now ${result.depositStatus}.`,
      );
      onClose();
    } catch (err) {
      notify('error', err instanceof BookingApiError ? err.message : 'Could not record the payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="adm-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="adm-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Log cash payment"
        style={{ maxWidth: 460 }}
      >
        <h3 style={{ marginBottom: '0.2rem' }}>Log Cash Payment</h3>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 300, color: 'var(--text-dim)', margin: '0 0 1.1rem' }}>
          {bookingName}
        </p>

        {loading ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)' }}>
            Loading invoice…
          </p>
        ) : loadError ? (
          <>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', lineHeight: 1.6 }}>
              {loadError}
            </p>
            <div className="form-actions">
              <button type="button" className="adm-btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : invoice ? (
          <>
            <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '0.75rem 0.9rem', marginBottom: '1rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>Invoice total</span><span>{fmt(invoice.grandTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>Already paid</span><span>{fmt(invoice.paidTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginTop: '0.25rem', paddingTop: '0.25rem', borderTop: '1px solid var(--border)', color: 'var(--text-primary)', fontWeight: 500 }}>
                <span>Remaining</span><span>{fmt(remaining)}</span>
              </div>
            </div>

            <div className="form-grid full">
              <div className="form-row">
                <label htmlFor="cash-amount">Amount received</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    id="cash-amount"
                    className="adm-input"
                    type="number"
                    min={0.01}
                    step="0.01"
                    max={remaining}
                    placeholder="0.00"
                    value={amount}
                    disabled={saving}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="adm-btn"
                    disabled={saving || remaining <= 0}
                    onClick={() => setAmount(String(remaining))}
                  >
                    Full
                  </button>
                </div>
                {amountError && (
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--danger)', textTransform: 'none', letterSpacing: 'normal' }}>
                    {amountError}
                  </span>
                )}
              </div>

              <div className="form-row">
                <label htmlFor="cash-ref">Receipt / reference (optional)</label>
                <input
                  id="cash-ref"
                  className="adm-input"
                  maxLength={200}
                  placeholder="OR-00123"
                  value={reference}
                  disabled={saving}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)', margin: '0.2rem 0 0' }}>
              Cash is verified as it's logged — there's no separate confirmation step. The
              booking still needs a deliberate Confirm click.
            </p>

            <div className="form-actions">
              <button type="button" className="adm-btn" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="adm-btn primary" onClick={() => void submit()} disabled={saving || !amountValid}>
                {saving ? 'Recording…' : 'Record Cash Payment'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
