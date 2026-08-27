import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { Navbar } from '../components/landing/Navbar';
import { PackageCarousel } from '../components/packages/PackageCarousel';
import { AmbientCanvas } from '../components/landing/AmbientCanvas';
import { readSession } from '../lib/tokenStorage';
import { fetchPackages, type AdminPackage } from '../api/packageAdminApi';
import { fetchMenuTrays } from '../api/menuAdminApi';
import { SiteFooter } from '../components/landing/SiteFooter';


/** Backdrop placeholder for the packages section. */
const PKG_SECTION_MEDIA =
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=2000&q=80';

const fmtPHPNoDecimals = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Live catalog from /api/MenuPackages — same anonymous-GET pattern MenuPage
   already uses. Only the per-card photography remains static: the card art
   backs the details modal, and is drawn from this pool rather than invented
   per package.
───────────────────────────────────────────────────────────────────────── */



/** Card art pool, assigned round-robin — the catalog has no per-package photo. */
const PKG_CARD_IMAGES = [
  'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80',
];

type Pkg = {
  id: string;
  name: string;
  price: string;
  unit: string;
  highlight: boolean;
  image: string;
  description: string;
  features: string[];
  details: string[];
  isCustom?: boolean;
};

/**
 * Maps a real MenuPackage onto the card shape this page already renders.
 *
 * `features` are the package's own inclusions. `details` are derived from actual
 * catalog data — pax range, extra-guest pricing, fixed dishes, and the choose-N
 * slots — rather than restating marketing copy the backend doesn't hold.
 * `highlight` marks the priciest package, since the design uses it for emphasis
 * and the catalog has no "featured" flag.
 */
const toCard = (p: AdminPackage, index: number, isTopPriced: boolean): Pkg => {
  const details: string[] = [`Serves ${p.minPax}–${p.maxPax} guests`];
  if (p.pricePerExtraPax > 0) details.push(`${fmtPHP(p.pricePerExtraPax)} per guest beyond ${p.minPax}`);
  if (p.fixedItems.length > 0) details.push(`Always included: ${p.fixedItems.map((f) => f.itemName).join(', ')}`);
  for (const slot of p.slots) {
    details.push(`Choose ${slot.chooseCount} — ${slot.label}`);
  }

  return {
    id: p.id,
    name: p.packageName,
    price: fmtPHPNoDecimals(p.basePrice),
    unit: `Serves ${p.minPax}–${p.maxPax} guests`,
    highlight: isTopPriced,
    image: PKG_CARD_IMAGES[index % PKG_CARD_IMAGES.length],
    description: p.description,
    features: p.inclusions,
    details,
  };
};
/* The static PACKAGES array that used to live here is gone — cards now come from
   fetchPackages() in the component below. */

/**
 * Party trays are fetched live rather than hardcoded, because "Select Party Tray"
 * hands the tray's id to MenuPage to drop into its cart — and MenuPage's cart is
 * keyed by the real MenuTray GUID. The old static ids (1, 2, 3) would have matched
 * nothing there, so the button could never actually add anything.
 */
type PartyTray = {
  id: string;
  name: string;
  price: number;
  dishes: string[];
};

/* The static PARTY_TRAYS array that used to live here is gone — trays are fetched
   in the component below so their ids are real MenuTray GUIDs. */

/* The auto-playing center-focus slider that lived here is gone. Both rails on
   this page now run components/packages/PackageCarousel, so the trays step with
   the same Next/Previous buttons the packages use instead of drifting on their
   own animation frame. */
/* ─────────────────────────────────────────────────────────────────────────
   Slider cards
───────────────────────────────────────────────────────────────────────── */

/* The inline PackageCard that lived here is gone. components/packages/PackageCard
   implements artboard 5a's one-active-card model — spotlight fill, inclusions in
   the rail, and the two footer actions — and is what PackageCarousel renders. */

