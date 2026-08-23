import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navbar } from '../components/landing/Navbar';
import { readSession } from '../lib/tokenStorage';
import { fetchRentalItems } from '../api/rentalAdminApi';
import { RentalHero } from '../components/rentals/RentalHero';
import {
  CatalogTopBar,
  type SortKey,
  type ViewMode,
} from '../components/rentals/CatalogTopBar';
import {
  FilterSheet,
  FilterSidebar,
  type RentalFilters,
} from '../components/rentals/FilterSidebar';
import { RentalCard, RentalCardSkeleton } from '../components/rentals/RentalCard';
import {
  RentalListRow,
  RentalListRowSkeleton,
} from '../components/rentals/RentalListRow';
import { CatalogError, EmptyState } from '../components/rentals/EmptyState';
import { CartBar, cartPieces, type CartLine } from '../components/rentals/CartBar';
import { CheckoutModal } from '../components/rentals/CheckoutModal';
import {
  RENTAL_CATEGORIES,
  toRentalItem,
  type RentalCategory,
  type RentalItem,
} from '../components/rentals/rentalData';

const SKELETON_COUNT = 6;

/**
 * Equipment rental catalog and checkout.
 *
 * NOTE ON "PER DAY": the cards label prices "/ day", but the backend does not
 * price by duration — Bookingservice.ComputeTotal sums Rental.Subtotal, which is
 * `quantity × unit_price` and never reads the delivery/pickup window. The cart
 * and checkout totals therefore match the backend rather than the label. Making
 * the two agree is a product decision: either the label drops "/ day", or
 * Rental.Subtotal starts multiplying by the hire length.
 *
 * All of search, sort, filter and view state lives here and is handed down as
 * props. The hero's search field and the sidebar's checkboxes are two views of
 * one object, not two components each keeping their own copy — which is what
 * stops the "Showing N of M" count from disagreeing with the grid beneath it.
 *
 * Sorting and filtering are one useMemo over the source array rather than
 * derived state kept in sync by effects: there is no second array that can fall
 * out of date, because there is no second array.
 */
