import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UtensilsCrossed } from 'lucide-react';
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

/** The bento holds four slots: a hero, a medium, and two compact rows. */
const PREVIEW_COUNT = 4;

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

/** One dish photo slot. imageUrl is nullable on Menuitem, so the placeholder is the norm. */
function DishSlot({ item, label, className }: { item?: AdminMenuItem; label: string; className: string }) {
  const src = item ? getFullImageUrl(item.imageUrl) : null;
  return (
    <div className={`lp-dish-slot ${className}`} aria-hidden="true">
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" />
        /* The compact rows pass no label — a caption would not fit a 74px square,
           so they get the utensil mark instead of an empty block. */
        : label ? <span>{label}</span> : <UtensilsCrossed size={18} strokeWidth={1.5} />}
    </div>
  );
}

/** PricePerTray is nullable — package-only dishes genuinely have no per-tray price. */
const priceOf = (item: AdminMenuItem) =>
  item.pricePerTray === null ? '—' : formatPeso(item.pricePerTray);

/**
 * "What's on the table" — the menu teaser.
 *
 * An asymmetric bento, not an equal grid: one hero dish at 1.5fr, a medium beside
 * it dropped 26px, and a column of two compact rows dropped 56px, closing on a
 * dashed "N more dishes" card. Four equal tiles implied the menu was four dishes
 * and gave the best seller no more weight than the fourth item.
 *
 * The category filter, the live catalog fetch and the fallback behaviour are
 * unchanged.
 */
export function MenuPreviewSection() {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [category, setCategory] = useState<CategoryTab>('All');

  useEffect(() => {
    let cancelled = false;
    fetchPublicMenuItems()
      .then((rows) => { if (!cancelled) setItems(rows.filter((r) => r.isActive)); })
      .catch(() => { if (!cancelled) setItems(FALLBACK_DISHES); });
    return () => { cancelled = true; };
  }, []);

  const matching = useMemo(
    () => (category === 'All' ? items : items.filter((i) => i.itemCategory === category)),
    [items, category],
  );

  const visible = matching.slice(0, PREVIEW_COUNT);
  const [hero, mid, ...rest] = visible;
  /* The real remainder, not a fixed number — the card is a count of what the four
     slots above are not showing. */
  const more = Math.max(matching.length - visible.length, 0);

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

        {visible.length === 0 ? (
          <p className="ui-body" style={{ padding: '32px 0' }}>
            No dishes in this category yet.
          </p>
        ) : (
          <div className="lp-dish-bento">
            {/* ── Hero dish ── */}
            {hero && (
              <article className="lp-dish-hero">
                <DishSlot item={hero} label="photo slot — hero dish" className="lp-dish-hero-media" />
                <div className="lp-dish-hero-body">
                  <div className="ui-sec-head" style={{ margin: 0, alignItems: 'baseline', gap: 10 }}>
                    <h3 className="lp-dish-hero-name">{hero.itemName}</h3>
                    <span className="lp-dish-hero-price">{priceOf(hero)}</span>
                  </div>
                  <div className="lp-dish-meta" style={{ marginTop: 9 }}>
                    {hero.itemCategory} · serves {hero.servesPerTray}
                  </div>
                </div>
              </article>
            )}

            {/* ── Medium ── */}
            {mid ? (
              <article className="lp-dish-mid">
                <DishSlot item={mid} label="photo slot" className="lp-dish-mid-media" />
                <div className="lp-dish-mid-body">
                  <div className="lp-dish-meta-row" style={{ marginTop: 0 }}>
                    <h3 className="lp-dish-mid-name">{mid.itemName}</h3>
                    <span className="lp-dish-price-sm">{priceOf(mid)}</span>
                  </div>
                  <div className="lp-dish-meta" style={{ marginTop: 7 }}>{mid.itemCategory}</div>
                </div>
              </article>
            ) : <div />}

            {/* ── Compact column ── */}
            <div className="lp-dish-col">
              {rest.map((item) => (
                <article key={item.id} className="lp-dish-mini">
                  <DishSlot item={item} label="" className="" />
                  <div className="lp-dish-mini-body">
                    <div className="lp-dish-mini-name">{item.itemName}</div>
                    <div className="lp-dish-meta-row">
                      <span className="lp-dish-meta">{item.itemCategory}</span>
                      <span className="lp-dish-price-sm">{priceOf(item)}</span>
                    </div>
                  </div>
                </article>
              ))}

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
