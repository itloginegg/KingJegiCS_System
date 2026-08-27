import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeading } from './SectionHeading';
import { AmbientCanvas } from './AmbientCanvas';
import { readSession } from '../../lib/tokenStorage';
import { fetchPackages, getFullImageUrl, type AdminPackage } from '../../api/packageAdminApi';

/** Fallback art. The catalog carries its own gallery now, but a package with no
 *  uploaded photo still has to fill the media panel rather than show a grey box. */
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=80';
const SIDE_IMAGE =
  'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=800&q=80';

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
 * The packages bento, now fed by /api/MenuPackages.
 *
 * The design puts one package forward — a 1.45fr plum card with the photograph,
 * the "Most booked" mark and the price — beside a stacked pair that step down and
 * in from it. Three equal columns said all three were the same offer; this says
 * which one people actually take, which is the job of the section.
 *
 * Only two of the three cards are catalog packages. The Custom card is not a
 * MenuPackage and never was — it points at the planning flow, so it renders
 * unconditionally and is untouched by the fetch.
 *
 * Which two: the priciest package takes the hero, matching the emphasis rule
 * PackagePage already uses (the catalog has no "featured" flag), and the next
 * one by price takes the side slot. So the section follows the catalog instead
 * of naming Wedding and Birthday in the markup.
 *
 * The nudges (34px on the stack, 36px on the Custom card) are what stop the right
 * column reading as a second list. They reset below 1020, where the columns stack
 * and an indent would just be a stray margin.
 */
export function PackagesPreview() {
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [loading, setLoading] = useState(true);

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

  const [featured, secondary] = packages;

  // With nothing to show beside it, the 1.45fr column would just be a gap, so the
  // bento collapses to the Custom card's width instead of leaving a hole.
  const solo = !loading && !featured;

  return (
    <section id="packages" className="ui-section amb-host" style={{ background: 'var(--bg-subtle)' }}>
      <AmbientCanvas />
      <div className="ui-wrap amb-over">
        <SectionHeading
          kicker="Packages"
          title="Three ways to start"
          linkLabel="See all packages"
          linkTo="/packages"
        />

        <div className={`lp-pkg-bento${solo ? ' lp-pkg-bento--solo' : ''}`}>
          {/* ── Featured ── */}
          {loading ? (
            <div className="lp-pkg-hero lp-pkg-skel" aria-hidden="true" />
          ) : featured ? (
            <article className="lp-pkg-hero dark-band">
              <div
                className="lp-pkg-hero-media"
                style={{ backgroundImage: `url(${artFor(featured, HERO_IMAGE)})` }}
                role="presentation"
              />
              <div className="lp-pkg-hero-body">
                <div>
                  <div className="lp-pkg-hero-kicker">Most booked</div>
                  <h3 className="lp-pkg-hero-name">{featured.packageName}</h3>
                  <p className="lp-pkg-hero-desc">{asSummary(featured.description)}</p>
                </div>
                <div className="lp-pkg-hero-side">
                  <span className="lp-pkg-hero-price">{fmtPeso(featured.basePrice)}</span>
                  <Link to="/packages" className="ui-btn ui-btn-band ui-btn-sm">View details</Link>
                </div>
              </div>
            </article>
          ) : null}

          {/* ── Stacked pair ── */}
          <div className="lp-pkg-stack">
            {loading ? (
              <div className="lp-pkg-side lp-pkg-skel" aria-hidden="true" />
            ) : secondary ? (
              <article className="lp-pkg-side">
                <div
                  className="lp-pkg-side-media"
                  style={{ backgroundImage: `url(${artFor(secondary, SIDE_IMAGE)})` }}
                  role="presentation"
                />
                <div className="lp-pkg-side-body">
                  <div className="lp-pkg-row2">
                    <h3 className="lp-pkg-title2">{secondary.packageName}</h3>
                    <span className="lp-pkg-price2">{fmtPeso(secondary.basePrice)}</span>
                  </div>
                  <p className="lp-pkg-desc2">{asSummary(secondary.description)}</p>
                  <Link to="/packages" className="ui-btn ui-btn-outline ui-btn-xs">View details</Link>
                </div>
              </article>
            ) : null}

            <article className="lp-pkg-custom">
              <div className="lp-pkg-row2">
                <h3 className="lp-pkg-title2">Custom Package</h3>
                {/* The one price that isn't a number takes the accent, so the column
                    doesn't read as a missing figure. */}
                <span className="lp-pkg-price2 lp-pkg-price2--custom">Custom</span>
              </div>
              <p className="lp-pkg-desc2">
                Build your dream event from the ground up — tailored to your vision, budget, and guest count.
              </p>
              <Link to="/book" state={{ presetFlow: 'plan' }} className="ui-btn ui-btn-outline ui-btn-xs">
                Start a plan
              </Link>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PackagesPreview;
