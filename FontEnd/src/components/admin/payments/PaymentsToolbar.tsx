import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, List, Search, SlidersHorizontal } from 'lucide-react';
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* left */}
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[190px] flex-1 sm:max-w-xs">
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
              placeholder="Search Payment"
              aria-label="Search payments by invoice, customer or reference"
              className="w-full rounded-full border border-transparent bg-[var(--bg-subtle)] py-2 pl-9 pr-3.5 text-[0.8rem] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:border-[var(--primary)] focus-visible:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-muted)]"
            />
          </div>

          <button
            type="button"
            onClick={onToggleFilter}
            aria-expanded={filterOpen}
            className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[0.78rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              filterOpen || activeFilters > 0
                ? 'border-[var(--primary)] bg-[var(--primary-muted)] text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            <SlidersHorizontal size={15} strokeWidth={1.8} />
            Filter
            {activeFilters > 0 && (
              <span className="ml-0.5 rounded-full bg-[var(--primary)] px-1.5 text-[0.62rem] font-semibold text-[var(--primary-text)]">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* right */}
        <div className="flex flex-wrap items-center gap-2">
          <div ref={cashRef} className="relative">
            <button
              type="button"
              onClick={() => setCashOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={cashOpen}
              disabled={cashCandidates.length === 0}
              title={cashCandidates.length === 0 ? 'No bookings have an outstanding balance.' : undefined}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[0.78rem] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <List size={15} strokeWidth={1.8} className="text-[var(--text-muted)]" />
              Log Cash Payment for…
              <ChevronDown size={14} strokeWidth={2} className="text-[var(--text-muted)]" />
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

          <div className="relative">
            <button
              type="button"
              onClick={() => setDateOpen((o) => !o)}
              aria-haspopup="dialog"
              aria-expanded={dateOpen}
              className="flex items-center gap-2 rounded-full border border-orange-400 bg-[var(--surface)] px-3.5 py-2 text-[0.78rem] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
            >
              <Calendar size={15} strokeWidth={1.8} className="text-[var(--text-muted)]" />
              {prettyDate}
              <ChevronDown size={14} strokeWidth={2} className="text-[var(--text-muted)]" />
            </button>

            {dateOpen && (
              <DatePickerPopover value={date} onChange={onDateChange} onClose={() => setDateOpen(false)} />
            )}
          </div>
        </div>
      </div>

      {filterOpen && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Status</span>
            {STATUS_OPTIONS.map((k) => (
              <button key={k} type="button" onClick={() => onStatusFilterChange(k)} className={chip(statusFilter === k)}>
                {k === 'all' ? 'All' : methodLabel(k)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Method</span>
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
            <span className="w-20 text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Booking</span>
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
