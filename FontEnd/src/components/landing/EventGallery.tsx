import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  fetchGallery,
  getFullImageUrl,
  type GalleryImage,
} from '../../api/galleryApi';

/**
 * Team photographs shipped in the bundle, served from public/gallery.
 *
 * Moved here from ServiceSection: they are no longer the gallery, they are what the
 * gallery falls back to when /api/Gallery answers with nothing or does not answer at
 * all. Alt text describes the crew and the setting rather than saying "team photo" —
 * these are real staff at real events, and that is the part a screen-reader user is
 * missing.
 */
const GALLERY_FRAMES = [
  {
    src: '/gallery/team-wedding-setup.jpg',
    alt: 'The King Jegi crew in black-and-burgundy uniforms at a wedding reception, '
      + 'arranging place settings in front of a white floral backdrop.',
  },
  {
    src: '/gallery/team-function-hall.jpg',
    alt: 'King Jegi service staff standing beside a full buffet line in a function hall, '
      + 'chafing dishes and garnished platters laid out along the table.',
  },
];

/** One resolved, renderable photo. `src` is absolute by the time a slide exists. */
interface Slide {
  id: string;
  src: string;
  caption: string | null;
}

/**
 * Coverflow geometry, in JS rather than Tailwind width utilities.
 *
 * The horizontal offset of every card is computed from the same card width that sizes
 * it, the way PackageCarousel computes its centring offset from the numbers that lay
 * its track out. Measuring the DOM instead would read geometry mid-spring, while the
 * active card is still growing from 0.8 to 1.
 */
const CARD_MIN_W = 230;
const CARD_MAX_W = 560;
/**
 * Card width as a share of the container — enough left over for the flanking cards
 * to read as a queue. Raised from 0.54 with the cap from 420: in the split layout
 * the gallery has a 60% column rather than the page width, and a card sized for the
 * page left the photograph small against the list beside it.
 */
const CARD_W_RATIO = 0.72;
/** Photo box ratio. Event photos are landscape; this is roughly 4:3. */
const CARD_ASPECT = 0.74;
/**
 * Distance between neighbouring card centres, as a share of card width. Below 1 the
 * cards overlap, which is the visual idea of a coverflow — at 1 they would sit edge to
 * edge and the rotation would read as three separate photos in a row.
 */
const STEP_RATIO = 0.62;
/** Fewer than this and a coverflow is degenerate: no side cards to fan out. */
const MIN_COVERFLOW_ITEMS = 3;
/**
 * Copies of the photo list laid end to end, so the strip wraps.
 *
 * Three is the minimum that guarantees a card on both sides of centre while the
 * middle copy is the one on screen, leaving a whole list of runway in each
 * direction — the same reason PackageCarousel triples its catalog. It is also what
 * lets cardMotion stay exactly as it was: the |offset| >= 2 fade is still a fade to
 * a real card standing behind it, not an edge.
 */
const COPIES = 3;
/**
 * How long to let a step settle before shifting back to the middle copy. The spring
 * below is done well inside this; teleporting early would cut a move short.
 */
