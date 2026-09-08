import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { SectionHeading } from './SectionHeading';
import { AmbientCanvas } from './AmbientCanvas';
import { readSession } from '../../lib/tokenStorage';
import { fetchPackages, getFullImageUrl, type AdminPackage } from '../../api/packageAdminApi';

/** Fallback art. The catalog carries its own gallery now, but a package with no
 *  uploaded photo still has to fill the media panel rather than show a grey box.
 *
 *  Root-relative, with the leading slash: 'hero/1.jpg' resolves against whatever
 *  route is current, so it would only find the file on '/' and 404 anywhere else. */
const HERO_IMAGE = '/hero/1.jpg';
const SIDE_IMAGE = '/hero/2.jpg';
/**
 * The Custom card's artwork.
 *
 * A real King Jegi photograph out of public/gallery rather than a third stock plate:
 * the card is an invitation to plan an event with this team, and the buffet line
 * they actually set up says that better than a stock table would. It is also the
 * smallest of the bundled photos at 243KB, which matters because unlike HERO_IMAGE
 * and SIDE_IMAGE — fallbacks that only load when a package has no uploaded photo —
 * this one always loads.
 *
 * Having it at all is the point: without artwork this card had no media band, so in
 * the hero seat it was a bare panel beside two cards with photographs, and in the
 * stack it was the one card whose copy started at the card edge instead of after a
 * thumbnail. One image settles both.
 */
const CUSTOM_IMAGE = '/hero/650757354_1358780446051644_7540690133881728036_n.jpg';

/** The rotary swap, as specified. Shared by the card that flies out and the one
 *  that flies in, so both halves of the exchange move on the same physics. */
const SPRING = { type: 'spring' as const, stiffness: 200, damping: 20 };
const INSTANT = { duration: 0 };

/** Whole pesos — the section shows ₱80,000, not ₱80,000.00 like the packages page. */
const fmtPeso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;

/** The package's first uploaded photo, or the stock fallback for that position. */
const artFor = (p: AdminPackage, fallback: string) =>
  getFullImageUrl(p.images[0]?.url) ?? fallback;

/**
 * Admins write descriptions as a line-per-dish list ("One beef\nOne pork\n…"),
 * which HTML would collapse into "One beef One pork One chicken" — a run-on with
 * no seam between items. Rejoining on a middot keeps it readable as a list while
 * staying the single flowing paragraph this preview card is sized for; the full
 * breakdown is on /packages.
 */
const asSummary = (description: string) =>
  description
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' · ');

/**
 * One card's content, independent of which column it is currently sitting in.
 *
 * The rotation is what forces this shape. Before it, the hero and the stack cards
 * were three different pieces of markup reading three different sources — the
 * priciest package, the next one, and a hand-written Custom card that is not a
 * MenuPackage at all. A card that can be in either column cannot be authored per
 * column, so everything a card needs is normalised here once and both renderers
 * read the same object.
 */
interface Slot {
  id: string;
  name: string;
  /** Rendered as-is: a peso figure for a package, the word Custom for the CTA. */
  priceLabel: string;
  /** The one price that isn't a number takes the accent, so the column doesn't
   *  read as a missing figure. */
  priceIsWord: boolean;
  summary: string;
  /**
   * Every card carries artwork today — the catalog ones fall back to a stock plate,
   * the Custom one to a bundled photograph. The type stays nullable and both
   * renderers keep their no-art branch, because a card without a media band is a
   * layout this section should survive rather than one it should assume away.
   */
  image: string | null;
  href: string;
  linkState?: Record<string, unknown>;
  ctaLabel: string;
  /**
   * "Most booked" — true only for the package that is actually the priciest, which
   * is the emphasis rule PackagePage already uses (the catalog has no featured
   * flag). It travels WITH the card rather than sitting on the hero slot: once
   * cards rotate, a badge pinned to the slot would claim the mark for whatever
   * happened to be promoted last.
   */
  isMostBooked: boolean;
}

/**
 * The packages bento, now fed by /api/MenuPackages — and rotary.
 *
 * One package forward in a 55% plum card with the photograph and the price, beside
 * a 45% stack of smaller cards. Clicking a stack card swaps it with the hero: the
 * clicked card flies left and grows, the old hero flies right and lands at the foot
 * of the stack, and the cards between slide up to close the gap. That is one
 * `layoutId` per card and nothing else — no enter/exit animation, because the cards
 * never appear or disappear, they only change seats.
 *
 * Only the packages come from the catalog. The Custom card is not a MenuPackage and
 * never was — it points at the planning flow, so it renders unconditionally and is
 * untouched by the fetch. It joins the rotation like any other card, which is why
 * the hero is now written against Slot rather than against AdminPackage.
 */