export function RentalPage() {
  const [items, setItems] = useState<RentalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * GET /api/Rentalitems is [AllowAnonymous] — guests may browse — so the token
   * is passed when there is one and omitted otherwise rather than gating the
   * catalog behind a login. Signed-in admins get the same list plus inactive
   * rows, which the isActive filter below drops: the public page shows what can
   * actually be rented, whoever is looking at it.
   */
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchRentalItems(readSession()?.token ?? '');
      setItems(rows.filter((r) => r.isActive).map(toRentalItem));
    } catch (err) {
      setItems([]);
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Something went wrong reaching the server.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  /* Price bounds and per-category counts come from the response. Hardcoding
     either means they silently lie the first time inventory changes.
     The empty guard matters: Math.min(...[]) is Infinity, which would render
     "₱Infinity" on the slider labels during the first paint. */
  const bounds = useMemo<[number, number]>(() => {
    if (items.length === 0) return [0, 0];
    const prices = items.map((i) => i.pricePerDay);
    return [Math.min(...prices), Math.max(...prices)];
  }, [items]);

  const counts = useMemo(() => {
    const tally = Object.fromEntries(
      RENTAL_CATEGORIES.map((c) => [c, 0]),
    ) as Record<RentalCategory, number>;
    for (const item of items) tally[item.category] += 1;
    return tally;
  }, [items]);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name-asc');
  const [view, setView] = useState<ViewMode>('grid');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filters, setFilters] = useState<RentalFilters>({
    categories: [],
    /* null, not `bounds` — the catalog has not arrived yet. See RentalFilters. */
    priceRange: null,
    inStockOnly: false,
  });

  /* Quantities live at page level so flipping grid↔list, or filtering an item out
     and back, does not silently reset what the customer picked. */
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  /** itemId → quantity queued for booking. */
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  /* Debounced, not throttled: filtering should settle on what was typed, and a
     250ms pause after the last keystroke is below the threshold where the list
     feels detached from the field. The Search button is a fallback, not the
     trigger — results are already live by the time it is reachable. */
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  /* An untouched (null) range is never "narrowed", however the bounds move as
     stock is added or retired — so Clear Filters stays correctly disabled. */
  const priceNarrowed =
    filters.priceRange !== null &&
    (filters.priceRange[0] !== bounds[0] || filters.priceRange[1] !== bounds[1]);

  const hasActiveFilters =
    filters.categories.length > 0 || filters.inStockOnly || priceNarrowed;

  const activeFilterCount =
    filters.categories.length + (filters.inStockOnly ? 1 : 0) + (priceNarrowed ? 1 : 0);

  const clearFilters = () =>
    setFilters({ categories: [], priceRange: null, inStockOnly: false });

  const visible = useMemo(() => {
    const needle = debouncedQuery.toLowerCase();
    const [priceFloor, priceCeiling] = filters.priceRange ?? bounds;

    const filtered = items.filter((item) => {
      if (filters.categories.length > 0 && !filters.categories.includes(item.category))
        return false;
      if (item.pricePerDay < priceFloor || item.pricePerDay > priceCeiling) return false;
      if (filters.inStockOnly && item.stock === 0) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle)
      );
    });

    /* Copy before sorting — Array.sort mutates, and `items` is the state array
       that bounds and counts also derive from. */
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'price-asc':
          return a.pricePerDay - b.pricePerDay;
        case 'price-desc':
          return b.pricePerDay - a.pricePerDay;
        case 'availability':
          /* Most available first, with names breaking ties so the order is
             stable rather than dependent on the source array. */
          return b.stock - a.stock || a.name.localeCompare(b.name);
        case 'name-asc':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [items, filters, bounds, debouncedQuery, sort]);

  const quantityFor = (item: RentalItem) => quantities[item.id] ?? 1;

  /* Clamped here rather than in the stepper, against `prev` rather than a prop,
     so a burst of clicks in one batch applies every one of them. The ceiling is
     max(stock, 1) so a sold-out item still shows a coherent 1 instead of 0. */
  const stepQuantity = (item: RentalItem, delta: number) =>
    setQuantities((prev) => {
      const current = prev[item.id] ?? 1;
      const next = Math.min(Math.max(current + delta, 1), Math.max(item.stock, 1));
      return { ...prev, [item.id]: next };
    });

  /* Capped at stock: the catalog says how many exist, and queueing more than
     that only defers the rejection to confirm time, where the backend
     re-validates availability anyway. */
  const addToCart = (item: RentalItem) =>
    setCart((prev) => ({
      ...prev,
      [item.id]: Math.min((prev[item.id] ?? 0) + quantityFor(item), item.stock),
    }));

  /* Resolved against the live catalog rather than stored as a snapshot, so a
     price or stock change on refetch flows into the cart instead of booking at
     a number the customer saw ten minutes ago. Lines whose item has since left
     the catalog drop out here. */
  const cartLines = useMemo<CartLine[]>(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ item: items.find((i) => i.id === id), quantity }))
        .filter((l): l is CartLine => Boolean(l.item) && l.quantity > 0),
    [cart, items],
  );

  const cartCount = cartPieces(cartLines);

  /* Two mounted instances, one per breakpoint, sharing this page's single filter
     object. They need distinct id namespaces because the desktop aside is hidden
     with `display:none` rather than unmounted, so both are always in the
     document — see the idPrefix note in FilterSidebar. */
  const sidebarFor = (idPrefix: string) => (
    <FilterSidebar
      idPrefix={idPrefix}
      filters={filters}
      onChange={setFilters}
      counts={counts}
      bounds={bounds}
      hasActiveFilters={hasActiveFilters}
      onClear={clearFilters}
    />
  );

  return (
    <main className="min-h-screen bg-bg">
      <RentalHero query={query} onQueryChange={setQuery}>
        <Navbar
          activePage="rentals"
          cartCount={cartCount}
          onCartClick={() => setCheckoutOpen(true)}
        />
      </RentalHero>

      <CatalogTopBar
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        onOpenFilters={() => setSheetOpen(true)}
        activeFilterCount={activeFilterCount}
      />

      {/* Extra bottom padding while the cart bar is up — it is fixed, so without
          this it sits on top of the last row of cards. */}
      <section
        className={`mx-auto w-full max-w-[1200px] px-6 pt-10 sm:px-10 ${
          cartLines.length > 0 ? 'pb-36 sm:pb-28' : 'pb-10'
        }`}
      >
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Hidden below md, where the bottom sheet is the presentation instead.
              `display:none` also takes its inputs out of the tab order, so the
              sheet's focus trap has nothing to fight with. */}
          <aside className="hidden md:sticky md:top-20 md:col-span-1 md:block md:self-start">
            <div className="rounded-2xl border border-border bg-bg-card p-5 shadow-card">
              {sidebarFor('rental-desktop')}
            </div>
          </aside>

          <div className="md:col-span-3">
            <p
              aria-live="polite"
              className="mb-5 text-[0.78rem] text-text-muted"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {loading
                ? 'Loading equipment…'
                : loadError
                  ? 'Catalog unavailable'
                  : `Showing ${visible.length} of ${items.length} items`}
            </p>

            {loading ? (
              view === 'grid' ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: SKELETON_COUNT }, (_, i) => (
                    <RentalCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {Array.from({ length: SKELETON_COUNT }, (_, i) => (
                    <RentalListRowSkeleton key={i} />
                  ))}
                </div>
              )
            ) : loadError ? (
              <CatalogError
                message={loadError}
                onRetry={() => void loadCatalog()}
                retrying={loading}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                onClear={clearFilters}
                reason={items.length === 0 ? 'catalog-empty' : 'filtered'}
              />
            ) : view === 'grid' ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((item) => (
                  <RentalCard
                    key={item.id}
                    item={item}
                    quantity={quantityFor(item)}
                    onStep={(delta) => stepQuantity(item, delta)}
                    onAdd={() => addToCart(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {visible.map((item) => (
                  <RentalListRow
                    key={item.id}
                    item={item}
                    quantity={quantityFor(item)}
                    onStep={(delta) => stepQuantity(item, delta)}
                    onAdd={() => addToCart(item)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        {sidebarFor('rental-sheet')}
      </FilterSheet>

      <CartBar
        lines={cartLines}
        onClear={() => setCart({})}
        onCheckout={() => setCheckoutOpen(true)}
      />

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        lines={cartLines}
        onBooked={() => setCart({})}
      />
    </main>
  );
}
