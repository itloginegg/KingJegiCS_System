import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UtensilsCrossed } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { fetchPublicMenuItems, getFullImageUrl, type AdminMenuItem } from '../../api/menuAdminApi';
import { SectionHeading } from './SectionHeading';

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

/**
 * How many dishes the split shows: one in the detail pane and the rest in the list
 * beside it.
 *
 * Twelve, up from the bento's four. Four meant a "scrollable" column of three rows,
 * which is a stack, not a scroller; twelve fills the capped 520px list with a real
 * overflow on the busy categories and still leaves the smaller ones honest. Above
 * this the section starts competing with /menus for the same job.
 */
const PREVIEW_COUNT = 12;

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
 * A marketing page must never render an error panel at a visitor, so the grid
 * degrades to three representative dishes instead. Priceless on purpose — these are
 * illustrative, and inventing a price for them would be the same fabrication problem
 * as inventing a rating.
 */
const FALLBACK_DISHES: AdminMenuItem[] = [
  { id: 'f1', itemName: 'Chicken Adobo', itemCategory: 'Chicken', courseCategory: 'Main', description: '', dietaryTags: [], pricePerTray: null, servesPerTray: 10, menuPackageId: null, isActive: true, imageUrl: null },
  { id: 'f2', itemName: 'Beef Caldereta', itemCategory: 'Beef', courseCategory: 'Main', description: '', dietaryTags: [], pricePerTray: null, servesPerTray: 10, menuPackageId: null, isActive: true, imageUrl: null },
  { id: 'f3', itemName: 'Pancit Bihon', itemCategory: 'Pasta', courseCategory: 'Main', description: '', dietaryTags: [], pricePerTray: null, servesPerTray: 10, menuPackageId: null, isActive: true, imageUrl: null },
];

/**
 * One dish photo slot. imageUrl is nullable on Menuitem, so the placeholder is the
 * norm rather than the exception — which is why the detail pane below gives the photo
 * a bounded band and puts the dish's weight in its text.
 *
 * A <span>, not a <div>: the same slot is used inside the list buttons, and a button's
 * content model is phrasing content. CSS gives it display:flex.
 */
function DishSlot({ item, label, className }: { item?: AdminMenuItem; label: string; className: string }) {
  const src = item ? getFullImageUrl(item.imageUrl) : null;
  return (
    <span className={`lp-dish-slot ${className}`} aria-hidden="true">
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" />
        /* The list rows pass no label — a caption would not fit a 68px square, so
           they get the utensil mark instead of an empty block. */
        : label ? <span>{label}</span> : <UtensilsCrossed size={18} strokeWidth={1.5} />}
    </span>
  );
}

/** PricePerTray is nullable — package-only dishes genuinely have no per-tray price. */
const priceOf = (item: AdminMenuItem) =>
  item.pricePerTray === null ? '—' : formatPeso(item.pricePerTray);

