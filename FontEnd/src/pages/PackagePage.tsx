import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/landing/Navbar';
import { readSession } from '../lib/tokenStorage';
import { fetchPackages, type AdminPackage } from '../api/packageAdminApi';
import { fetchMenuTrays } from '../api/menuAdminApi';
import {
  fetchGallery,
  getFullImageUrl as getGalleryImageUrl,
  type GalleryImage,
} from '../api/galleryApi';

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Live catalog from /api/MenuPackages — same anonymous-GET pattern MenuPage
   already uses. Only the hero slideshow and the per-card photography remain
   static: MenuPackage carries no image field, so the card art is drawn from
   this pool rather than invented per package.
───────────────────────────────────────────────────────────────────────── */

const PKG_HERO_SLIDES = [
  'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=2000&q=80',
];

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
    price: fmtPHP(p.basePrice),
    unit: `for ${p.minPax} pax`,
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

/* ─────────────────────────────────────────────────────────────────────────
   Center-focus slider — Framer Motion

   The track holds two identical halves; a single MotionValue `x` drives
   its translateX. An animation-frame loop advances `x` for auto-play and
   wraps it at exactly half the track width, so the loop is seamless in
   both directions. The same `x` is bound to Motion's drag, so swiping
   moves the row directly and the wrap keeps it infinite. Every card
   derives its scale from its live on-screen distance to the viewport
   center, so scaling reacts instantly to auto-play and drag alike.
───────────────────────────────────────────────────────────────────────── */

/* Each half repeats the item set this many times. With 3 items per set the
   half is wider than any common viewport, which the seamless wrap needs. */
const SLIDER_REPEAT = 3;

const SCALE_MAX = 1.15; // card exactly at viewport center
const SCALE_MIN = 0.85; // card at (or beyond) the viewport edge

type NumRef = { current: number };

