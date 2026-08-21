import { useMemo, useState } from 'react';
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import type { AdminPaymentRecord } from '../../../api/paymentAdminApi';
import { RowActionMenu } from '../shared/RowActionMenu';
import type { ActionItem } from '../shared/types';
import {
  methodColor,
  methodLabel,
  refundBlockedReason,
  refundableRemaining,
  type PaymentRowActions,
  type PaymentSortKey,
  type PaymentSortState,
  type RefundRequestLookup,
} from './types';

export interface PaymentsTableProps {
  rows: AdminPaymentRecord[];
  actions: PaymentRowActions;
  /** Payment id currently mid-request, so its menu can show a pending label. */
  busyId: string | null;
  findRequest: RefundRequestLookup;
  loading: boolean;
  error: string | null;
  isAuthError: boolean;
  onRetry: () => void;
  /** Status label + colour, from the page's existing PAYMENT_STATUS map. */
  statusMeta: (status: string) => { label: string; color: string };
}

interface Column {
  key: string;
  label: string;
  sort?: PaymentSortKey;
  align?: 'right';
  /** Header text is kept for screen readers but hidden visually. */
  srOnly?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'invoiceId', label: 'Invoice Id', sort: 'invoiceId' },
  { key: 'customer', label: 'Customer', sort: 'customerName' },
  { key: 'date', label: 'Date', sort: 'paymentDateTime' },
  { key: 'amount', label: 'Amount', sort: 'amountPaid', align: 'right' },
  // Visually-hidden rather than deleted: the column still needs a name in the
  // accessibility tree, or every cell in it is announced without context.
  { key: 'method', label: 'Method', sort: 'method', srOnly: true },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'action', label: 'Action', srOnly: true },
];

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Invoice ids are GUIDs; the first block is enough to eyeball and copy. */
const shortId = (id: string) => `#${id.slice(0, 8)}`;

function compare(a: AdminPaymentRecord, b: AdminPaymentRecord, key: PaymentSortKey): number {
  if (key === 'amountPaid') return a.amountPaid - b.amountPaid;
  if (key === 'paymentDateTime') {
    return new Date(a.paymentDateTime).getTime() - new Date(b.paymentDateTime).getTime();
  }
  return String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { sensitivity: 'base' });
}

export function PaymentsTable({
  rows, actions, busyId, findRequest,
  loading, error, isAuthError, onRetry, statusMeta,
}: PaymentsTableProps) {
  const [sort, setSort] = useState<PaymentSortState>({ key: 'paymentDateTime', dir: 'desc' });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const c = compare(a, b, sort.key);
      return sort.dir === 'asc' ? c : -c;
    });
    return copy;
  }, [rows, sort]);

  const applySort = (key: PaymentSortKey) =>
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }));

  const itemsFor = (p: AdminPaymentRecord): ActionItem[] => {
    const items: ActionItem[] = [];
    const busy = busyId === p.id;

    if (p.status === 'Pending') {
      items.push(
        { key: 'confirm', label: busy ? 'Working…' : 'Confirm payment', disabled: busy, onSelect: () => actions.onConfirm(p) },
        { key: 'reject', label: 'Reject payment', danger: true, disabled: busy, onSelect: () => actions.onReject(p) },
      );
      return items;
    }

    const blocked = refundBlockedReason(p);
    items.push({
      key: 'refund',
      // An open request makes this an approval, not a unilateral refund — the server
      // refuses anything else, so the label should say what's actually happening.
      label: p.refundRequested ? 'Approve refund…' : 'Refund…',
      disabled: busy || blocked !== null,
      hint: blocked ?? undefined,
      onSelect: () => actions.onRefund(p),
    });

    if (p.refundRequested) {
      items.push({
        key: 'deny',
        label: 'Deny refund…',
        danger: true,
        disabled: busy,
        onSelect: () => actions.onDenyRefund(p),
      });
    }

    return items;
  };

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="adm-skel mb-2 h-11 rounded-lg" aria-hidden="true" />
        ))}
        <span className="sr-only">Loading payments…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-8 py-10 text-center">
        <p className="text-[0.85rem] text-[var(--danger)]">{error}</p>
        {/* An expired session can't be fixed by retrying — send them to sign in. */}
        {isAuthError ? (
          <a
            href="/login"
            className="mt-3 inline-block rounded-full bg-[var(--primary)] px-4 py-2 text-[0.78rem] font-semibold text-[var(--primary-text)]"
          >
            Sign in again
          </a>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-full border border-[var(--border)] px-4 py-2 text-[0.78rem] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)]"
          >
            Try Again
          </button>
        )}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-8 py-12 text-center text-[0.85rem] text-[var(--text-muted)]">
        No payments match the current view.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {COLUMNS.map((col) => {
                const active = col.sort && sort.key === col.sort;
                const SortIcon = active
                  ? (sort.dir === 'asc' ? ChevronUp : ChevronDown)
                  : ChevronsUpDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`whitespace-nowrap px-4 py-3 text-[0.78rem] font-bold text-[var(--text-primary)] ${
                      col.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        onClick={() => applySort(col.sort!)}
                        className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                          active ? 'text-[var(--primary)]' : ''
                        }`}
                      >
                        <span className={col.srOnly ? 'sr-only' : undefined}>{col.label}</span>
                        <SortIcon size={13} strokeWidth={2} className="opacity-60" />
                      </button>
                    ) : (
                      <span className={col.srOnly ? 'sr-only' : undefined}>{col.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sorted.map((p) => {
              const remaining = refundableRemaining(p);
              const meta = statusMeta(p.status);
              return (
                <tr key={p.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 text-[0.8rem] font-medium tabular-nums text-[var(--text-primary)]">
                    <span title={p.invoiceId}>{shortId(p.invoiceId)}</span>
                  </td>

                  <td className="max-w-[200px] px-4 py-3">
                    <span className="block truncate text-[0.8rem] text-[var(--text-primary)]" title={p.customerName}>
                      {p.customerName}
                    </span>
                    <span className="block truncate text-[0.7rem] text-[var(--text-muted)]" title={p.bookingName}>
                      {p.bookingName}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-[0.8rem] text-[var(--text-secondary)]">
                    {fmtDate(p.paymentDateTime)}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="block text-[0.82rem] font-semibold tabular-nums text-[var(--text-primary)]">
                      {peso(p.amountPaid)}
                    </span>
                    {/* Only when money has actually gone back — otherwise every row
                        carries a redundant "₱0.00 refunded". */}
                    {p.refundedAmount > 0 && (
                      <span className="block text-[0.68rem] tabular-nums text-[var(--text-muted)]">
                        −{peso(p.refundedAmount)} refunded · {peso(remaining)} left
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[0.68rem] font-semibold text-white"
                      style={{ background: methodColor(p.method) }}
                    >
                      {methodLabel(p.method)}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[0.68rem] font-semibold"
                      style={{
                        color: meta.color,
                        background: `color-mix(in srgb, ${meta.color} 13%, transparent)`,
                      }}
                    >
                      {meta.label}
                    </span>
                    {p.refundRequested && (
                      <span className="mt-1 block text-[0.66rem] font-medium text-[var(--accent)]">
                        Refund requested
                        {findRequest(p.id) ? ` · ${peso(findRequest(p.id)!.requestedAmount)}` : ''}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 align-middle">
                    <RowActionMenu
                      label={`Actions for payment ${shortId(p.invoiceId)}`}
                      items={itemsFor(p)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PaymentsTable;
