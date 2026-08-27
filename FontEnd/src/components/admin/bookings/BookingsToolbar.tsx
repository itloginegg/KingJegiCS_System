import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { BOOKING_TYPE_LABELS, type BookingTypeName } from '../../../api/bookingApi';

export interface BookingsToolbarProps {
  search: string;
  onSearchChange: (next: string) => void;
  /** The page's existing `resTypeFilter` — the Filter button's one axis. */
  typeFilter: 'all' | BookingTypeName;
  onTypeFilterChange: (next: 'all' | BookingTypeName) => void;
  filterOpen: boolean;
  onToggleFilter: () => void;
  onAddBooking: () => void;
}

const TYPE_OPTIONS: ('all' | BookingTypeName)[] = ['all', 'FullService', 'FoodDelivery', 'RentalService'];

/**
 * Search + filter on the left, Add New Booking on the right.
 *
 * Add New Booking is `--accent`, per artboard 11a: in this direction the accent is
 * the action and `--primary` is structure. The token also carries the light/dark
 * inversion, so the rose fill and its white text become blush and plum in `.dark`
 * from one declaration.
 */
export function BookingsToolbar({
  search, onSearchChange,
  typeFilter, onTypeFilterChange,
  filterOpen, onToggleFilter,
  onAddBooking,
}: BookingsToolbarProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              size={15}
              strokeWidth={1.8}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              /* Matches what the filter actually searches — booking name, customer
                 email, contact number and event type. */
              placeholder="Search Name, Email or Event"
              aria-label="Search bookings"
              className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] py-2 pl-9 pr-3.5 text-[0.8rem] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-muted)]"
            />
          </div>

          <button
            type="button"
            onClick={onToggleFilter}
            aria-expanded={filterOpen}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[0.78rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
              filterOpen || typeFilter !== 'all'
                ? 'border-[var(--primary)] bg-[var(--primary-muted)] text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            <SlidersHorizontal size={15} strokeWidth={1.8} />
            Filter
            {typeFilter !== 'all' && (
              <span className="ml-0.5 rounded-full bg-[var(--accent)] px-1.5 text-[0.62rem] font-semibold text-[var(--accent-text)]">
                1
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="h-6 w-px bg-[var(--border)]" />
          <button
            type="button"
            onClick={onAddBooking}
            className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-[0.78rem] font-semibold text-[var(--accent-text)] transition-all hover:-translate-y-px hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            <Plus size={15} strokeWidth={2.4} />
            Add New Booking
          </button>
        </div>
      </div>

      {/* Booking type — the second, independent axis the old pill row carried.
          Kept behind the Filter button so the toolbar stays one line by default. */}
      {filterOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Booking type
          </span>
          {TYPE_OPTIONS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onTypeFilterChange(k)}
              className={`rounded-full px-3.5 py-2 text-[0.6875rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                typeFilter === k
                  ? 'bg-[var(--primary)] text-[var(--primary-text)]'
                  : 'bg-[var(--secondary-muted)] text-[var(--text-secondary)] hover:bg-[var(--primary-muted)]'
              }`}
            >
              {k === 'all' ? 'All Types' : BOOKING_TYPE_LABELS[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default BookingsToolbar;
