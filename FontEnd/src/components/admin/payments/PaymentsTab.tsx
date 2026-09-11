/**
 * The Payments tab: one day's transactions, the refund queue above them, and the
 * confirm / reject / refund / deny actions.
 *
 * FIRST OF THE TABS TO COME OUT OF AdminDashboardPage, and the split follows
 * where the data divides rather than where the JSX does.
 *
 * OWNED HERE: everything scoped to this tab - the four filters, the day being
 * viewed, that day's rows, and the modals' targets. `datedPayments` is narrowed
 * to one date server-side and nothing outside this file reads it.
 *
 * PASSED IN: `refundQueue` and the payments loading flags, because the same
 * fetch feeds the Overview's revenue tiles; `reservations`, because the Bookings
 * tab owns them; and `onRunAction`, because confirming a payment switches tabs
 * and refreshes bookings - page concerns, not this tab's.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  getRecentPayments,
  PaymentApiError,
  type AdminPaymentRecord,
  type RefundRequestQueueItem,
} from '../../../api/paymentAdminApi';
import type { BookingResponse, BookingTypeName } from '../../../api/bookingApi';
import { Link } from 'react-router-dom';
import { readSession } from '../../../lib/tokenStorage';
import { fmt } from '../../../lib/format';
import { FieldLabel } from '../shared/StatusBadge';
import { PaymentsToolbar } from './PaymentsToolbar';
import { PaymentsTable } from './PaymentsTable';
import { RefundConfirmModal } from './RefundConfirmModal';

/* Ramp roles only, same reasoning as RES_STATUS in statusMeta: Pending was
   --accent and Success --primary, which under the plum palette put Pending next
   to Failed as a second red and rendered Success as near-black text. */
export type PaymentStatusKey = 'Pending' | 'Success' | 'Failed' | 'PartiallyRefunded' | 'Refunded';

const PAYMENT_STATUS: Record<PaymentStatusKey, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--warning-ink)' },
  Success: { label: 'Success', color: 'var(--status-paid)' },
  Failed: { label: 'Failed', color: 'var(--danger-ink)' },
  PartiallyRefunded: { label: 'Partially Refunded', color: 'var(--status-refund)' },
  Refunded: { label: 'Refunded', color: 'var(--status-refund)' },
};

export const paymentStatusMeta = (status: string) =>
  PAYMENT_STATUS[status as PaymentStatusKey] ?? { label: status, color: 'var(--text-secondary)' };

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface PaymentsTabProps {
  /** True while this is the visible tab; drives the refetch on entry. */
  active: boolean;
  refundQueue: RefundRequestQueueItem[];
  /** Bookings, for the Log Cash dropdown's candidate list. */
  reservations: BookingResponse[];
  paymentsLoading: boolean;
  paymentsError: string | null;
  paymentsAuthError: boolean;
  /** Payment id currently mid-action, or null. */
  actionBusyId: string | null;
  /** Changes after any payment action; reloads the day currently shown. */
  refreshToken: number;
  /** Set by a notification hand-off to point this tab at something specific. */
  focus: { search: string; date: string } | null;
  onRunAction: (
    paymentId: string,
    action: 'confirm' | 'reject' | 'refund' | 'deny',
    extra?: { amount?: number; reason?: string },
  ) => void;
  onRetryPayments: () => void;
  onLogCash: (booking: BookingResponse) => void;
}

export function PaymentsTab({
  active,
  refundQueue,
  reservations,
  paymentsLoading,
  paymentsError,
  paymentsAuthError,
  actionBusyId: paymentActionBusy,
  refreshToken,
  focus,
  onRunAction: runPaymentAction,
  onRetryPayments: loadPayments,
  onLogCash,
}: PaymentsTabProps) {
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentStatusKey>('all');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<'all' | BookingTypeName>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentFilterOpen, setPaymentFilterOpen] = useState(false);

  /* Scoped to one day, server-side. It gets its own state and loader rather than
     sharing the page's `payments`: that array also feeds the Overview revenue
     tiles and the refund queue, and narrowing it to a single day would quietly
     wrong those numbers. Defaults to today - never a hardcoded date. */
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
  const [denyTargetId, setDenyTargetId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

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

  /* Refetch on entry and whenever the day changes. Gated on `active` so the tab
     does not poll while another one is showing. */
  useEffect(() => {
    if (active) void loadDatedPayments(paymentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paymentDate, refreshToken]);

  /* A notification asked for a particular payment. Clearing the other filters is
     the point: the row is being pointed AT, and leaving a stale status filter on
     would hide the very thing the hand-off promised to show. */
  useEffect(() => {
    if (!focus) return;
    setPaymentSearch(focus.search);
    setPaymentFilter('all');
    setPaymentMethodFilter('all');
    setPaymentTypeFilter('all');
    setPaymentDate(focus.date);
  }, [focus]);

  /* Status / method / booking-type / free-text, over the day the server already
     narrowed to. The date itself is NOT filtered here - doing that over a
     `take`-capped page would report an empty day for any date older than the
     newest 50 payments. */
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

  /** Bookings that can still take a cash payment - the Log Cash dropdown's source. */
  const cashCandidates = useMemo(
    () => reservations.filter(
      (b) => (b.status === 'Pending' || b.status === 'Confirmed') && b.depositStatus !== 'Paid',
    ),
    [reservations],
  );

  /** The open refund request for a payment, if the queue has one. */
  const findRefundRequest = (paymentId: string) =>
    refundQueue.find((r) => r.paymentId === paymentId);

  /* Deny, and close the prompt that asked for the reason.

     The dismissal belongs here now. It used to happen inside the page's action
     runner, which could reach these setters directly; with the prompt's state
     owned by this tab, a deny would otherwise leave the reason box sitting open
     over a request that had already been handled. */
  const denyRefundRequest = (paymentId: string) => {
    const reason = denyReason.trim();
    setDenyTargetId(null);
    setDenyReason('');
    void runPaymentAction(paymentId, 'deny', { reason });
  };

  return (
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
                  onLogCash={onLogCash}
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
                                <input aria-label="Reason shown to the customer" className="adm-input square" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Required" />
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                  type="button"
                                  className="adm-btn danger"
                                  disabled={!denyReason.trim() || busy}
                                  onClick={() => denyRefundRequest(rq.paymentId)}
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
                      <input aria-label="Reason shown to the customer" className="adm-input square" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Required" />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="adm-btn danger"
                        disabled={!denyReason.trim() || paymentActionBusy === denyTargetId}
                        onClick={() => denyRefundRequest(denyTargetId)}
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
  );
}
