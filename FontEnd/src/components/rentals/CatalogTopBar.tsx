import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react';

/** Sort keys, paired with the labels the <select> shows. */
export const SORT_LABELS = {
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
  'price-asc': 'Price (low→high)',
  'price-desc': 'Price (high→low)',
  availability: 'Availability',
} as const;

export type SortKey = keyof typeof SORT_LABELS;
export type ViewMode = 'grid' | 'list';

/**
 * The bar above the grid: sort, the mobile filters trigger, and the view toggle.
 *
 * Sort is a native <select>. A custom listbox would have to reimplement type-ahead,
 * touch behaviour and the platform's own keyboard model — all of which the native
 * control already ships, correctly, on every device this page runs on.
 */
export function CatalogTopBar({
  sort,
  onSortChange,
  view,
  onViewChange,
  onOpenFilters,
  activeFilterCount,
}: {
  sort: SortKey;
  onSortChange: (next: SortKey) => void;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  /** Opens the sidebar as a bottom sheet. Mobile only. */
  onOpenFilters: () => void;
  /** Drives the badge on the mobile Filters button — 0 hides it. */
  activeFilterCount: number;
}) {
  const toggleBase =
    'flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

  return (
    <div className="border-b border-border bg-bg">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-3 sm:px-10">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span
              className="text-[0.68rem] text-text-muted"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Sort
            </span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
              aria-label="Sort equipment"
              className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.75rem] text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          {/* Below md the sidebar is not in the document at all — this is the only
              way to reach the filters, so it is a button and not a decoration. */}
          <button
            type="button"
            onClick={onOpenFilters}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.75rem] text-text-secondary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none md:hidden"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[0.65rem] font-semibold text-accent-fg">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Result layout">
          <button
            type="button"
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
            className={`${toggleBase} ${
              view === 'list'
                ? 'bg-accent text-accent-fg'
                : 'border border-border bg-surface text-text-muted hover:bg-bg-subtle'
            }`}
          >
            <List size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
            className={`${toggleBase} ${
              view === 'grid'
                ? 'bg-accent text-accent-fg'
                : 'border border-border bg-surface text-text-muted hover:bg-bg-subtle'
            }`}
          >
            <LayoutGrid size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