function TrayCard({ tray, tabbable, onSelect }: {
  tray: PartyTray;
  tabbable: boolean;
  onSelect: (tray: PartyTray) => void;
}) {
  return (
    <div className="pkg-card">
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        {tray.name}
      </h3>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 600, color: 'var(--primary)', lineHeight: 1 }}>
          {fmtPHP(tray.price)}
        </span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          / tray
        </span>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem', flex: 1, marginBottom: '1.5rem' }}>
        {tray.dishes.map((dish, i) => (
          <div key={i} className="feature-row">
            <span className="feature-bullet" aria-hidden="true"><Check size={15} strokeWidth={2.25} /></span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 300, lineHeight: 1.55 }}>
              {dish}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <button className="btn-ghost" tabIndex={tabbable ? 0 : -1} onClick={() => onSelect(tray)}>
          Select Party Tray →
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */



export function PackagePage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Pkg | null>(null);

  /* live party trays — ids must be real so MenuPage can add them to its cart */
  const [trays, setTrays] = useState<PartyTray[]>([]);

  useEffect(() => {
    const token = readSession()?.token ?? '';   // catalog GETs are anonymous
    let cancelled = false;
    fetchMenuTrays(token)
      .then((rows) => {
        if (cancelled) return;
        setTrays(
          rows
            .filter((t) => t.isActive)
            .map((t) => ({
              id: t.id,
              name: t.trayName,
              price: t.pricePerTray,
              dishes: t.dishes.map((d) => d.itemName),
            })),
        );
      })
      .catch(() => { /* the section simply stays empty */ });
    return () => { cancelled = true; };
  }, []);

  /**
   * Hand the tray off to MenuPage, which owns the cart (local state, not a context),
   * so it can add the item itself and land the customer on the trays view.
   */
  const selectTray = (tray: PartyTray) => {
    navigate('/menus', { state: { addTrayId: tray.id, scrollTo: 'trays' } });
  };

  /* live catalog */
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [packagesError, setPackagesError] = useState<string | null>(null);

  const loadPackages = async () => {
    setLoadingPackages(true);
    setPackagesError(null);
    const token = readSession()?.token ?? '';   // catalog GETs are anonymous
    try {
      const rows = await fetchPackages(token);
      const topPrice = rows.reduce((max, p) => Math.max(max, p.basePrice), 0);
      const topIndex = rows.findIndex((p) => p.basePrice === topPrice);
      const mapped = rows.map((p, i) => toCard(p, i, i === topIndex && rows.length > 1));
      mapped.push({
        id: 'custom-package',
        name: 'Custom Package',
        price: 'Custom',
        unit: 'Any guest count',
        highlight: false,
        image: '',
        description: 'Build your dream event from the ground up — tailored to your vision, budget, and guest count.',
        features: [],
        details: ['Any guest count'],
        isCustom: true,
      });
      setPackages(mapped);
    } catch {
      setPackagesError('Unable to load our packages. Please try again.');
    } finally {
      setLoadingPackages(false);
    }
  };

  useEffect(() => { void loadPackages(); }, []);

  const handlePackageAction = (pkg: Pkg) => {
    if (pkg.isCustom) {
      navigate('/book', { state: { presetFlow: 'plan' } });
    } else {
      setSelected(pkg);
    }
  };

  /* lock scroll when modal open */
  useEffect(() => {
    if (selected) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [selected]);

  const sectionPad: React.CSSProperties = { padding: '6rem 0', position: 'relative' };

  return (
    <>
      <style>{`
        /* ── blobs ── */
        .blob {
          position: absolute; border-radius: 50%;
          filter: blur(80px); opacity: 0.18; pointer-events: none;
          animation: blobDrift 18s ease-in-out infinite alternate;
        }
        .blob-primary      { background: var(--primary); }
        .blob-accent       { background: var(--accent); }
        .blob-primary-soft { background: var(--primary); opacity: 0.10; }
        .blob-accent-soft  { background: var(--accent);  opacity: 0.10; }
        @keyframes blobDrift {
          0%   { transform: translate(0px, 0px) scale(1); }
          50%  { transform: translate(30px, -20px) scale(1.08); }
          100% { transform: translate(-20px, 15px) scale(0.95); }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.7s ease both; }

        /* ── package cards ── */
        .pkg-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          padding: 2.25rem 2rem;
          transition: box-shadow 0.3s, border-color 0.3s;
          display: flex; flex-direction: column;
          position: relative;
        }
        .pkg-card:hover {
          box-shadow: var(--shadow-lg);
          border-color: var(--border-accent);
        }
        .pkg-card.featured {
          border-color: var(--border-accent);
          box-shadow: var(--shadow-gold);
          background: linear-gradient(180deg, var(--accent-muted) 0%, var(--surface) 35%);
        }
        .pkg-price {
          font-family: var(--font-numeric); font-variant-numeric: tabular-nums;
          font-size: 1.875rem; font-weight: 500; line-height: 1;
          letter-spacing: -0.02em; color: var(--text-primary);
        }
        .pkg-unit { font-family: var(--font-body); font-size: 0.75rem; color: var(--text-muted); }
        .pkg-name {
          font-family: var(--font-display); font-size: 1.4375rem; font-weight: 600;
          line-height: 1.15; letter-spacing: -0.025em; color: var(--text-primary);
          margin: 0 0 0.5rem;
        }
        .pkg-actions { display: flex; flex-direction: column; gap: 0.6rem; }

        /* ── center-focus slider rows (base utilities live in index.css) ──
           Fixed item width keeps the track width stable, which the
           seamless -50% wrap depends on. The slider scales cards from
           their centers, so vertical padding gives the 1.15× peak room
           to breathe without clipping. */
        .slider-item { width: 380px; }
        .slider-item .pkg-card { flex: 1; }
        @media (max-width: 640px) {
          .slider-item { width: 300px; }
        }
        .pkg-slider { padding: 4rem 0; }

        /* ── feature rows ──
           The bullet is a Lucide check on currentColor rather than a "✓" glyph in a
           bordered disc: the glyph rendered as a platform emoji on some Android
           builds, which put a green tick inside a plum circle. */
        .feature-row { display: flex; align-items: flex-start; gap: 0.7rem; margin-bottom: 0.8rem; }
        .feature-bullet {
          width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px;
          display: flex; align-items: center; justify-content: center;
          color: var(--accent);
        }
        .feature-text { font-family: var(--font-body); font-size: 0.875rem; line-height: 1.55; color: var(--text-secondary); }

        /* ── buttons ── */
        /* The rose, not the plum: --accent is "the button you press" in this
           direction and --primary is structure. Sentence case at 14/600 — the old
           10px uppercase on .22em tracking set "Book this package" wider than the
           card it sat in. */
        .btn-primary {
          background: var(--accent); color: var(--accent-text); border: none;
          padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.875rem;
          font-weight: 600; letter-spacing: 0.01em; text-transform: none;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.25s, transform 0.2s, box-shadow 0.2s;
          text-decoration: none; display: inline-block; text-align: center;
        }
        .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: var(--shadow-gold); }
        .btn-outline {
          background: transparent; color: var(--primary);
          border: 1px solid var(--border-accent);
          padding: 0.9rem 1.25rem; font-family: var(--font-body); font-size: 0.68rem;
          font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.25s, border-color 0.25s, transform 0.2s;
          text-decoration: none; display: inline-block; text-align: center;
        }
        .btn-outline:hover { background: var(--primary-muted); border-color: var(--primary); transform: translateY(-2px); }
        .btn-ghost {
          background: transparent; color: var(--text-primary);
          border: 1px solid var(--border-strong);
          padding: 0.8rem 1rem; font-family: var(--font-body); font-size: 0.8125rem;
          font-weight: 600; letter-spacing: 0.01em; text-transform: none;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.2s, color 0.2s, border-color 0.2s;
          text-align: center; width: 100%;
        }
        .btn-ghost:hover { background: var(--bg-subtle); color: var(--primary); border-color: var(--border-accent); }

        /* ── modal ── */
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }

        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(27, 16, 36, 0.32);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          z-index: 300;
          display: flex; align-items: center; justify-content: center;
          padding: 1.5rem;
          animation: overlayIn 0.25s ease both;
        }
        .modal-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--r-xl); max-width: 600px; width: 100%;
          max-height: 90vh; overflow: hidden;
          box-shadow: var(--shadow-lg);
          animation: modalIn 0.35s ease both;
          display: flex; flex-direction: column;
        }
        /* Bottom sheet below the nav breakpoint: a centred 600px dialog inside
           375px is a full-screen card with a hairline of scrim around it, and
           the thumb is at the bottom of the screen, not the middle. */
        @media (max-width: 640px) {
          .modal-overlay { align-items: flex-end; padding: 0; }
          .modal-card { border-radius: 24px 24px 0 0; max-height: 92vh; animation: sheetIn 0.3s ease both; }
          @keyframes sheetIn { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }
          position: relative;
        }
        .modal-close {
          position: absolute; top: 1rem; right: 1rem;
          width: 36px; height: 36px; border-radius: 50%;
          background: var(--surface-glass); border: 1px solid var(--border);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-primary); font-size: 1rem;
          transition: background 0.2s, transform 0.2s; z-index: 2;
        }
        .modal-close:hover { background: var(--surface); transform: scale(1.05); }

        .modal-body-scroll { overflow-y: auto; padding: 2rem; }
        .modal-body-scroll::-webkit-scrollbar { width: 6px; }
        .modal-body-scroll::-webkit-scrollbar-track { background: transparent; }
        .modal-body-scroll::-webkit-scrollbar-thumb {
          background: var(--border-accent); border-radius: var(--r-full);
        }
      `}</style>

      <Navbar activePage="packages" />

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>

        {/* ═══════════════════════════════════════════════════════════════
            HERO — copy block + packages carousel, one section
        ══════════════════════════════════════════════════════════════════ */}
        <section
          style={{
            ...sectionPad,
            paddingTop: 'calc(6rem + 80px)',
            paddingBottom: '4rem',
            overflow: 'hidden',
            /* The solid fill moved into the overlay below so the backdrop can show
               through. Kept as the element's own colour too, so a failed image
               load degrades to the page ground rather than to nothing. */
            background: 'var(--bg)',
          }}
        >
          {/* Background placeholder. Swap the div for a <video muted playsInline
              loop autoPlay> when a real clip exists — the overlay is unchanged. */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
            <div
              style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url(${PKG_SECTION_MEDIA})`,
                backgroundSize: 'cover', backgroundPosition: 'center',
              }}
            />
            {/* The former solid --bg, now semi-transparent so the image reads
                through it. Derived from the token rather than a black scrim: this
                ground is near-white in light mode, and black would grey it out.
                Dense enough that --text-primary still clears AA over a photo. */}
            <div
              style={{
                position: 'absolute', inset: 0,
                background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
              }}
            />
            {/* Same ambience as the hero, over the overlay so it is not muted by
                it — ties the two sections together rather than treating the
                packages rail as a separate surface. */}
            <AmbientCanvas />
          </div>
          <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
          <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />

          {/* ── centered copy block ── */}
          <div
            className="fade-up"
            style={{ maxWidth: 800, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative', zIndex: 1, marginBottom: '4rem' }}
          >
            <div className="inline-block border border-border-accent bg-accent-muted text-accent rounded-full px-4 py-1.5 text-[0.65rem] font-bold tracking-widest uppercase mb-6">
              What we offer
            </div>
            <h2 className="text-text-primary text-3xl md:text-4xl lg:text-[2.5rem] font-display font-medium leading-[1.2] max-w-[700px] mx-auto tracking-tight">
              Offering packages tailored to your event size, style, and vision. Pick the one that fits — we'll handle the rest.
            </h2>
          </div>


          {/* ── packages slider: full-bleed, drifts left → right ── */}
          {loadingPackages ? (
            <p style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.9rem', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
              Loading our packages…
            </p>
          ) : packagesError ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem', color: 'var(--danger)', marginBottom: '1rem' }}>
                {packagesError}
              </p>
              <button type="button" className="btn-outline" onClick={() => void loadPackages()}>Try Again</button>
            </div>
          ) : packages.length === 0 ? (
            <p style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.9rem', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
              No packages are published yet — please check back soon.
            </p>
          ) : (
            <div style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
              <PackageCarousel
                packages={packages.map((p) => ({ ...p, paxLabel: p.details[0] ?? p.unit }))}
                onAction={handlePackageAction}
                /* Open on the featured package rather than whatever sorts first,
                   so the spotlight card is the one the design leads with. */
                initialIndex={Math.max(packages.findIndex((p) => p.highlight), 0)}
              />
            </div>
          )}
        </section>

        {/* ═══════════════════════ PARTY TRAY SETS ═══════════════════════ */}
        <section style={{ ...sectionPad, paddingTop: '4rem', paddingBottom: '4rem', background: 'var(--bg)', overflow: 'hidden' }}>
          <div className="blob blob-accent" style={{ width: 420, height: 420, top: '-80px', right: '-100px', animationDelay: '3s' }} />
          <div className="blob blob-primary" style={{ width: 360, height: 360, bottom: '-60px', left: '5%', animationDelay: '10s' }} />

          <div
            className="fade-up"
            style={{
              maxWidth: 800, margin: '0 auto', padding: '0 2.5rem',
              textAlign: 'center', position: 'relative', marginBottom: '1rem',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2.2rem, 4.5vw, 3.5rem)',
                fontWeight: 400, lineHeight: 1.08,
                color: 'var(--text-primary)',
                marginBottom: '1.25rem',
              }}
            >
              Party Tray{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Sets</em>
            </h2>

            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '1rem',
                color: 'var(--text-muted)', lineHeight: 1.75,
                maxWidth: 500, margin: '0 auto', fontWeight: 300,
              }}
            >
              Add a tray set to any package — or order standalone for intimate gatherings
              and casual celebrations.
            </p>
          </div>

          {/* ── trays slider: full-bleed, drifts right → left ── */}
          {trays.length === 0 ? (
            <p style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.9rem', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
              Loading our party trays…
            </p>
          ) : (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
              {/* The same carousel the packages use, so both rails on this page
                  step, wrap and centre identically. The trays previously ran a
                  separate auto-playing slider with drag — two rails, two
                  behaviours. */}
              <PackageCarousel
                label="Party tray sets"
                packages={trays.map((t) => ({
                  id: t.id,
                  name: t.name,
                  price: fmtPHP(t.price),
                  paxLabel: 'per tray',
                  features: t.dishes,
                }))}
                onAction={(row) => {
                  const tray = trays.find((t) => t.id === row.id);
                  if (tray) selectTray(tray);
                }}
                renderItem={(row, isActive) => {
                  const tray = trays.find((t) => t.id === row.id);
                  return tray ? (
                    <TrayCard tray={tray} tabbable={isActive} onSelect={selectTray} />
                  ) : null;
                }}
              />
            </div>
          )}
        </section>
                    <SiteFooter />
      </main>

      {/* ═══════════════════════ DETAILS MODAL ═══════════════════════ */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close details">
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>

            <div
              style={{
                height: 200, flexShrink: 0,
                backgroundImage: `linear-gradient(180deg, rgba(26,19,14,0.05) 0%, rgba(26,19,14,0.55) 100%), url('${selected.image}')`,
                backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative',
              }}
            >
              <div style={{ position: 'absolute', bottom: '1.5rem', left: '2rem', right: '2rem' }}>
                {selected.highlight && (
                  <div
                    style={{
                      display: 'inline-block', background: 'var(--accent)',
                      padding: '0.2rem 0.7rem', fontFamily: 'var(--font-body)', fontSize: '0.52rem',
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                      color: 'var(--bg)', fontWeight: 600, marginBottom: '0.5rem',
                      borderRadius: 'var(--r-full)',
                    }}
                  >
                    Most Popular
                  </div>
                )}
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 500, color: '#fff', marginBottom: '0.25rem', lineHeight: 1.1 }}>
                  {selected.name}
                </h2>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--accent)' }}>
                    {selected.price}
                  </span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'rgba(255,255,255,0.75)', letterSpacing: '0.12em' }}>
                    {selected.unit}
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-body-scroll">
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.75, fontWeight: 300, marginBottom: '1.75rem' }}>
                {selected.description}
              </p>

              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 500, marginBottom: '1rem' }}>
                What's Included
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem 1rem', marginBottom: '1.75rem' }}>
                {selected.details.map((item, i) => (
                  <div key={i} className="feature-row" style={{ marginBottom: 0 }}>
                    <span className="feature-bullet" aria-hidden="true"><Check size={15} strokeWidth={2.25} /></span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 300, lineHeight: 1.5 }}>
                      {item}
                    </span>
                  </div>
                ))}
              </div>

              {/* The card shows only the first few inclusions and counts the rest,
                  so this is where the full list has to live for that count to mean
                  anything. */}
              {selected.features.length > 0 && (
                <>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 500, marginBottom: '1rem' }}>
                    Inclusions
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem 1rem', marginBottom: '1.75rem' }}>
                    {selected.features.map((item, i) => (
                      <div key={i} className="feature-row" style={{ marginBottom: 0 }}>
                        <span className="feature-bullet" aria-hidden="true"><Check size={15} strokeWidth={2.25} /></span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 300, lineHeight: 1.5 }}>
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
                <button onClick={() => setSelected(null)} className="btn-outline" style={{ flex: '0 0 auto', paddingTop: '1rem', paddingBottom: '1rem' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



    </>
  );
}
