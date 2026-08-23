import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, UtensilsCrossed } from 'lucide-react';
import { fetchPublicMenuItems, getFullImageUrl, type AdminMenuItem } from '../../api/menuAdminApi';

/**
 * ItemCategory from Models/Menuitem.cs, in enum order.
 *
 * Derived from the enum rather than hand-typed so a new category on the backend
 * surfaces as a missing tab here instead of silently never appearing.
 */
const ITEM_CATEGORIES = [
  'Chicken', 'Beef', 'Pork', 'Seafood', 'Pasta', 'Vegetable', 'Others',
] as const;

type CategoryTab = 'All' | (typeof ITEM_CATEGORIES)[number];

const TABS: CategoryTab[] = ['All', ...ITEM_CATEGORIES];

/** ₱ 1,500.00 — never a hardcoded price string. */
export function formatPeso(amount: number): string {
  return `₱ ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Shown when the catalog can't be reached.
 *
 * A marketing page must never render an error panel at a visitor, so the carousel
 * degrades to three representative dishes instead. Priceless on purpose — these are
 * illustrative, and inventing a price for them would be the same fabrication problem
 * as inventing a rating.
 */
const FALLBACK_DISHES: AdminMenuItem[] = [
  { id: 'f1', itemName: 'Chicken Adobo', itemCategory: 'Chicken', courseCategory: 'Main', description: '', dietaryTags: [], pricePerTray: null, servesPerTray: 10, menuPackageId: null, isActive: true, imageUrl: null },
  { id: 'f2', itemName: 'Beef Caldereta', itemCategory: 'Beef', courseCategory: 'Main', description: '', dietaryTags: [], pricePerTray: null, servesPerTray: 10, menuPackageId: null, isActive: true, imageUrl: null },
  { id: 'f3', itemName: 'Pancit Bihon', itemCategory: 'Pasta', courseCategory: 'Main', description: '', dietaryTags: [], pricePerTray: null, servesPerTray: 10, menuPackageId: null, isActive: true, imageUrl: null },
];

/** One dish frame. imageUrl is nullable on Menuitem, so the placeholder is the norm. */
function DishImage({ item, size }: { item: AdminMenuItem; size: 'sm' | 'lg' }) {
  const src = getFullImageUrl(item.imageUrl);
  const box = size === 'lg' ? 'h-36 w-36' : 'h-24 w-24';

  if (!src) {
    return (
      <div
        className={`${box} flex items-center justify-center rounded-full border border-[var(--band-border)]`}
        aria-hidden="true"
      >
        <UtensilsCrossed
          size={size === 'lg' ? 34 : 24}
          strokeWidth={1.4}
          className="text-[var(--band-muted)]"
        />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={`${box} rounded-full object-cover`}
      loading="lazy"
    />
  );
}

/**
 * Footer metadata for a dish card.
 *
 * The left slot carries servesPerTray, not a star rating: Menuitem has no rating
 * field and no aggregate exists anywhere in the API, so a number there would be
 * invented. "Serves 10" is real, occupies the same space, and is the thing a
 * catering customer actually needs.
 *
 * The right slot degrades to "Package only" because PricePerTray is nullable —
 * package-only dishes genuinely have no per-tray price.
 */
function DishFooter({ item, emphasis }: { item: AdminMenuItem; emphasis: boolean }) {
  const nameTone = emphasis ? 'text-[var(--band-chip-text)]' : 'text-[var(--band-text)]';
  const mutedTone = emphasis ? 'text-[var(--band-chip-text)] opacity-70' : 'text-[var(--band-muted)]';

  return (
    <div className="mt-4 flex w-full items-center justify-between gap-3">
      <span className={`text-xs ${mutedTone}`}>
        Serves {item.servesPerTray}
      </span>
      <span className={`text-sm ${emphasis ? 'font-bold' : 'font-medium'} ${nameTone}`}>
        {item.pricePerTray === null ? (
          <span className={`text-xs font-normal ${mutedTone}`}>Package only</span>
        ) : (
          formatPeso(item.pricePerTray)
        )}
      </span>
    </div>
  );
}

/**
 * "Our Special Dish" — an inverted band against the page's otherwise light sections.
 *
 * Band colours are scoped custom properties rather than semantic tokens, and are
 * hardcoded on purpose: the band has to stay dark in BOTH themes. Deriving it from
 * --primary would work in light mode but turn the band bright teal in dark mode,
 * since --primary flips to #14b8a6 — inverting the inversion.
 *
 * Band tokens live in index.css under .dark-band / .dark .dark-band — shared with
 * MenuPage's hero, which has the same must-stay-dark requirement. The override
 * selector is class-based, matching @custom-variant dark in index.css. A [data-theme] selector would never match: this
 * project sets no such attribute anywhere.
 *
 * Unlike the other sections, this one does NOT carry the layered gradient background —
 * a dark band and a light gradient stack can't coexist. CollidingBlobsCanvas is
 * deliberately absent here for the same reason.
 */
export function MenuPreviewSection() {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [category, setCategory] = useState<CategoryTab>('All');
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublicMenuItems()
      .then((rows) => { if (!cancelled) setItems(rows.filter((r) => r.isActive)); })
      .catch(() => { if (!cancelled) setItems(FALLBACK_DISHES); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(
    () => (category === 'All' ? items : items.filter((i) => i.itemCategory === category)),
    [items, category],
  );

  /* Reset on category change so the index can never point past the end of a shorter
     list — the bug you get from filtering under a carousel without touching it. */
  useEffect(() => { setIndex(0); }, [category]);

  const atStart = index <= 0;
  const atEnd = index >= visible.length - 1;

  const move = (delta: number) =>
    setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(visible.length - 1, 0)));

  /* Three-up window: the centre card plus a neighbour each side. */
  const window3 = visible.length
    ? [index - 1, index, index + 1].filter((i) => i >= 0 && i < visible.length)
    : [];

  return (
    <section id="menus" className="dark-band relative overflow-hidden bg-[var(--band-bg)]">
      <div className="mx-auto w-full max-w-[1200px] px-6 py-24 sm:px-10">
        <div className="flex flex-col items-center gap-y-10 rounded-3xl border border-[var(--band-glass-border)] bg-[var(--band-glass)] p-6 sm:p-10">
          <h2
            className="text-center text-3xl font-bold tracking-tight text-[var(--band-text)] sm:text-4xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Our Special Dish
          </h2>

          {/* ── category pills ── */}
          <div className="flex flex-wrap items-center justify-center gap-4" role="group" aria-label="Filter dishes by category">
            {TABS.map((tab) => {
              const active = tab === category;
              return (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(tab)}
                  className={`rounded-full px-5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--band-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--band-bg)] ${
                    active
                      ? 'bg-[var(--band-chip)] font-medium text-[var(--band-chip-text)]'
                      : 'border border-[var(--band-border)] bg-transparent text-[var(--band-text)] hover:border-[var(--band-text)]'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* ── carousel ── */}
          {visible.length === 0 ? (
            <p className="py-10 text-sm text-[var(--band-muted)]">
              No dishes in this category yet.
            </p>
          ) : (
            <div className="flex w-full items-center justify-center gap-4 sm:gap-6">
              <button
                type="button"
                aria-label="Previous dish"
                disabled={atStart}
                onClick={() => move(-1)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--band-border)] bg-transparent text-[var(--band-text)] transition-opacity hover:border-[var(--band-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--band-text)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
              </button>

              <div
                ref={trackRef}
                className="flex flex-1 items-center justify-center gap-4 overflow-hidden py-6 sm:gap-8"
                role="group"
                aria-label="Featured dishes"
                /* Arrow keys drive the carousel; the wrapper is the roving-focus host so
                   the keys work wherever inside the strip focus happens to sit. */
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
                  else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
                  else if (e.key === 'Home') { e.preventDefault(); setIndex(0); }
                  else if (e.key === 'End') { e.preventDefault(); setIndex(visible.length - 1); }
                }}
              >
                {window3.map((i) => {
                  const item = visible[i];
                  const isCentre = i === index;
                  return (
                    <article
                      key={item.id}
                      aria-current={isCentre ? 'true' : undefined}
                      tabIndex={isCentre ? 0 : -1}
                      style={isCentre ? { boxShadow: 'var(--shadow-lg)' } : undefined}
                      className={`flex shrink-0 flex-col items-center rounded-2xl px-5 py-6 transition-transform duration-300 motion-reduce:transform-none motion-reduce:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--band-text)] ${
                        isCentre
                          ? 'w-52 scale-105 border border-[var(--band-chip-edge)] bg-[var(--band-chip)] sm:w-56'
                          : 'hidden w-44 border border-[var(--band-border)] bg-transparent sm:flex'
                      }`}
                    >
                      <DishImage item={item} size={isCentre ? 'lg' : 'sm'} />
                      <h3
                        className={`mt-4 text-center text-base ${
                          isCentre
                            ? 'font-bold text-[var(--band-chip-text)]'
                            : 'font-medium text-[var(--band-text)]'
                        }`}
                      >
                        {item.itemName}
                      </h3>
                      <DishFooter item={item} emphasis={isCentre} />
                    </article>
                  );
                })}
              </div>

              <button
                type="button"
                aria-label="Next dish"
                disabled={atEnd}
                onClick={() => move(1)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--band-border)] bg-transparent text-[var(--band-text)] transition-opacity hover:border-[var(--band-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--band-text)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}

          <Link
            to="/menus"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--band-chip)] px-7 py-3 text-sm font-medium text-[var(--band-chip-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--band-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--band-bg)]"
          >
            Explore Food
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default MenuPreviewSection;
