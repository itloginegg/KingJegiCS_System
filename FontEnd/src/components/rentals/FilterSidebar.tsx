import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { RENTAL_CATEGORIES, formatPeso, type RentalCategory } from './rentalData';
import { useDialog } from './useDialog';

export interface RentalFilters {
  categories: RentalCategory[];
  /**
   * [min, max] pesos per day, or null for "whatever the catalog spans".
   *
   * The null is what makes this work against an async catalog. Bounds are not
   * known at mount — they come from the response — so an eagerly-initialised
   * [0, 0] would filter every item out on arrival, and syncing it in an effect
   * would silently overwrite a range the customer had already dragged. null
   * defers to the live bounds until someone actually moves a handle.
   */
  priceRange: [number, number] | null;
  inStockOnly: boolean;
}

/**
 * The filter panel. Owns no state: every value and every setter comes from
 * RentalPage, so the desktop sidebar and the mobile sheet are two renderings of
 * one truth rather than two copies that can drift apart.
 */
export function FilterSidebar({
  filters,
  onChange,
  counts,
  bounds,
  hasActiveFilters,
  onClear,
  idPrefix,
}: {
  filters: RentalFilters;
  onChange: (next: RentalFilters) => void;
  /** Item count per category, derived from the source array — never hardcoded. */
  counts: Record<RentalCategory, number>;
  /** [cheapest, dearest] in the catalog, also derived. */
  bounds: [number, number];
  hasActiveFilters: boolean;
  onClear: () => void;
  /**
   * Namespaces the checkbox ids. Two instances of this panel are mounted at all
   * times — the desktop aside is hidden with `display:none`, not unmounted — so a
   * fixed id would appear twice in the document. Every `htmlFor` would then
   * resolve to whichever copy came first, and tapping a label in the mobile sheet
   * would toggle the hidden desktop checkbox instead of the visible one.
   */
  idPrefix: string;
}) {
  const [floor, ceiling] = bounds;
  const [low, high] = filters.priceRange ?? bounds;
  const span = Math.max(ceiling - floor, 1);

  const toggleCategory = (category: RentalCategory) =>
    onChange({
      ...filters,
      categories: filters.categories.includes(category)
        ? filters.categories.filter((c) => c !== category)
        : [...filters.categories, category],
    });

  const labelClass =
    'mb-3 block text-[0.6875rem] font-semibold tracking-[0.08em] text-text-muted uppercase';

  return (
    <div style={{ fontFamily: 'var(--font-body)' }}>
      <p className={labelClass}>Filters</p>

      {/* ── Category ── */}
      <fieldset className="mb-6 border-none p-0">
        <legend className={labelClass}>Category</legend>
        <div className="flex flex-col gap-2.5">
          {RENTAL_CATEGORIES.map((category) => {
            const id = `${idPrefix}-cat-${category.replace(/\W+/g, '-').toLowerCase()}`;
            return (
              <div key={category} className="flex items-center gap-2.5">
                <input
                  id={id}
                  type="checkbox"
                  checked={filters.categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                />
                <label
                  htmlFor={id}
                  className="flex-1 cursor-pointer text-[0.8rem] text-text-secondary"
                >
                  {category}
                </label>
                <span className="text-[0.75rem] text-text-muted tabular-nums">
                  {counts[category]}
                </span>
              </div>
            );
          })}
        </div>
      </fieldset>

      {/* ── Price range ──
          Each thumb clamps against the other, so they cannot cross and produce an
          inverted range that matches nothing. */}
      <div className="mb-6">
        <p className={labelClass}>Price range</p>
        <div className="rnt-range">
          <div className="rnt-range-track" />
          <div
            className="rnt-range-fill"
            style={{
              left: `${((low - floor) / span) * 100}%`,
              right: `${100 - ((high - floor) / span) * 100}%`,
            }}
          />
          <input
            type="range"
            min={floor}
            max={ceiling}
            value={low}
            aria-label="Minimum price per day"
            aria-valuetext={`${formatPeso(low)} per day`}
            onChange={(e) =>
              onChange({
                ...filters,
                priceRange: [Math.min(Number(e.target.value), high), high],
              })
            }
          />
          <input
            type="range"
            min={floor}
            max={ceiling}
            value={high}
            aria-label="Maximum price per day"
            aria-valuetext={`${formatPeso(high)} per day`}
            onChange={(e) =>
              onChange({
                ...filters,
                priceRange: [low, Math.max(Number(e.target.value), low)],
              })
            }
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[0.72rem] text-text-muted">
          <span>{formatPeso(low)} / day</span>
          <span>{formatPeso(high)} / day</span>
        </div>
      </div>

      {/* ── Availability ── */}
      <fieldset className="mb-6 border-none p-0">
        <legend className={labelClass}>Availability</legend>
        <div className="flex items-center gap-2.5">
          <input
            id={`${idPrefix}-in-stock`}
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(e) => onChange({ ...filters, inStockOnly: e.target.checked })}
            className="h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          />
          <label
            htmlFor={`${idPrefix}-in-stock`}
            className="cursor-pointer text-[0.8rem] text-text-secondary"
          >
            In stock only
          </label>
        </div>
      </fieldset>

      <button
        type="button"
        onClick={onClear}
        disabled={!hasActiveFilters}
        className="w-full cursor-pointer rounded-full border border-border bg-transparent px-4 py-2.5 text-[0.78rem] text-text-secondary transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:text-text-dim disabled:hover:border-border focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        Clear Filters
      </button>
    </div>
  );
}

/**
 * Mobile presentation of the panel: a bottom sheet over a scrim.
 *
 * Focus handling, Escape and the scroll lock come from useDialog, shared with
 * the checkout dialog.
 */
export function FilterSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useDialog(open, onClose, panelRef, closeRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:hidden">
      {/* Presentational: Escape and the labelled close button are the real
          dismissals, so this carries no role and no tab stop. */}
      <div
        className="absolute inset-0 bg-[rgb(0_0_0/0.5)]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter equipment"
        className="relative max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-bg-card p-6 shadow-card"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="absolute top-4 right-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <X size={16} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}
