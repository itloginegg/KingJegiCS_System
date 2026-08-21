import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { BOOKING_TYPE_LABELS, eventTypeLabel, type BookingResponse, type BookingTypeName } from '../../../api/bookingApi';
import {
  DEPOSIT_STATUS_ORDER,
  RES_STATUS,
  depositStatusMeta,
  fmtDate,
  fmtTime,
  type ResStatus,
} from '../../../pages/AdminDashboardPage';
import { RowActionMenu } from '../shared/RowActionMenu';
import {
  BOOKING_GROUPS,
  COLLAPSED_BY_DEFAULT,
  type ActionItem,
  type BookingBusyState,
  type BookingGroupKey,
  type BookingRowActions,
  type SortKey,
  type SortState,
} from './types';

export interface BookingsTableProps {
  rows: BookingResponse[];
  actions: BookingRowActions;
  busy: BookingBusyState;
  /** Jumps the tree-menu to a single group. */
  onViewAll: (group: BookingGroupKey) => void;
  /** null while the tree-menu is on 'all'; otherwise only that group renders. */
  activeGroup: 'all' | ResStatus;
}

interface Column {
  key: string;
  label: string;
  sort?: SortKey;
  align?: 'right';
}

const BASE_COLUMNS: Column[] = [
  { key: 'bookingType', label: 'Booking Type', sort: 'bookingType' },
  { key: 'eventType', label: 'Event Type', sort: 'eventType' },
  { key: 'bookingName', label: 'Booking Name', sort: 'bookingName' },
  { key: 'contactNumber', label: 'Phone Number', sort: 'contactNumber' },
  { key: 'customerEmail', label: 'Email', sort: 'customerEmail' },
  { key: 'guestCount', label: 'Guest Count', sort: 'guestCount', align: 'right' },
  { key: 'packageName', label: 'Package Selected', sort: 'packageName' },
  { key: 'start', label: 'Event Date / Start Time', sort: 'eventDate' },
  { key: 'end', label: 'End Date / End Time', sort: 'endDate' },
  { key: 'depositStatus', label: 'Payment Status', sort: 'depositStatus' },
];

/** Notes is the adminNote, which only exists on a Confirmed booking. */
const NOTES_COLUMN: Column = { key: 'adminNote', label: 'Notes' };
const ACTION_COLUMN: Column = { key: 'action', label: 'Action' };

const columnsFor = (group: BookingGroupKey): Column[] =>
  group === 'Confirmed'
    ? [...BASE_COLUMNS, NOTES_COLUMN, ACTION_COLUMN]
    : [...BASE_COLUMNS, ACTION_COLUMN];

/**
 * Sort comparator. Nulls always sink, in both directions — a missing end date is
 * absent rather than early, and floating them to the top on `desc` would bury every
 * row that actually has one.
 */
function compare(a: BookingResponse, b: BookingResponse, key: SortKey): number {
  const nullsLast = (x: unknown, y: unknown) => {
    const xn = x === null || x === undefined || x === '';
    const yn = y === null || y === undefined || y === '';
    if (xn && yn) return 0;
    if (xn) return 1;
    if (yn) return -1;
    return null;
  };

  switch (key) {
    case 'guestCount': {
      const n = nullsLast(a.guestCount, b.guestCount);
      return n ?? (a.guestCount! - b.guestCount!);
    }
    case 'depositStatus': {
      const rank = (s: string) => {
        const i = DEPOSIT_STATUS_ORDER.indexOf(s as (typeof DEPOSIT_STATUS_ORDER)[number]);
        return i === -1 ? DEPOSIT_STATUS_ORDER.length : i;
      };
      return rank(a.depositStatus) - rank(b.depositStatus);
    }
    case 'eventDate': {
      // eventDate is an ISO "YYYY-MM-DD", which orders correctly as a plain string —
      // no Date parsing, so a malformed value can't yield NaN and scramble the sort.
      const d = a.eventDate.localeCompare(b.eventDate);
      return d !== 0 ? d : (a.startTime ?? '').localeCompare(b.startTime ?? '');
    }
    case 'endDate': {
      const n = nullsLast(a.endDate, b.endDate);
      if (n !== null) return n;
      const d = a.endDate!.localeCompare(b.endDate!);
      return d !== 0 ? d : (a.endTime ?? '').localeCompare(b.endTime ?? '');
    }
    default: {
      const av = a[key as keyof BookingResponse] as string | null;
      const bv = b[key as keyof BookingResponse] as string | null;
      const n = nullsLast(av, bv);
      return n ?? av!.localeCompare(bv!, undefined, { sensitivity: 'base' });
    }
  }
}

/** Group header tag: solid indicator bar + status label on its own soft wash. */
function GroupTag({ group }: { group: BookingGroupKey }) {
  const meta = RES_STATUS[group as ResStatus];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-md py-1 pl-1 pr-2.5 text-[0.74rem] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
      }}
    >
      <span aria-hidden="true" className="h-3.5 w-1 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function PaymentBadge({ status }: { status: string }) {
  const meta = depositStatusMeta(status);
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[0.68rem] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 13%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

