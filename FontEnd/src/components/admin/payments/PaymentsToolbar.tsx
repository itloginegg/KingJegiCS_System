import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { BOOKING_TYPE_LABELS, type BookingResponse, type BookingTypeName } from '../../../api/bookingApi';
import { DatePickerPopover } from './DatePickerPopover';
import { METHOD_COLORS, methodColor, methodLabel } from './types';

/** Mirrors PaymentStatus on the backend. */
const STATUS_OPTIONS = ['all', 'Pending', 'Success', 'Failed', 'PartiallyRefunded', 'Refunded'] as const;
const TYPE_OPTIONS: ('all' | BookingTypeName)[] = ['all', 'FullService', 'FoodDelivery', 'RentalService'];
const METHOD_OPTIONS = ['all', ...Object.keys(METHOD_COLORS)];

export interface PaymentsToolbarProps {
  search: string;
  onSearchChange: (next: string) => void;

  statusFilter: string;
  onStatusFilterChange: (next: string) => void;
  typeFilter: 'all' | BookingTypeName;
  onTypeFilterChange: (next: 'all' | BookingTypeName) => void;
  methodFilter: string;
  onMethodFilterChange: (next: string) => void;

  filterOpen: boolean;
  onToggleFilter: () => void;

  /** "YYYY-MM-DD" — the day the table is showing. Defaults to today, never a fixed date. */
  date: string;
  onDateChange: (next: string) => void;

  /** Bookings with an outstanding balance — the only ones worth logging cash against. */
  cashCandidates: BookingResponse[];
  onLogCash: (booking: BookingResponse) => void;
}

/**
 * Payments toolbar.
 *
 * The magnifier sits on the LEFT, matching BookingsToolbar. The mockup put it on the
 * right, but two admin tables with mirrored search affordances is an inconsistency
 * that buys nothing — if it moves, it should move in both places.
 */
export function PaymentsToolbar({
  search, onSearchChange,
  statusFilter, onStatusFilterChange,
  typeFilter, onTypeFilterChange,
  methodFilter, onMethodFilterChange,
  filterOpen, onToggleFilter,
  date, onDateChange,
  cashCandidates, onLogCash,
}: PaymentsToolbarProps) {
  const [cashOpen, setCashOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const cashRef = useRef<HTMLDivElement | null>(null);

  const activeFilters =
    (statusFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) + (methodFilter !== 'all' ? 1 : 0);

  useEffect(() => {
    if (!cashOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!cashRef.current?.contains(e.target as Node)) setCashOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setCashOpen(false); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [cashOpen]);

  const prettyDate = (() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-PH', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  })();

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[0.74rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
      active
        ? 'border-[var(--primary)] bg-[var(--primary)] font-medium text-[var(--primary-text)]'
        : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'
    }`;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[250px]">
          <Search
            size={15}
            strokeWidth={1.8}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search invoice or customer..."
            aria-label="Search payments by invoice, customer or reference"
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] py-2 pl-9 pr-3.5 text-[0.8rem] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-muted)]"
          />
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setDateOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={dateOpen}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[0.78rem] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <Calendar size={15} strokeWidth={1.8} className="text-[var(--text-muted)]" />
            {prettyDate}
            <ChevronDown size={14} strokeWidth={2} className="text-[var(--text-muted)]" />
          </button>

          {dateOpen && (
            <DatePickerPopover value={date} onChange={onDateChange} onClose={() => setDateOpen(false)} />
          )}
        </div>

        <button
          type="button"
          onClick={onToggleFilter}
          aria-expanded={filterOpen}
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[0.78rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
            filterOpen || activeFilters > 0
              ? 'border-[var(--primary)] bg-[var(--primary-muted)] text-[var(--primary)]'
              : 'border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
          }`}
        >
          <SlidersHorizontal size={15} strokeWidth={1.8} />
          Filters
          {activeFilters > 0 && (
            <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#9D2553] text-[0.6rem] font-bold text-white">
              {activeFilters}
            </span>
          )}
        </button>

        <div ref={cashRef} className="relative">
          <button
            type="button"
            onClick={() => setCashOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={cashOpen}
            disabled={cashCandidates.length === 0}
            title={cashCandidates.length === 0 ? 'No bookings have an outstanding balance.' : undefined}
            className="flex items-center gap-2 rounded-full px-5 py-2 text-[0.78rem] font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: '#9D2553' }}
          >
            Log cash
          </button>

          {cashOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-1 max-h-72 w-[19rem] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lg)]"
            >
              {cashCandidates.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { setCashOpen(false); onLogCash(b); }}
                  className="block w-full px-3.5 py-2 text-left text-[0.78rem] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] focus:bg-[var(--bg-subtle)] focus-visible:outline-none"
                >
                  <span className="block truncate font-medium text-[var(--text-primary)]">{b.bookingName}</span>
                  <span className="block text-[0.7rem] text-[var(--text-muted)]">
                    {b.eventDate} · deposit {b.depositStatus}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {filterOpen && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Status</span>
            {STATUS_OPTIONS.map((k) => (
              <button key={k} type="button" onClick={() => onStatusFilterChange(k)} className={chip(statusFilter === k)}>
                {k === 'all' ? 'All' : methodLabel(k)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Method</span>
            {METHOD_OPTIONS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onMethodFilterChange(k)}
                className={chip(methodFilter === k)}
                style={methodFilter === k && k !== 'all'
                  ? { background: methodColor(k), borderColor: methodColor(k), color: '#fff' }
                  : undefined}
              >
                {k === 'all' ? 'All' : methodLabel(k)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Booking</span>
            {TYPE_OPTIONS.map((k) => (
              <button key={k} type="button" onClick={() => onTypeFilterChange(k)} className={chip(typeFilter === k)}>
                {k === 'all' ? 'All Types' : BOOKING_TYPE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PaymentsToolbar;