const SETTLE_MS = 620;

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };
const INSTANT = { duration: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * The gallery's eyebrow — the one piece of the header every path that renders the
 * gallery shell shows, because it names the block whether or not there is a photo to
 * count.
 *
 * --evg-ink, which is the page's own --text-primary and therefore inverts with the
 * theme. Note what this rules out: --accent cannot be used here at all — it has no
 * headroom over a photograph in light mode, the same wall .lp-photo-ground hit. The
 * ink measures 6.9 light and 5.2 dark against the worst case the ambient layer can
 * produce (an all-white or all-black photo region under the
 * scrim), so it clears with room.
 *
 * It does mean the kicker and the caption below it are now the same colour; the
 * 10px uppercase mono against 20px display type is what separates them.
 */
function Kicker() {
  return (
    <p className="m-0 font-mono text-[0.900rem] font-medium uppercase tracking-[0.14em] text-[var(--evg-ink)]">
      Events by King Jegi
    </p>
  );
}

/**
 * Per-card state, driven entirely by `offset = index - activeIndex`.
 *
 * Everything here is fed to Framer Motion's `animate` object rather than written as
 * Tailwind classes. `scale-75`, `opacity-60` and `blur-sm` compile to the same inline
 * style properties Framer writes on every frame, so the two would overwrite each
 * other, and `rotateY-0` is not a utility at all. z-index is the exception — see the
 * card's `style` prop.
 */
function cardMotion(offset: number, reduced: boolean) {
  const distance = Math.abs(offset);
  /* -1 sits to the left and turns its face toward the centre (+45deg); +1 mirrors it. */
  const direction = Math.sign(offset);

  if (distance === 0) {
    return { scale: 1, rotateY: 0, opacity: 1, filter: 'blur(0px)' };
  }
  if (distance === 1) {
    return {
      scale: 0.9,
      rotateY: reduced ? 0 : -direction * 22,
      opacity: 0.75,
      filter: reduced ? 'blur(0px)' : 'blur(2px)',
    };
  }
  return {
    scale: 0.82,
    rotateY: reduced ? 0 : -direction * 30,
    opacity: 0,
    filter: reduced ? 'blur(0px)' : 'blur(4px)',
  };
}

/**
 * The aurora, as two pseudo-element layers over the block's ground.
 *
 * Its two tints are --accent and --primary mixed down rather than the fixed purple and
 * teal they were, so the empty state follows the theme like everything else here.
 *
 * Deliberately small. The version of this section that was stripped stacked four
 * radial gradients, an animated blob canvas, a noise plate and a backdrop-filter —
 * six compositing layers above the fold. This is two, both animating transform and
 * opacity only (never background-position, which repaints the whole box), on cycles
 * long enough to read as drift rather than motion, and frozen outright for anyone who
 * asked for reduced motion.
 *
 * Lives in a component-scoped <style> the way Navbar and Toasts do theirs, so
 * landing.css stays untouched and the rules travel with the component.
 */
const AURORA_CSS = `
/* The block's palette, and the whole reason it can follow the theme now.

   --bg-subtle and --text-primary already flip: light gives #EDF2E7 on #16281A,
   dark gives #1E2C1F on #EEF3EA. So the block needs no band tokens and no second
   set of values — it reads the two the page already has, and the ground and the
   ink invert together.

   ONE ink, not an ink and a muted one. The counter, the caption and the arrows
   used --blush at 80%; a mid-tone cannot survive here, because the photo behind
   the veil is unbounded — it comes from /api/Gallery, so unlike the hero folder
   there is no set to measure and the worst frame has to be assumed white or black.
   Measured against that bound, --band-muted tops out at 3.99 even under the old
   0.82 veil. Hierarchy in this block is size and weight, never colour. The same
   call .lp-stat-label makes on the hero.

   --evg-veil at 72%, down from the 82% this had. The floor is the ink against the
   worst frame: 6.9 light, 5.2 dark. 62% would fail dark outright at 3.82.

   The edges are the ink mixed down. They are UI, not text, so they answer to 3:1
   rather than 4.5:1, and mixing keeps them correct in both themes for free. */
.evg-shell {
  --evg-ground: var(--bg-subtle);
  --evg-ink: var(--text-primary);
  --evg-veil: 72%;
  --evg-edge: color-mix(in srgb, var(--evg-ink) 70%, transparent);
  --evg-edge-strong: color-mix(in srgb, var(--evg-ink) 90%, transparent);
  --evg-wash: color-mix(in srgb, var(--evg-ink) 10%, transparent);
  --evg-ring: color-mix(in srgb, var(--evg-ink) 14%, transparent);
}

/* The veil over the blurred photo. A class rather than a Tailwind arbitrary value
   because the percentage is itself a custom property. */
.evg-veil {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--evg-ground) var(--evg-veil), transparent);
}
.evg-shell--aurora::before,
.evg-shell--aurora::after {
  content: '';
  position: absolute;
  inset: -35%;
  border-radius: 50%;
  pointer-events: none;
  will-change: transform, opacity;
}
.evg-shell--aurora::before {
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 45%, transparent), transparent 72%);
  animation: evg-drift-a 28s ease-in-out infinite;
}
.evg-shell--aurora::after {
  background: radial-gradient(closest-side, color-mix(in srgb, var(--primary) 38%, transparent), transparent 72%);
  animation: evg-drift-b 36s ease-in-out infinite;
}
@keyframes evg-drift-a {
  0%, 100% { transform: translate3d(-14%, -8%, 0) scale(1);    opacity: 0.75; }
  50%      { transform: translate3d(12%, 7%, 0)   scale(1.18); opacity: 0.45; }
}
@keyframes evg-drift-b {
  0%, 100% { transform: translate3d(16%, 10%, 0)  scale(1.12); opacity: 0.5; }
  50%      { transform: translate3d(-10%, -6%, 0) scale(1);    opacity: 0.75; }
}
@media (prefers-reduced-motion: reduce) {
  .evg-shell--aurora::before,
  .evg-shell--aurora::after { animation: none; }
}
`;

/**
 * The ambient ground: the photo you are looking at, blurred out of legibility and
 * dimmed, so the block's colour shifts with the gallery.
 *
 * It REPLACES the aurora rather than joining it. The aurora existed to give this
 * block moving colour when there was nothing to sample; a blurred still of the
 * active photo does that better and truer. Keeping both would put four compositing
 * layers behind the content — image, scrim and two animated pseudo-elements — which
 * is the stack this section was stripped of in the first place. Two in, two out.
 *
 * The veil is the block's own ground at 72%, so it inverts with the theme — see the
 * .evg-shell token block. Not black at any opacity: measured on the built page, a 60%
 * black veil over a bright photo composites to a mid grey that took the kicker to
 * 3.2:1. 72% is the lightest that holds the ink against the worst frame in BOTH
 * themes, dark being the tighter of the two at 5.2:1.
 *
 * scale(1.1) hides the soft edge: a 40px blur samples past the element's bounds and
 * would otherwise show a pale halo around the inside of the rounded corners.
 */
function Ambient({ src }: { src: string }) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.div
          /* Keyed on the photo, so a step mounts a new layer over the old one and the
             two cross-fade. mode is the default sync, not wait — waiting would blank
             the ground between slides instead of blending through it. */
          key={src}
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${src})`, filter: 'blur(44px) saturate(1.25)', transform: 'scale(1.1)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />
      </AnimatePresence>
      <div className="evg-veil" />
    </div>
  );
}

/**
 * The dark block itself.
 *
 * It used to be a deliberate override of the light/dark toggle — plum in both themes,
 * on the argument that photographs read better against a dark ground. They do, but the
 * block sat dark on a light page and read as a section that had forgotten the theme
 * rather than one that meant it. It now takes --bg-subtle and inverts with everything
 * else. Still scoped and rounded rather than full-bleed: the offerings column beside it
 * keeps the page ground, and the corner radius is what makes the tonal step read as a
 * designed seam.
 */
function Shell({ ambient, children }: { ambient?: React.ReactNode; children: React.ReactNode }) {
  return (
    /* h-full + a centred column: when the block is stretched to match a taller
       neighbour, the extra height becomes ground around the coverflow rather than a
       gap under it, and the aurora already fills that space. */
    <div
      className={`evg-shell relative isolate flex h-full flex-col overflow-hidden rounded-[28px] bg-[var(--evg-ground)] px-4 py-9 sm:px-8 sm:py-11${
        ambient ? '' : ' evg-shell--aurora'
      }`}
    >
      <style>{AURORA_CSS}</style>
      {ambient}
      <div className="relative z-10 flex flex-1 flex-col justify-center">{children}</div>
    </div>
  );
}

/**
 * What the section shows when there is no live gallery: exactly what it showed before
 * this component existed — the two bundled frames in the `.lp-gallery` two-up grid.
 *
 * Chosen over hiding the block. An empty gallery means nobody has uploaded yet, and a
 * marketing section that silently loses a third of its height on a fresh install reads
 * as a bug, while two real photos of the crew read as the page. It reuses the existing
 * `.lp-gallery` rules rather than adding any, and stays outside the shell: the tinted
 * block is the live gallery's identity, so a fallback that never came from the API
 * should not borrow it.
 */
function StaticFallback({ note }: { note?: string }) {
  return (
    <>
      <div className="lp-gallery">
        {GALLERY_FRAMES.map((frame) => (
          <img
            key={frame.src}
            src={frame.src}
            alt={frame.alt}
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
      {note && <p className="mt-3 text-[0.8125rem] text-text-muted">{note}</p>}
    </>
  );
}

/** Placeholder at the coverflow's real height, so nothing moves when the photos land. */
function Skeleton({ cardW, cardH, step }: { cardW: number; cardH: number; step: number }) {
  return (
    <div className="relative w-full" style={{ height: cardH }} aria-hidden="true">
      {[-1, 1].map((offset) => (
        <div
          key={offset}
          className="absolute top-0 rounded-[20px] bg-[var(--evg-wash)]"
          style={{
            left: '50%',
            width: cardW,
            height: cardH,
            marginLeft: -cardW / 2,
            transform: `translateX(${offset * step}px) scale(0.8)`,
          }}
        />
      ))}
      <div
        className="absolute top-0 animate-pulse rounded-[20px] bg-[var(--evg-wash)]"
        style={{ left: '50%', width: cardW, height: cardH, marginLeft: -cardW / 2 }}
      />
    </div>
  );
}

/**
 * Events by King Jegi — a 3D coverflow over the live gallery.
 *
 * Owns its own fetch and its own state, the way TestimonialsSection owns the reviews it
 * draws: nothing else on the page reads /api/Gallery, and keeping the call here is what
 * lets the whole block — data, geometry and markup — move as one unit.
 *
 * Alt text is a real regression from the hand-written frames this replaces. The public
 * DTO carries `caption` and nothing else, so alt quality is now exactly as good as the
 * captions the owner types into the admin uploader; a photo uploaded without one falls
 * back to a generic string that describes nothing.
 */
export function EventGallery() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [slides, setSlides] = useState<Slide[]>([]);
  /**
   * Index into the RENDERED (tripled) list, deliberately unbounded — stepping never
   * clamps, which is what makes the last photo run on into the first. It is pulled
   * back into the middle copy after each move settles, below.
   */
  const [active, setActive] = useState(0);
  /** Suppresses the spring for the single frame the shift-back happens in. */
  const [teleporting, setTeleporting] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    let cancelled = false;
    fetchGallery()
      .then((rows) => {
        if (cancelled) return;
        const resolved = rows
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((row: GalleryImage) => ({
            id: row.id,
            /* Relative paths come back from the API; anything unresolvable is dropped
               rather than rendered as a broken frame. */
            src: getFullImageUrl(row.url),
            caption: row.caption?.trim() ? row.caption.trim() : null,
          }))
          .filter((s): s is Slide => s.src !== null);
        setSlides(resolved);
        /* Open on the first photo of the MIDDLE copy, so there is a card on both
           sides from the first paint rather than after the first step. */
        setActive(resolved.length >= MIN_COVERFLOW_ITEMS ? resolved.length : 0);
        setStatus('ready');
      })
      .catch(() => {
        /* GalleryApiError either way — the message it carries is written for admins
           mid-upload, so the public section shows its own quiet line instead. */
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, []);

  /* The cards are positioned by transform, not layout, so the track's own width says
     nothing about where centre is — the visible width of the viewport does. Re-runs on
     `status` because the element does not exist until the shell renders. */
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const read = () => setViewport(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  const count = slides.length;
  const cardW = Math.round(
    viewport > 0 ? clamp(viewport * CARD_W_RATIO, CARD_MIN_W, CARD_MAX_W) : 360,
  );
  const cardH = Math.round(cardW * CARD_ASPECT);
  const step = Math.round(cardW * STEP_RATIO);

  /** A coverflow needs three photos before wrapping means anything. */
  const loops = count >= MIN_COVERFLOW_ITEMS;
  /** Which real photo is centred — `active` runs through the copies, this does not. */
  const realIndex = count > 0 ? ((active % count) + count) % count : 0;

  /* Unbounded: no clamp, so Next runs off the end of a copy and the shift below puts
     it back with a fresh list of runway on both sides. */
  const stepBy = useCallback(
    (delta: number) => setActive((i) => (loops ? i + delta : clamp(i + delta, 0, count - 1))),
    [count, loops],
  );

  /**
   * Shift back to the middle copy once a move has settled.
   *
   * Every copy is identical and each card's x is linear in `active` (`(i - active) *
   * step`), so moving `active` by exactly one list length lands every card on the
   * pixel another card already occupies. With the spring suppressed for that frame,
   * nothing moves on screen — and the strip has a whole list of runway again.
   */
  useEffect(() => {
    if (!loops) return;
    if (active >= count && active < count * 2) return;
    const settle = setTimeout(() => {
      setTeleporting(true);
      setActive((a) => (a < count ? a + count : a - count));
    }, reducedMotion ? 0 : SETTLE_MS);
    return () => clearTimeout(settle);
  }, [active, count, loops, reducedMotion]);

  /* Re-arm the spring on the frame after the shift has been painted. */
  useEffect(() => {
    if (!teleporting) return;
    const id = requestAnimationFrame(() => setTeleporting(false));
    return () => cancelAnimationFrame(id);
  }, [teleporting]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    /* Velocity folded into the distance so a short flick still counts as a gesture.
       Whatever the throw, this moves exactly one card — the track is a stepper, not a
       free scroller. */
    const power = info.offset.x + info.velocity.x * 0.2;
    const threshold = Math.max(60, step * 0.35);
    if (power <= -threshold) stepBy(1);
    else if (power >= threshold) stepBy(-1);
  };

  if (status === 'loading') {
    return (
      <Shell>
        {/* Kicker only. The counter, the arrows and the dots all describe a set that
            has not arrived, and a "00 / 00" beside two disabled buttons is worse than
            an empty corner. Their heights are reserved, not their contents, so the
            photos landing moves nothing. */}
        <div className="mb-6">
          <Kicker />
          {/* The same empty title slot the ready header reserves, so the header is
              exactly as tall before the photos land as after. */}
          <div className="mt-2 min-h-[1.875rem]" />
        </div>
        <div ref={viewportRef} className="w-full">
          <Skeleton cardW={cardW} cardH={cardH} step={step} />
        </div>
        <div className="mt-6 min-h-[0.375rem]" />
      </Shell>
    );
  }

  if (status === 'error') {
    return <StaticFallback note="Our live gallery isn’t loading right now." />;
  }

  if (count === 0) return <StaticFallback />;

  /* One or two photos: no side cards to fan out, so the coverflow collapses to plain
     centred frames — still on the block's ground, because these did come from the API. */
  if (count < MIN_COVERFLOW_ITEMS) {
    return (
      <Shell>
        {/* Kicker only again, and for the same reason: there is no active card to
            count, so "01 / 02" beside two plain frames would describe a stepper that
            does not exist. The captions stay under their own frames here. */}
        <div className="mb-6">
          <Kicker />
        </div>
        <div
          className={
            count === 1 ? 'mx-auto max-w-[520px]' : 'grid grid-cols-1 gap-5 sm:grid-cols-2'
          }
        >
          {slides.map((slide) => (
            <figure key={slide.id} className="m-0">
              <img
                src={slide.src}
                alt={slide.caption ?? 'King Jegi event photo'}
                loading="lazy"
                decoding="async"
                className="block h-[260px] w-full rounded-[20px] object-cover ring-1 ring-[var(--evg-ring)] sm:h-[300px]"
              />
              {slide.caption && (
                <figcaption className="mt-3 text-center text-[0.8125rem] text-[var(--evg-ink)]">
                  {slide.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </Shell>
    );
  }

  const activeCaption = slides[realIndex]?.caption ?? null;
  /* The strip the track actually draws: three copies end to end. */
  const rendered = loops
    ? Array.from({ length: count * COPIES }, (_, i) => slides[i % count])
    : slides;

  return (
    /* The ground follows the centred photo, so stepping shifts the whole block's
       colour rather than just swapping a picture inside a static box. */
    <Shell ambient={<Ambient src={slides[realIndex].src} />}>
      <div className="mb-6 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <Kicker />
          {/* The active photo's caption, promoted out of the old line under the track.
              Still the live region — moving it into the header must not stop stepping
              from being announced — and still a reserved height, because `caption` is
              optional on the DTO and an uncaptioned photo must not resize the block. */}
          <div className="mt-2 min-h-[1.875rem]" aria-live="polite">
            {activeCaption && (
              /* Line-height pinned to the reserved height rather than left to the
                 font: measured, an uncaptioned photo came out 2px shorter than a
                 captioned one, which is a visible twitch on every other step. */
              <h3 className="m-0 truncate font-serif text-[1.0625rem] font-semibold leading-[1.875rem] tracking-[-0.015em] text-[var(--evg-ink)] sm:text-[1.25rem]">
                {activeCaption}
              </h3>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center gap-3">
          <span className="font-mono text-[0.6875rem] tabular-nums text-[var(--evg-ink)]">
            {String(realIndex + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </span>
          {/* Never disabled: the strip wraps, so there is no last photo to stop on. */}
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => stepBy(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--evg-edge)] text-[var(--evg-ink)] transition-colors hover:border-[var(--evg-edge-strong)] hover:bg-[var(--evg-wash)]"
          >
            <ChevronLeft size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => stepBy(1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--evg-edge)] text-[var(--evg-ink)] transition-colors hover:border-[var(--evg-edge-strong)] hover:bg-[var(--evg-wash)]"
          >
            <ChevronRight size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Perspective sits on the parent of the track: the track itself carries the drag
          transform, and perspective declared on a transformed element applies to its
          children from the wrong origin. */}
      <div ref={viewportRef} className="w-full" style={{ perspective: '1000px' }}>
        <motion.div
          role="group"
          aria-roledescription="carousel"
          aria-label="Photos from events catered by King Jegi"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(-1); }
          }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          onDragEnd={onDragEnd}
          className="relative w-full cursor-grab select-none outline-none active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose"
          style={{ height: cardH, transformStyle: 'preserve-3d' }}
        >
          {rendered.map((slide, i) => {
            const offset = i - active;
            const distance = Math.abs(offset);
            const isActive = distance === 0;
            const offscreen = distance >= 2;

            return (
              <motion.div
                /* The id repeats across copies, so the index is part of the key —
                   otherwise React reconciles three cards onto one. */
                key={`${slide.id}-${i}`}
                /* No `layout` prop: layout animations and drag write the same transform
                   and fight over it. Position is driven by `animate` alone. */
                animate={{ x: offset * step, ...cardMotion(offset, reducedMotion) }}
                transition={reducedMotion || teleporting ? INSTANT : SPRING}
                /* z-index and pointer-events stay in `style`, not `animate`: stacking
                   order is discrete and has to flip the instant the active card changes,
                   and springing it would tween through fractional layers while a
                   faded-out card is still on top. */
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  width: cardW,
                  height: cardH,
                  marginLeft: -cardW / 2,
                  zIndex: 10 - Math.min(distance, 5),
                  pointerEvents: offscreen ? 'none' : 'auto',
                  transformStyle: 'preserve-3d',
                }}
                /* Side cards answer the mouse; the keyboard path is the arrow keys on
                   the group, which is why they can be aria-hidden without hiding a
                   focusable control inside hidden content. (PackageCarousel makes the
                   opposite call because its side cards contain a real button.) Clicking
                   the active card does nothing: a lightbox would mean a portal, a focus
                   trap and an escape handler — its own change, not a detail of this one. */
                aria-hidden={!isActive}
                {...(isActive || offscreen
                  ? {}
                  : { onClick: () => setActive(i), className: 'cursor-pointer' })}
              >
                <img
                  src={slide.src}
                  /* The caption is already announced by the live region under the track,
                     and the side cards are aria-hidden, so only the active photo needs a
                     name here. */
                  alt={isActive ? (slide.caption ?? 'King Jegi event photo') : ''}
                  loading="lazy"
                  decoding="async"
                  /* Native image dragging starts its own gesture and cancels Framer's on
                     the first pointer move. */
                  draggable={false}
                  className="pointer-events-none block h-full w-full rounded-[20px] object-cover shadow-[0_18px_44px_rgba(0,0,0,0.45)] ring-1 ring-[var(--evg-ring)]"
                />
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Real buttons, not decorative divs: each one is a jump to a specific photo, so
          each needs a name and the keyboard. aria-current marks the active one for a
          screen reader, and the pill shape marks it for everyone else. */}
      <div className="mt-6 flex items-center justify-center gap-2">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            aria-label={slide.caption ? `Show photo ${i + 1}: ${slide.caption}` : `Show photo ${i + 1}`}
            aria-current={i === realIndex}
            /* One dot per real photo, not per rendered copy, and the jump takes the
               short way round the ring — from photo 5 to photo 1 that is one step
               forward, not four back. */
            onClick={() => setActive((a) => {
              let d = (i - realIndex + count) % count;
              if (d > count / 2) d -= count;
              return a + d;
            })}
            className={`h-1.5 rounded-full transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose ${
              i === realIndex ? 'w-7 bg-[var(--evg-ink)]' : 'w-1.5 bg-[var(--evg-edge)] hover:bg-[var(--evg-edge-strong)]'
            }`}
          />
        ))}
      </div>
    </Shell>
  );
}

export default EventGallery;
