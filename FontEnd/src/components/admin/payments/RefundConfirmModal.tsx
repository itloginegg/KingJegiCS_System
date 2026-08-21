import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AdminPaymentRecord, RefundRequestQueueItem } from '../../../api/paymentAdminApi';
import { refundableRemaining } from './types';

export interface RefundConfirmModalProps {
  payment: AdminPaymentRecord;
  /** The customer's open request, when the queue has one for this payment. */
  request?: RefundRequestQueueItem;
  busy: boolean;
  onCancel: () => void;
  /** Runs the refund. Amount is always explicit — never omitted for "full". */
  onConfirm: (amount: number) => void;
}

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Confirmation step for a refund.
 *
 * Exists because a single dropdown click must never reach the refund endpoint: this is
 * the one admin action that moves money out of the business, and it is only partly
 * reversible (a further refund cannot be undone at all).
 *
 * The amount is always sent explicitly rather than relying on the API's "omit for
 * full" shorthand — what the admin approved should be what was transmitted, even if
 * the remaining balance shifts between render and click.
 */
export function RefundConfirmModal({ payment, request, busy, onCancel, onConfirm }: RefundConfirmModalProps) {
  const remaining = refundableRemaining(payment);
  /* Default to the customer's ask, capped at what's actually left. */
  const suggested = useMemo(
    () => Math.min(request?.requestedAmount ?? remaining, remaining),
    [request, remaining],
  );
  const [amount, setAmount] = useState(suggested.toFixed(2));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const parsed = Number(amount);
  const error =
    !Number.isFinite(parsed) || parsed <= 0
      ? 'Enter an amount greater than zero.'
      : parsed > remaining + 1e-9
        ? `That exceeds the refundable balance of ${peso(remaining)}.`
        : null;

  const isGateway = payment.gatewayProvider !== null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="refund-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)]"
      >
        <h2 id="refund-title" className="text-[1.05rem] font-semibold text-[var(--text-primary)]">
          Refund this payment
        </h2>
        <p className="mt-1 text-[0.76rem] text-[var(--text-muted)]">
          {payment.bookingName} · {payment.customerName}
        </p>

        <dl className="mt-4 space-y-1.5 rounded-xl bg-[var(--bg-subtle)] p-3 text-[0.78rem]">
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Amount paid</dt>
            <dd className="font-medium tabular-nums text-[var(--text-primary)]">{peso(payment.amountPaid)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Already refunded</dt>
            <dd className="font-medium tabular-nums text-[var(--text-primary)]">{peso(payment.refundedAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--border)] pt-1.5">
            <dt className="text-[var(--text-muted)]">Refundable remaining</dt>
            <dd className="font-semibold tabular-nums text-[var(--primary)]">{peso(remaining)}</dd>
          </div>
        </dl>

        {request && (
          <div className="mt-3 rounded-xl border border-[var(--border)] p-3 text-[0.76rem]">
            <p className="text-[var(--text-muted)]">
              Customer requested{' '}
              <strong className="font-semibold text-[var(--text-primary)]">{peso(request.requestedAmount)}</strong>
            </p>
            {request.reason && (
              <p className="mt-1 italic text-[var(--text-muted)]">“{request.reason}”</p>
            )}
          </div>
        )}

        {isGateway && (
          <div className="mt-3 flex gap-2 rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-muted)] p-3 text-[0.74rem] text-[var(--text-secondary)]">
            <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            <span>
              This was paid online via {payment.gatewayProvider}. Recording the refund here
              updates the invoice and deposit only — it does <strong>not</strong> move money
              back through {payment.gatewayProvider}. Issue the refund in the{' '}
              {payment.gatewayProvider} dashboard as well, or the books will show a refund
              the customer never received.
            </span>
          </div>
        )}

        <label className="mt-4 block">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--text-dim)]">
            Refund amount
          </span>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            max={remaining}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[0.85rem] tabular-nums text-[var(--text-primary)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-muted)]"
          />
        </label>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[0.72rem] text-[var(--danger)]">{error ?? ' '}</p>
          {parsed !== remaining && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAmount(remaining.toFixed(2))}
              className="shrink-0 text-[0.72rem] font-medium text-[var(--primary)] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              Refund full {peso(remaining)}
            </button>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-[0.78rem] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || error !== null}
            onClick={() => onConfirm(Number(parsed.toFixed(2)))}
            className="rounded-full bg-[var(--danger)] px-4 py-2 text-[0.78rem] font-semibold text-[var(--danger-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Refunding…' : error ? 'Refund' : `Refund ${peso(parsed)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RefundConfirmModal;