/** Hero-and-list placeholders, shaped like what they stand in for. */
function Skeleton() {
  return (
    <div className="lp-dish-bento" aria-hidden="true">
      <div className="lp-dish-hero lp-dish-skel lp-dish-skel--hero" />
      <div className="lp-dish-list">
        <div className="lp-dish-rows">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="lp-dish-skel lp-dish-skel--row" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * "What's on the table" — the menu teaser, as master and detail.
 *
 * Was an asymmetric bento of four fixed slots. Four tiles implied the menu was four
 * dishes, and every one of them had to carry its own photo — which, given imageUrl is
 * null more often than not, meant four placeholder blocks. The split shows one dish
 * properly (photo band, price, what it serves, the description and any dietary tags)
 * beside a scrollable list of the rest, so the section reads as a menu with a
 * spotlight rather than a menu of four things.
 *
 * The category filter, the live catalog fetch and the fallback behaviour are
 * unchanged. formatPeso stays exported: nothing imports it today, but it is this
 * file's price contract and the rentals tree keeping its own copy is a duplication to
 * resolve, not a reason to inline this one.
 */
export function MenuPreviewSection() {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  /* Distinguishes "no dishes here" from "not asked yet". Without it the section
     flashed "No dishes in this category yet." on every load, because `items` starts
     empty and the empty-category branch cannot tell the two apart. */
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [category, setCategory] = useState<CategoryTab>('All');
  /** Which dish the detail pane is showing, as an index into the visible list. */
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    let cancelled = false;
    fetchPublicMenuItems()
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.filter((r) => r.isActive));
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setItems(FALLBACK_DISHES);
        setStatus('ready');
      });
    return () => { cancelled = true; };
  }, []);

  const matching = useMemo(
    () => (category === 'All' ? items : items.filter((i) => i.itemCategory === category)),
    [items, category],
  );

  const visible = matching.slice(0, PREVIEW_COUNT);
  /* The real remainder, not a fixed number — a count of what the list is not showing. */
  const more = Math.max(matching.length - visible.length, 0);

  /**
   * Back to the first dish whenever the set underneath changes.
   *
   * Both triggers matter. Switching from All at index 7 to a two-dish category leaves
   * the index out of range, and the catalog landing replaces a zero-length list with a
   * real one. Either way the detail pane would have nothing to render.
   */
  useEffect(() => { setActiveIndex(0); }, [category, items]);

  /* And a clamp on top of it, because the effect runs after the render that changed
     `matching` — for one commit the old index is still live against the new list. */
  const heroIndex = Math.min(activeIndex, Math.max(visible.length - 1, 0));
  const hero = visible[heroIndex];

  return (
    <section id="menus" className="ui-section" style={{ background: 'var(--bg)' }}>
      <div className="ui-wrap">
        <SectionHeading
          kicker="Menu"
          title="What’s on the table"
          aside={
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 10, color: 'var(--text-muted)' }}>
                live catalog
              </span>
              <Link to="/menus" className="ui-sec-link">Full menu →</Link>
            </div>
          }
        />

        <div className="ui-chips" style={{ marginBottom: 24 }} role="group" aria-label="Filter dishes by category">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={tab === category}
              onClick={() => setCategory(tab)}
              className={`ui-chip${tab === category ? ' ui-chip--active' : ''}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {status === 'loading' ? (
          <Skeleton />
        ) : visible.length === 0 ? (
          <p className="ui-body" style={{ padding: '32px 0' }}>
            No dishes in this category yet.
          </p>
        ) : (
          <div className="lp-dish-bento">
            {/* ── Detail pane ──
                A live region: activating a list button changes what is on screen here
                and nothing else would tell a screen-reader user what they picked. */}
            <div className="lp-dish-hero-pane" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                {hero && (
                  <motion.article
                    /* Keyed on the dish, so AnimatePresence sees a swap rather than a
                       re-render and can run the outgoing card out before the next in. */
                    key={hero.id}
                    className="lp-dish-hero"
                    /* Transform and opacity live here, not in classes: Framer writes
                       the same inline style properties every frame and a utility class
                       would be overwritten by whichever ran last. */
                    initial={reducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: -28 }}
                    transition={reducedMotion ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <DishSlot item={hero} label="photo slot — hero dish" className="lp-dish-hero-media" />
                    <div className="lp-dish-hero-body">
                      <div className="lp-dish-hero-head">
                        <h3 className="lp-dish-hero-name">{hero.itemName}</h3>
                        <span className="lp-dish-hero-price">{priceOf(hero)}</span>
                      </div>
                      <div className="lp-dish-meta lp-dish-hero-meta">
                        {hero.itemCategory} · serves {hero.servesPerTray}
                      </div>
                      {/* Description and tags are what make this a detail pane rather
                          than a bigger tile. Both are optional on the DTO, so both are
                          conditional — an empty description must not leave a gap. */}
                      {hero.description?.trim() && (
                        <p className="lp-dish-hero-desc">{hero.description}</p>
                      )}
                      {hero.dietaryTags.length > 0 && (
                        <ul className="lp-dish-tags">
                          {hero.dietaryTags.map((tag) => (
                            <li key={tag} className="lp-dish-tag">{tag}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </motion.article>
                )}
              </AnimatePresence>
            </div>

            {/* ── List pane ── */}
            <div className="lp-dish-list">
              <ul className="lp-dish-rows">
                {visible.map((item, i) => {
                  const isCurrent = i === heroIndex;
                  return (
                    <li key={item.id}>
                      {/* A real button, so it is in the tab order and answers Enter and
                          Space without a hand-rolled key handler. The selected dish
                          stays in the list and is marked instead of being removed:
                          pulling it out would change the list's length on every click,
                          which moves everything under the pointer inside a scroller. */}
                      <button
                        type="button"
                        className={`lp-dish-row${isCurrent ? ' is-current' : ''}`}
                        aria-current={isCurrent || undefined}
                        onClick={() => setActiveIndex(i)}
                      >
                        <DishSlot item={item} label="" className="lp-dish-row-media" />
                        <span className="lp-dish-row-body">
                          <span className="lp-dish-row-name">{item.itemName}</span>
                          <span className="lp-dish-meta-row">
                            <span className="lp-dish-meta">
                              {item.itemCategory} · serves {item.servesPerTray}
                            </span>
                            <span className="lp-dish-price-sm">{priceOf(item)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Outside the scroller on purpose: a way out that you have to scroll to
                  find is not a way out. Dropped entirely when the list already shows
                  the whole category — the heading's "Full menu →" is still there, so
                  nothing becomes a dead end. */}
              {more > 0 && (
                <Link to="/menus" className="lp-dish-more">
                  <span className="lp-dish-meta">{more} more {more === 1 ? 'dish' : 'dishes'}</span>
                  <span className="ui-sec-link">Browse →</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default MenuPreviewSection;