function CenterScaleItem({
  x,
  originLeftRef,
  children,
}: {
  x: MotionValue<number>;
  originLeftRef: NumRef;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /* Recomputed on every change of `x` (auto-play or drag): the card's
     untransformed offset within the track plus the track's translateX
     gives its live screen center. offsetLeft is safe to read per frame —
     transforms don't invalidate layout. */
  const scale = useTransform(x, (v) => {
    const el = ref.current;
    if (!el) return SCALE_MIN;
    const viewportCenter = window.innerWidth / 2;
    const cardCenter = originLeftRef.current + el.offsetLeft + el.offsetWidth / 2 + v;
    const d = Math.min(Math.abs(cardCenter - viewportCenter) / viewportCenter, 1);
    return SCALE_MAX - d * (SCALE_MAX - SCALE_MIN);
  });

  /* the card closest to center overlaps its shrinking neighbours */
  const zIndex = useTransform(scale, (s) => Math.round(s * 100));

  return (
    <motion.div ref={ref} className="slider-item" style={{ scale, zIndex }}>
      {children}
    </motion.div>
  );
}

function CenterFocusSlider<T>({
  items,
  getKey,
  renderItem,
  direction,
  speed = 55,
  label,
}: {
  items: T[];
  getKey: (item: T) => string | number;
  renderItem: (item: T, tabbable: boolean) => React.ReactNode;
  /** 1 = drifts left → right, -1 = drifts right → left */
  direction: 1 | -1;
  /** auto-play speed in px/s */
  speed?: number;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);

  const halfWidthRef = useRef(0);
  const originLeftRef = useRef(0);
  const hoverRef = useRef(false);
  const pressRef = useRef(false);
  const draggingRef = useRef(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const measure = () => {
      if (trackRef.current) halfWidthRef.current = trackRef.current.scrollWidth / 2;
      if (containerRef.current) {
        originLeftRef.current = containerRef.current.getBoundingClientRect().left;
      }
      // nudge x so every card computes its initial scale from real layout
      x.set(x.get() + 0.001);
    };
    measure();
    const settle = setTimeout(measure, 300); // fonts/images settling
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', measure);
    };
  }, [x]);

  useAnimationFrame((_, delta) => {
    const half = halfWidthRef.current;
    if (half <= 0) return;

    const paused = hoverRef.current || pressRef.current || draggingRef.current;
    if (!paused && !reduceMotion) {
      x.set(x.get() + direction * speed * (delta / 1000));
    }

    /* seamless wrap — never while a finger/cursor is attached, so Motion's
       drag bookkeeping stays consistent (the row is wide enough to buffer
       any single gesture) */
    if (!draggingRef.current) {
      const v = x.get();
      if (v <= -half) x.set(v + half);
      else if (v > 0) x.set(v - half);
    }
  });

  return (
    <div
      ref={containerRef}
      className="center-slider pkg-slider fade-up"
      role="region"
      aria-label={label}
      onMouseEnter={() => { hoverRef.current = true; }}
      onMouseLeave={() => { hoverRef.current = false; }}
    >
      <motion.div
        ref={trackRef}
        className="slider-track"
        style={{ x }}
        drag="x"
        dragMomentum={false}
        onPointerDown={() => { pressRef.current = true; }}
        onPointerUp={() => { pressRef.current = false; }}
        onPointerCancel={() => { pressRef.current = false; }}
        onDragStart={() => { draggingRef.current = true; }}
        onDragEnd={() => { draggingRef.current = false; }}
      >
        {[0, 1].map((half) => (
          <div className="slider-half" key={half} aria-hidden={half === 1}>
            {Array.from({ length: SLIDER_REPEAT }).flatMap((_, rep) =>
              items.map((item) => (
                <CenterScaleItem
                  key={`${rep}-${getKey(item)}`}
                  x={x}
                  originLeftRef={originLeftRef}
                >
                  {renderItem(item, half === 0 && rep === 0)}
                </CenterScaleItem>
              )),
            )}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Slider cards
───────────────────────────────────────────────────────────────────────── */

function PackageCard({
  pkg,
  onSelect,
  tabbable,
}: {
  pkg: Pkg;
  onSelect: (p: Pkg) => void;
  tabbable: boolean;
}) {
  return (
    <div className={`pkg-card${pkg.highlight ? ' featured' : ''}`}>
      {pkg.highlight && (
        <div
          style={{
            display: 'inline-block', alignSelf: 'flex-start',
            background: 'var(--accent-muted)', border: '1px solid var(--border-accent)',
            padding: '0.25rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.55rem',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            color: 'var(--accent)', fontWeight: 500,
            marginBottom: '1rem', borderRadius: 'var(--r-full)',
          }}
        >
          Most Popular
        </div>
      )}

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        {pkg.name}
      </h3>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 600, color: 'var(--primary)', lineHeight: 1 }}>
          {pkg.price}
        </span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {pkg.unit}
        </span>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem', flex: 1, marginBottom: '1.5rem' }}>
        {pkg.features.map((f, i) => (
          <div key={i} className="feature-row">
            <span className="feature-bullet">✓</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 300, lineHeight: 1.55 }}>
              {f}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <button onClick={() => onSelect(pkg)} className="btn-ghost" tabIndex={tabbable ? 0 : -1}>
          See Details →
        </button>
      </div>
    </div>
  );
}

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
            <span className="feature-bullet">✓</span>
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

/* ─────────────────────────────────────────────────────────────────────────
   "Events by King Jegi" lightbox

   Hand-rolled on top of framer-motion (already a dependency, already driving
   the slider above) rather than a new package: nothing installed does dialogs
   or lightboxes, and this page is styled with inline styles and CSS custom
   properties, so a headless-UI dependency would mean a second styling system
   for one overlay.

   Accessibility, since no library provides it here:
     · role="dialog" + aria-modal, labelled by the gallery heading
     · Escape closes
     · ← / → move through the collection (when there's more than one photo)
     · Tab and Shift+Tab cycle inside the dialog
     · focus moves in on open and returns to the trigger on close
───────────────────────────────────────────────────────────────────────── */

const LIGHTBOX_FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function GalleryLightbox({
  images,
  startIndex,
  onClose,
}: {
  images: GalleryImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [index, setIndex] = useState(startIndex);

  const count = images.length;
  const titleId = 'kj-gallery-lightbox-title';
  const current = images[index];

  /* Focus in on open, back to the trigger on close. */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  /* Background must not scroll under the overlay. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (count > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        setIndex((i) => (e.key === 'ArrowRight' ? (i + 1) % count : (i - 1 + count) % count));
        return;
      }

      if (e.key !== 'Tab') return;

      // Re-queried per Tab: the arrows only exist when there's more than one photo.
      const card = cardRef.current;
      if (!card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>(LIGHTBOX_FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !card.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, count]);

  // Guard: an image removed while the lightbox is open would otherwise blank it.
  if (!current) return null;

  return (
    <div className="lb-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="lb-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">Events by King Jegi — photo gallery</h2>

        <button ref={closeRef} className="lb-close" onClick={onClose} aria-label="Close gallery">
          ✕
        </button>

        <div className="lb-stage">
          {/* Keyed so React swaps the element outright on navigation, and the new
              one fades in from its `initial`. Deliberately NOT an AnimatePresence
              exit transition: `mode="wait"` withholds the incoming image until the
              outgoing one finishes animating, which strands the viewer on the
              previous photo if that animation is ever interrupted or throttled —
              a stalled fade should never mean the wrong image on screen. */}
          <motion.img
            key={current.id}
            src={getGalleryImageUrl(current.url) ?? undefined}
            alt={current.caption ?? `Gallery photo ${index + 1} of ${count}`}
            className="lb-image"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          />

          {count > 1 && (
            <>
              <button
                type="button"
                className="lb-arrow lb-arrow-prev"
                onClick={() => setIndex((i) => (i - 1 + count) % count)}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                type="button"
                className="lb-arrow lb-arrow-next"
                onClick={() => setIndex((i) => (i + 1) % count)}
                aria-label="Next photo"
              >
                ›
              </button>
            </>
          )}
        </div>

        <div className="lb-footer">
          {/* Announced as the photo changes — the caption is the only text that moves. */}
          <p className="lb-caption" aria-live="polite">
            {current.caption ?? `Photo ${index + 1} of ${count}`}
          </p>
          {count > 1 && <span className="lb-counter">{index + 1} / {count}</span>}
        </div>
      </div>
    </div>
  );
}

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
      // Only the single priciest package is highlighted, so a tie doesn't light up
      // every card at once.
      const topIndex = rows.findIndex((p) => p.basePrice === topPrice);
      setPackages(rows.map((p, i) => toCard(p, i, i === topIndex && rows.length > 1)));
    } catch {
      setPackagesError('Unable to load our packages. Please try again.');
    } finally {
      setLoadingPackages(false);
    }
  };

  useEffect(() => { void loadPackages(); }, []);
  const [slideIndex, setSlideIndex] = useState(0);

  /* ── "Events by King Jegi" gallery ──────────────────────────────────────
     Admin-uploaded photos from /api/Gallery (anonymous GET). When the gallery
     is empty the banner falls back to the stock slides and simply isn't
     clickable — the section keeps its exact layout either way. */
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    // A failed gallery fetch must not take the page down: the banner just keeps
    // its stock slides, so the error is swallowed deliberately.
    void fetchGallery().then(setGallery, () => setGallery([]));
  }, []);

  const hasGallery = gallery.length > 0;
  /* The banner shows real event photos once there are any. */
  const bannerSlides = hasGallery
    ? gallery.map((g) => getGalleryImageUrl(g.url) ?? '').filter(Boolean)
    : PKG_HERO_SLIDES;

  /* auto-advance slideshow */
  useEffect(() => {
    if (bannerSlides.length <= 1) return;
    const t = setInterval(() => setSlideIndex((i) => (i + 1) % bannerSlides.length), 5000);
    return () => clearInterval(t);
  }, [bannerSlides.length]);

  /* A shorter gallery (an admin deleted a photo) must not strand the index. */
  useEffect(() => {
    setSlideIndex((i) => (i >= bannerSlides.length ? 0 : i));
  }, [bannerSlides.length]);

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

        /* ── feature rows ── */
        .feature-row { display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.85rem; }
        .feature-bullet {
          width: 18px; height: 18px; border-radius: 50%;
          background: var(--primary-muted); border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          color: var(--primary); font-size: 0.55rem; flex-shrink: 0; margin-top: 2px;
        }

        /* ── buttons ── */
        .btn-primary {
          background: var(--primary); color: var(--primary-text); border: none;
          padding: 0.9rem 1.25rem; font-family: var(--font-body); font-size: 0.68rem;
          font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.25s, transform 0.2s, box-shadow 0.2s;
          text-decoration: none; display: inline-block; text-align: center;
        }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: var(--shadow-green); }
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
          background: transparent; color: var(--text-muted);
          border: 1px solid var(--border);
          padding: 0.75rem 1rem; font-family: var(--font-body); font-size: 0.62rem;
          font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.2s, color 0.2s, border-color 0.2s;
          text-align: center; width: 100%;
        }
        .btn-ghost:hover { background: var(--bg-subtle); color: var(--primary); border-color: var(--border-accent); }

        /* ── slideshow ── */
        .pkg-slideshow-wrap {
          position: relative;
          border-radius: var(--r-xl);
          overflow: hidden;
          margin-bottom: 3rem;
          aspect-ratio: 16 / 5;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-md);
        }
        .pkg-slide {
          position: absolute; inset: 0;
          background-size: cover; background-position: center;
          transition: opacity 1.2s ease-in-out;
          opacity: 0;
        }
        .pkg-slide.active { opacity: 1; }
        .pkg-slide-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(90deg, rgba(26,19,14,0.45) 0%, transparent 60%);
          pointer-events: none;
        }
        .pkg-slide-dots {
          position: absolute; bottom: 1rem; right: 1.25rem;
          display: flex; gap: 0.4rem; z-index: 2;
        }
        .pkg-slide-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(255,255,255,0.38); border: none;
          cursor: pointer; padding: 0;
          transition: background 0.3s, transform 0.3s;
        }
        .pkg-slide-dot.active { background: #fff; transform: scale(1.45); }

        /* ── modal ── */
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }

        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(26,19,14,0.55);
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
        /* ── events gallery lightbox ── */
        .sr-only {
          position: absolute; width: 1px; height: 1px;
          padding: 0; margin: -1px; overflow: hidden;
          clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
        }
        /* The banner is a button only when there are photos behind it. */
        .pkg-slideshow-clickable { cursor: pointer; }
        .pkg-slide-trigger {
          position: absolute; inset: 0; z-index: 3;
          background: none; border: 0; padding: 0;
          cursor: pointer;
        }
        .pkg-slide-trigger:focus-visible {
          outline: 3px solid var(--primary);
          outline-offset: -3px;
        }
        /* Dots sit above the full-bleed trigger so they stay independently clickable. */
        .pkg-slide-dots { z-index: 4; }

        .lb-overlay {
          position: fixed; inset: 0;
          background: rgba(6, 50, 59, 0.82);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          z-index: 400;
          display: flex; align-items: center; justify-content: center;
          padding: 1.5rem;
          animation: overlayIn 0.25s ease both;
        }
        .lb-card {
          position: relative;
          width: min(1100px, 100%); max-height: 92vh;
          display: flex; flex-direction: column; gap: 0.75rem;
          animation: modalIn 0.3s ease both;
        }
        .lb-stage {
          position: relative; flex: 1; min-height: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .lb-image {
          max-width: 100%; max-height: 78vh;
          object-fit: contain; display: block;
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg);
        }
        .lb-close {
          position: absolute; top: -0.5rem; right: -0.5rem; z-index: 5;
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--surface); border: 1px solid var(--border);
          color: var(--text-primary); font-size: 1rem; cursor: pointer;
          transition: transform 0.2s;
        }
        .lb-close:hover { transform: scale(1.06); }
        .lb-arrow {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 46px; height: 46px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--surface-glass); border: 1px solid var(--border-glass);
          color: var(--text-primary); font-size: 1.6rem; line-height: 1;
          cursor: pointer; z-index: 4;
          transition: background 0.2s, transform 0.2s;
        }
        .lb-arrow:hover { background: var(--surface); transform: translateY(-50%) scale(1.06); }
        .lb-arrow-prev { left: 0.5rem; }
        .lb-arrow-next { right: 0.5rem; }
        .lb-footer {
          display: flex; align-items: center; justify-content: center;
          gap: 1rem; flex-wrap: wrap;
        }
        .lb-caption {
          margin: 0; text-align: center;
          font-family: var(--font-body); font-size: 0.82rem; font-weight: 300;
          color: rgba(255, 255, 255, 0.92);
        }
        .lb-counter {
          font-family: var(--font-body); font-size: 0.68rem; letter-spacing: 0.12em;
          color: rgba(255, 255, 255, 0.7);
        }
        /* Keyboard operation is a stated requirement — every control shows focus. */
        .lb-close:focus-visible,
        .lb-arrow:focus-visible {
          outline: 2px solid #fff;
          outline-offset: 2px;
        }
        @media (max-width: 640px) {
          .lb-close { top: 0.25rem; right: 0.25rem; }
          .lb-arrow { width: 38px; height: 38px; font-size: 1.3rem; }
        }

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
            HERO — copy block + slideshow + packages slider, one section
        ══════════════════════════════════════════════════════════════════ */}
        <section
          style={{
            ...sectionPad,
            paddingTop: 'calc(6rem + 80px)',
            paddingBottom: '4rem',
            overflow: 'hidden',
            background: 'var(--bg)',
          }}
        >
          <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
          <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />

          {/* ── centered copy block ── */}
          <div
            className="fade-up"
            style={{ maxWidth: 800, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}
          >
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                background: 'var(--accent-muted)', border: '1px solid var(--border-accent)',
                padding: '0.35rem 1rem', marginBottom: '1.5rem',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
              <span
                style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.58rem',
                  letterSpacing: '0.3em', textTransform: 'uppercase',
                  color: 'var(--primary)', fontWeight: 500,
                }}
              >
                What We Offer
              </span>
            </div>

            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)',
                fontWeight: 400, lineHeight: 1.08,
                color: 'var(--text-primary)',
                marginBottom: '1.5rem',
              }}
            >
              Find Your{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Perfect Package</em>
            </h1>

            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '1rem',
                color: 'var(--text-muted)', lineHeight: 1.75,
                maxWidth: 520, margin: '0 auto', fontWeight: 300,
              }}
            >
              Curated all-in-one packages tailored to your event size, style,
              and vision. Pick the one that fits — we'll handle the rest.
            </p>
          </div>

          {/* ── slideshow banner ── */}
          <div style={{ maxWidth: 1200, margin: '4rem auto 0', padding: '0 2.5rem', position: 'relative' }}>
            <div className={`pkg-slideshow-wrap${hasGallery ? ' pkg-slideshow-clickable' : ''}`}>
              {bannerSlides.map((src, i) => (
                <div
                  key={src}
                  className={`pkg-slide${i === slideIndex ? ' active' : ''}`}
                  style={{ backgroundImage: `url(${src})` }}
                />
              ))}
              <div className="pkg-slide-overlay" />

              {/* The whole banner is the affordance once there are photos to show.
                  A real <button> rather than a click handler on the wrapper, so it
                  is reachable and operable from the keyboard for free. Rendered
                  only when the gallery has content — an empty gallery leaves the
                  banner exactly as it was, decorative and inert. */}
              {hasGallery && (
                <button
                  type="button"
                  className="pkg-slide-trigger"
                  onClick={() => setLightboxIndex(slideIndex)}
                  aria-label={`Open the Events by King Jegi gallery — ${gallery.length} photo${gallery.length === 1 ? '' : 's'}`}
                />
              )}

              <div style={{ position: 'absolute', left: '2rem', top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
                <p
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.55rem',
                    letterSpacing: '0.3em', textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.7)', fontWeight: 500,
                    marginBottom: '0.4rem',
                  }}
                >
                  Gallery
                </p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.1rem, 2.5vw, 1.6rem)', fontWeight: 400, color: '#fff', lineHeight: 1.2 }}>
                  Events by King Jegi
                </p>
                {hasGallery && (
                  <p
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.18em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)',
                      marginTop: '0.5rem', fontWeight: 500,
                    }}
                  >
                    View all {gallery.length} photo{gallery.length === 1 ? '' : 's'} →
                  </p>
                )}
              </div>

              <div className="pkg-slide-dots">
                {bannerSlides.map((_, i) => (
                  <button
                    key={i}
                    className={`pkg-slide-dot${i === slideIndex ? ' active' : ''}`}
                    onClick={() => setSlideIndex(i)}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            </div>
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
            <CenterFocusSlider
              items={packages}
              getKey={(p) => p.id}
              direction={1}
              speed={55}
              label="Catering packages"
              renderItem={(pkg, tabbable) => (
                <PackageCard pkg={pkg} onSelect={setSelected} tabbable={tabbable} />
              )}
            />
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
            <CenterFocusSlider
              items={trays}
              getKey={(t) => t.id}
              direction={-1}
              speed={70}
              label="Party tray sets"
              renderItem={(tray, tabbable) => (
                <TrayCard tray={tray} tabbable={tabbable} onSelect={selectTray} />
              )}
            />
          )}
        </section>

        {/* ═══════════════════════ HELP BAND ═══════════════════════ */}
        <section style={{ ...sectionPad, background: 'var(--bg-subtle)', paddingTop: '5rem', paddingBottom: '5rem' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center' }}>
            <h3
              style={{
                fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)',
                fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: '0.85rem',
              }}
            >
              Not sure which package{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>fits?</em>
            </h3>
            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '0.92rem',
                color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300,
                maxWidth: 540, margin: '0 auto 2rem',
              }}
            >
              Tell us about your event and we'll recommend the right setup —
              guest count, venue type, and budget all considered.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {/* BookingPage already reads presetFlow==='plan' and opens Plan-by-Budget
                  straight away, so this needs nothing on the other side. */}
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate('/book', { state: { presetFlow: 'plan' } })}
              >
                Get a Recommendation
              </button>
              <button type="button" className="btn-outline" onClick={() => navigate('/menus')}>
                Browse the Menu
              </button>
            </div>
          </div>
        </section>

        {/* ═══════════════════════ FINAL CTA BAND ═══════════════════════ */}
        <section style={{ ...sectionPad, paddingTop: '4rem', paddingBottom: '4rem', background: 'var(--primary)', overflow: 'hidden' }}>
          <div className="blob blob-primary-soft" style={{ width: 500, height: 500, top: '-150px', right: '-100px' }} />
          <div className="blob blob-accent-soft" style={{ width: 350, height: 350, bottom: '-80px', left: '-60px', animationDelay: '8s' }} />

          <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(255,255,255,0.15)', padding: '0.35rem 1rem', marginBottom: '1rem',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
                Ready to Book?
              </span>
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4.5vw, 3rem)', fontWeight: 400, color: '#fff', lineHeight: 1.1, marginBottom: '0.5rem' }}>
              Reserve Your Date{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Today</em>
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, fontWeight: 300, marginBottom: '1.5rem' }}>
              No payment required to reserve. We'll confirm your booking within 24 hours.
            </p>
            <button
              type="button"
              onClick={() => navigate('/book')}
              style={{
                background: '#fff', color: 'var(--primary)', border: 'none', cursor: 'pointer',
                padding: '1.1rem 2.75rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem',
                fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase',
                borderRadius: 'var(--r-full)',
                transition: 'transform 0.2s, box-shadow 0.2s', display: 'inline-block',
              }}
            >
              Book Your Event
            </button>
          </div>
        </section>

        {/* ═══════════════════════ FOOTER ═══════════════════════ */}
        <footer style={{ background: 'var(--bg-subtle)', borderTop: '1px solid var(--border)', padding: '3rem 2.5rem', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            © {new Date().getFullYear()} King Jegi Party Need and Catering Services · Calamba, Laguna
          </p>
        </footer>
      </main>

      {/* ═══════════════════════ DETAILS MODAL ═══════════════════════ */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close details">
              ✕
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
                    <span className="feature-bullet">✓</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 300, lineHeight: 1.5 }}>
                      {item}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
                <button onClick={() => setSelected(null)} className="btn-outline" style={{ flex: '0 0 auto', paddingTop: '1rem', paddingBottom: '1rem' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ EVENTS GALLERY LIGHTBOX ═══════════════════ */}
      {lightboxIndex !== null && hasGallery && (
        <GalleryLightbox
          images={gallery}
          startIndex={Math.min(lightboxIndex, gallery.length - 1)}
          onClose={() => setLightboxIndex(null)}
        />
      )}

    </>
  );
}