export function BookingsTable({ rows, actions, busy, onViewAll, activeGroup }: BookingsTableProps) {
  const [collapsed, setCollapsed] = useState<Set<BookingGroupKey>>(
    () => new Set(COLLAPSED_BY_DEFAULT),
  );
  const [sort, setSort] = useState<SortState>({ key: 'eventDate', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  /* Completed and Cancelled start collapsed, which is right when every group is
     competing for the page — but filtering down to one of them would then land on a
     header with nothing under it. Asking for a status expands it. */
  useEffect(() => {
    if (activeGroup === 'all') return;
    setCollapsed((prev) => {
      if (!prev.has(activeGroup as BookingGroupKey)) return prev;
      const next = new Set(prev);
      next.delete(activeGroup as BookingGroupKey);
      return next;
    });
  }, [activeGroup]);

  const grouped = useMemo(() => {
    const out = {} as Record<BookingGroupKey, BookingResponse[]>;
    for (const g of BOOKING_GROUPS) out[g] = [];
    for (const r of rows) {
      const g = r.status as BookingGroupKey;
      if (out[g]) out[g].push(r);
    }
    for (const g of BOOKING_GROUPS) {
      out[g].sort((a, b) => {
        const c = compare(a, b, sort.key);
        return sort.dir === 'asc' ? c : -c;
      });
    }
    return out;
  }, [rows, sort]);

  const toggleGroup = (g: BookingGroupKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const applySort = (key: SortKey) =>
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }));

  /** Menu contents per status. Every entry calls a handler that already existed. */
  const itemsFor = (b: BookingResponse): ActionItem[] => {
    const history: ActionItem = {
      key: 'history', label: 'View History', onSelect: () => actions.onViewHistory(b),
    };
    const cancel: ActionItem = {
      key: 'cancel', label: 'Cancel', danger: true, onSelect: () => actions.onCancel(b),
    };

    switch (b.status as BookingGroupKey) {
      case 'Draft':
        return [
          {
            key: 'submit',
            label: busy.submitBusyId === b.id ? 'Submitting…' : 'Submit for customer',
            disabled: busy.submitBusyId === b.id,
            onSelect: () => actions.onSubmitDraft(b),
          },
          {
            key: 'items',
            label: busy.detailBusyId === b.id ? 'Loading…' : 'Add Items',
            disabled: busy.detailBusyId === b.id,
            onSelect: () => actions.onOpenDetail(b),
          },
          history,
        ];

      case 'Pending':
        return [
          { key: 'cash', label: 'Log Cash', onSelect: () => actions.onLogCash(b) },
          {
            key: 'confirm',
            label: 'Confirm',
            // Mirrors ConfirmBookingAsync's own guard, so the reason shows before the
            // click rather than as a 400 after it.
            disabled: b.depositStatus === 'Unpaid',
            hint: b.depositStatus === 'Unpaid'
              ? 'No payment recorded yet — log the deposit first.'
              : undefined,
            onSelect: () => actions.onConfirm(b),
          },
          {
            key: 'invoice',
            label: busy.invoiceBusyId === b.id ? 'Loading…' : 'Invoice',
            disabled: busy.invoiceBusyId === b.id,
            onSelect: () => actions.onOpenInvoice(b),
          },
          history,
          cancel,
        ];

      case 'Confirmed':
        return [
          { key: 'complete', label: 'Mark Completed', onSelect: () => actions.onMarkCompleted(b) },
          {
            key: 'invoice',
            label: busy.invoiceBusyId === b.id ? 'Loading…' : 'Invoice',
            disabled: busy.invoiceBusyId === b.id,
            onSelect: () => actions.onOpenInvoice(b),
          },
          {
            key: 'detail',
            label: busy.detailBusyId === b.id ? 'Loading…' : 'View Details',
            disabled: busy.detailBusyId === b.id,
            onSelect: () => actions.onOpenDetail(b),
          },
          {
            key: 'contract',
            label: busy.contractBusyId === b.id ? 'Preparing…' : 'Generate Contract',
            disabled: busy.contractBusyId === b.id,
            onSelect: () => actions.onGenerateContract(b),
          },
          {
            key: 'resources',
            label: `Allocate Resources${b.resourceAllocation?.isApproved ? ' ✓' : ''}`,
            onSelect: () => actions.onAllocateResources(b),
          },
          // Kept from the old button row: the staff note has its own endpoint and is
          // most useful on exactly these bookings.
          { key: 'note', label: b.adminNote ? 'Edit Note' : 'Add Note', onSelect: () => actions.onEditNote(b) },
          history,
          cancel,
        ];

      // Cancelled is terminal and the server refuses every transition on it, so the
      // record stays readable and nothing else is offered.
      case 'Cancelled':
        return [history];

      default:
        return [history];
    }
  };

  const visibleGroups = activeGroup === 'all'
    ? BOOKING_GROUPS
    : BOOKING_GROUPS.filter((g) => g === activeGroup);

  const anyRows = visibleGroups.some((g) => grouped[g].length > 0);
  if (!anyRows) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-8 py-12 text-center text-[0.85rem] text-[var(--text-muted)]">
        No bookings match the current view.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {visibleGroups.map((group) => {
        const groupRows = grouped[group];
        if (groupRows.length === 0) return null;

        const isCollapsed = collapsed.has(group);
        const columns = columnsFor(group);
        const Chevron = isCollapsed ? ChevronDown : ChevronUp;

        return (
          <section
            key={group}
            className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          >
            <header className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <GroupTag group={group} />
              <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[0.72rem] font-medium tabular-nums text-[var(--text-muted)]">
                {groupRows.length}
              </span>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group} bookings`}
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <Chevron size={16} strokeWidth={2} />
              </button>

              <button
                type="button"
                onClick={() => onViewAll(group)}
                className="ml-auto flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[0.74rem] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                View All
                <ArrowUpRight size={14} strokeWidth={2} />
              </button>
            </header>

            {!isCollapsed && (
              <div className="overflow-x-auto border-t border-[var(--border)]">
                <table className="w-full min-w-[1180px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                      <th scope="col" className="w-10 px-3 py-2.5">
                        <span className="sr-only">Select</span>
                      </th>
                      {columns.map((col) => {
                        const active = col.sort && sort.key === col.sort;
                        const SortIcon = active
                          ? (sort.dir === 'asc' ? ChevronUp : ChevronDown)
                          : ChevronsUpDown;
                        return (
                          <th
                            key={col.key}
                            scope="col"
                            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            className={`whitespace-nowrap px-3 py-2.5 text-[0.72rem] font-semibold text-[var(--text-secondary)] ${
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
                                {col.label}
                                <SortIcon size={13} strokeWidth={2} className="opacity-60" />
                              </button>
                            ) : (
                              col.label
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.map((b) => {
                      /* A FoodDelivery order carries no end date/time and no guest
                         count by design, so those cells render empty rather than "—". */
                      const isDelivery = b.bookingType === 'FoodDelivery';
                      return (
                        <tr key={b.id} className="border-b border-[var(--border)] last:border-b-0">
                          <td className="px-3 py-3 align-middle">
                            <input
                              type="checkbox"
                              checked={selected.has(b.id)}
                              onChange={() => toggleRow(b.id)}
                              aria-label={`Select ${b.bookingName}`}
                              className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                            />
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-[0.78rem] text-[var(--text-muted)]">
                            {BOOKING_TYPE_LABELS[b.bookingType as BookingTypeName] ?? b.bookingType}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[0.78rem] text-[var(--text-muted)]">
                            {eventTypeLabel(b.eventType) ?? '—'}
                          </td>
                          <td className="max-w-[210px] truncate px-3 py-3 text-[0.78rem] text-[var(--text-muted)]" title={b.bookingName}>
                            {b.bookingName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[0.78rem] text-[var(--text-muted)]">
                            {b.contactNumber || '—'}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-3 text-[0.78rem] text-[var(--text-muted)]" title={b.customerEmail ?? undefined}>
                            {b.customerEmail || '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-[0.78rem] text-[var(--text-muted)] tabular-nums">
                            {isDelivery ? '' : (b.guestCount ?? '—')}
                          </td>
                          <td className="max-w-[190px] truncate px-3 py-3 text-[0.78rem] text-[var(--text-muted)]" title={b.packageName ?? undefined}>
                            {b.packageName || '—'}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-[0.78rem] font-medium text-[var(--text-primary)]">
                            {fmtDate(b.eventDate)}
                            <span className="ml-1.5 font-normal text-[var(--text-muted)]">{fmtTime(b.startTime)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[0.78rem] font-medium text-[var(--text-primary)]">
                            {isDelivery ? '' : (
                              <>
                                {b.endDate ? fmtDate(b.endDate) : '—'}
                                <span className="ml-1.5 font-normal text-[var(--text-muted)]">{fmtTime(b.endTime)}</span>
                              </>
                            )}
                          </td>

                          <td className="px-3 py-3">
                            <PaymentBadge status={b.depositStatus} />
                          </td>

                          {group === 'Confirmed' && (
                            <td className="max-w-[220px] truncate px-3 py-3 text-[0.78rem] text-[var(--text-muted)]" title={b.adminNote ?? undefined}>
                              {b.adminNote || '—'}
                            </td>
                          )}

                          <td className="px-3 py-3">
                            <RowActionMenu
                              label={`Actions for ${b.bookingName}`}
                              // Completed is terminal: the row stays readable, the menu
                              // is disabled outright.
                              disabled={group === 'Completed'}
                              items={itemsFor(b)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default BookingsTable;