export function PackagesPreview() {
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * The seating order, by slot id: index 0 is the hero, the rest are the stack in
   * order. Ids rather than objects, so the fetch can replace the catalog without
   * disturbing an arrangement the visitor made.
   */
  const [order, setOrder] = useState<string[]>([]);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    const token = readSession()?.token ?? '';   // catalog GETs are anonymous
    let alive = true;

    // A failed fetch must not take the landing page down — the section falls back
    // to the Custom card on its own, the same way the gallery banner degrades.
    void fetchPackages(token)
      .then(
        (rows) => alive && setPackages([...rows].sort((a, b) => b.basePrice - a.basePrice)),
        () => alive && setPackages([]),
      )
      .finally(() => alive && setLoading(false));

    return () => { alive = false; };
  }, []);

  /** Catalog + CTA, normalised and in their opening order. */
  const slots = useMemo<Slot[]>(() => {
    const fromCatalog = packages.slice(0, 2).map((p, i) => ({
      id: p.id,
      name: p.packageName,
      priceLabel: fmtPeso(p.basePrice),
      priceIsWord: false,
      summary: asSummary(p.description),
      image: artFor(p, i === 0 ? HERO_IMAGE : SIDE_IMAGE),
      href: '/packages',
      ctaLabel: 'View details',
      /* The first of a list sorted by price descending is the priciest. */
      isMostBooked: i === 0,
    }));

    return [
      ...fromCatalog,
      {
        id: 'custom-package',
        name: 'Custom Package',
        priceLabel: 'Custom',
        priceIsWord: true,
        summary: 'Build your dream event from the ground up — tailored to your vision, budget, and guest count.',
        image: CUSTOM_IMAGE,
        href: '/book',
        linkState: { presetFlow: 'plan' },
        ctaLabel: 'Start a plan',
        isMostBooked: false,
      },
    ];
  }, [packages]);

  /**
   * Seat the cards, then keep the seating honest as the catalog changes.
   *
   * Gated on `loading` because of a trap: before the fetch resolves the only slot
   * that exists is the Custom card, so seating on the first render would put the
   * CTA in the hero seat and leave the packages arriving behind it — the priciest
   * package would never lead, which is the one thing this section is meant to say.
   * After that first seating the reconcile is additive, so a refetch cannot undo an
   * arrangement the visitor made by clicking.
   */
  useEffect(() => {
    if (loading) return;
    setOrder((prev) => {
      const ids = slots.map((s) => s.id);
      if (prev.length === 0) return ids;
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [slots, loading]);

  const seated = order
    .map((id) => slots.find((s) => s.id === id))
    .filter((s): s is Slot => Boolean(s));
  const [hero, ...stack] = seated;

  /**
   * The swap: the clicked card takes the hero seat, the old hero goes to the back
   * of the stack, and everything between closes up. One splice, so the animation
   * has a single consistent target to move every card to.
   */
  const promote = (id: string) => {
    setOrder((prev) => {
      if (prev[0] === id) return prev;              // already the hero
      const rest = prev.filter((x) => x !== id);
      const oldHero = rest.shift();
      return oldHero ? [id, ...rest, oldHero] : [id, ...rest];
    });
  };

  const transition = reducedMotion ? INSTANT : SPRING;
  // With nothing to sit beside it, the 55% column would just be a gap.
  const solo = !loading && stack.length === 0;

  return (
    <section id="packages" className="ui-section amb-host lp-photo-ground" style={{ background: 'var(--bg-subtle)' }}>
      {/* The section's ground, taken from whichever card is seated in the hero
          column. It follows the rotation: promote a card and the whole section's
          colour moves with it, because `hero` is seated[0] and nothing else feeds
          this. Only rendered once a card exists — during the fetch the section is
          its plain --bg-subtle. */}
      {hero?.image && (
        <div className="lp-pkg-ambient" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.div
              /* Keyed on the photo so a promotion mounts a new layer over the old
                 one and the two cross-fade. Default sync mode, not wait: waiting
                 would blank the ground between cards instead of blending through. */
              key={hero.image}
              className="lp-pkg-ambient-img"
              style={{ backgroundImage: `url(${hero.image})` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? INSTANT : { duration: 0.5, ease: 'easeInOut' }}
            />
          </AnimatePresence>
          <div className="lp-pkg-ambient-scrim" />
        </div>
      )}
      <AmbientCanvas />
      <div className="ui-wrap amb-over">
        <SectionHeading
          kicker="Packages"
          title="Three ways to start"
          linkLabel="See all packages"
          linkTo="/packages"
        />

        {/* One layout group across both columns. The cards that stay put still have
            to re-measure when a sibling leaves its seat — that is what makes the
            stack close up rather than snap — and a group is how Framer knows the
            hero seat and the stack are one arrangement rather than two lists that
            happen to be adjacent. */}
        <LayoutGroup>
        <div className={`lp-pkg-bento${solo ? ' lp-pkg-bento--solo' : ''}`}>
          {/* ── Hero seat ── */}
          {loading ? (
            <div className="lp-pkg-hero lp-pkg-skel" aria-hidden="true" />
          ) : hero ? (
            <motion.article
              /* The key is load-bearing, not tidiness. Without it React sees an
                 <article> in the same slot before and after a promotion, keeps the
                 same DOM node and just mutates its props — so layoutId CHANGES on a
                 live element rather than one element unmounting and another mounting.
                 A shared transition needs that pair: the id that left has a box to
                 animate from, the id that arrived has one to animate to. Mutated in
                 place there is neither, and the seat renders empty. */
              key={hero.id}
              layoutId={hero.id}
              transition={transition}
              className={`lp-pkg-hero dark-band${hero.image ? '' : ' lp-pkg-hero--noart'}`}
            >
              {hero.image && (
                <div
                  className="lp-pkg-hero-media"
                  style={{ backgroundImage: `url(${hero.image})` }}
                  role="presentation"
                />
              )}
              <div className="lp-pkg-hero-body">
                <div>
                  {hero.isMostBooked && <div className="lp-pkg-hero-kicker">Most booked</div>}
                  <h3 className="lp-pkg-hero-name">{hero.name}</h3>
                  <p className="lp-pkg-hero-desc">{hero.summary}</p>
                </div>
                <div className="lp-pkg-hero-side">
                  <span className="lp-pkg-hero-price">{hero.priceLabel}</span>
                  <Link
                    to={hero.href}
                    state={hero.linkState}
                    className="ui-btn ui-btn-band ui-btn-sm"
                  >
                    {hero.ctaLabel}
                  </Link>
                </div>
              </div>
            </motion.article>
          ) : null}

          {/* ── Stack seats ── */}
          <div className="lp-pkg-stack">
            {loading ? (
              <div className="lp-pkg-side lp-pkg-skel" aria-hidden="true" />
            ) : (
              stack.map((slot) => (
                <motion.article
                  key={slot.id}
                  layoutId={slot.id}
                  transition={transition}
                  className={`lp-pkg-side${slot.image ? '' : ' lp-pkg-side--noart'}`}
                >
                  {slot.image && (
                    <div
                      className="lp-pkg-side-media"
                      style={{ backgroundImage: `url(${slot.image})` }}
                      role="presentation"
                    />
                  )}
                  <div className="lp-pkg-side-body">
                    <div className="lp-pkg-row2">
                      <h3 className="lp-pkg-title2">{slot.name}</h3>
                      <span className={`lp-pkg-price2${slot.priceIsWord ? ' lp-pkg-price2--custom' : ''}`}>
                        {slot.priceLabel}
                      </span>
                    </div>
                    <p className="lp-pkg-desc2">{slot.summary}</p>
                    <Link
                      to={slot.href}
                      state={slot.linkState}
                      className="ui-btn ui-btn-outline ui-btn-xs lp-pkg-side-cta"
                    >
                      {slot.ctaLabel}
                    </Link>
                  </div>

                  {/* The promote control, over the card and under its link.
                      A real button rather than a click handler on the article: the
                      card already contains a link, so the two actions cannot be the
                      same element, and this way the keyboard reaches both. It is
                      last in the DOM and empty of content, so the card reads as its
                      own text plus one named button. */}
                  <button
                    type="button"
                    className="lp-pkg-promote"
                    onClick={() => promote(slot.id)}
                    aria-label={`Feature ${slot.name}`}
                  />
                </motion.article>
              ))
            )}
          </div>
        </div>
        </LayoutGroup>
      </div>
    </section>
  );
}

export default PackagesPreview;
