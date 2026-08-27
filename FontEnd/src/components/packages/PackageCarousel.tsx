import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PackageCard, type PackageCardData } from './PackageCard';
import './packages.css';

/**
 * Track geometry, in JS rather than Tailwind `basis-*` utilities.
 *
 * The centring offset has to be computed from the same numbers that lay the
 * track out. Measuring the DOM instead (offsetLeft/offsetWidth) reads geometry
 * mid-transition while the active card is still growing from 268 to 366, which
 * lands the card a few dozen pixels off centre.
 */
const GAP = 20;
const ACTIVE_W = 366;
const SIDE_W = 268;
/**
 * Vertical inset on the flanking cards. Applied to the wrapper, which is a
 * stretched flex item, so the card inside is exactly this much shorter top and
 * bottom than the centre one — asymmetric by construction rather than by
 * whichever package happens to carry the most copy.
 */
const SIDE_INSET = 34;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const DURATION = 420;
/**
 * Copies of the catalog laid end to end for the infinite loop. Three is the
 * minimum that guarantees a card on both sides of centre while the middle copy
 * is the one on screen, leaving a whole catalog of runway in each direction.
 */
const COPIES = 3;
/**
 * Floor for the centre card.
 *
 * Without it the track height is whatever the centred card's copy happens to
 * need, and the Custom package carries none — no inclusions list, no price
 * figure — so centring it collapsed the whole rail and the spotlight card came
 * out barely taller than its neighbours. A floor keeps the centre card the
 * largest element whatever is in it.
 */
const MIN_ACTIVE_H = 460;

export function PackageCarousel<T extends PackageCardData>({
  packages,
  onAction,
  initialIndex = 0,
  renderItem,
  label = 'Catering packages',
}: {
  packages: T[];
  onAction: (pkg: T) => void;
  /** Which card opens centred. The catalog arrives async, so this is applied
   *  when the set lands rather than only at mount. */
  initialIndex?: number;
  /**
   * What to draw in each slot. Defaults to PackageCard.
   *
   * Exists so the party trays can run this exact mechanism — same stepping,
   * same wrap, same geometry — while drawing their own card. Reusing the
   * carousel is the point: the trays previously had a second, unrelated
   * auto-playing slider, so the two rails on one page behaved differently.
   */
  renderItem?: (item: T, isActive: boolean) => ReactNode;
  /** Overrides the group label for screen readers. */
  label?: string;
}) {
  const count = packages.length;
  const canStep = count > 1;
  /** A single package has nothing to loop through; it just sits centred. */
  const loops = count > 1;

  /**
   * Virtual index into the rendered (tripled) list, deliberately unbounded —
   * stepping never clamps, which is what makes Next continue past the last
   * card. It is pulled back into the middle copy after each move, below.
   */
  const [active, setActive] = useState(loops ? count + initialIndex : initialIndex);
  /** Suppresses the transition for the single frame the teleport happens in. */
  const [teleporting, setTeleporting] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (count === 0) { setActive(0); return; }
    const start = Math.min(Math.max(initialIndex, 0), count - 1);
    setActive(loops ? count + start : start);
  }, [count, initialIndex, loops]);

  // The track is translated, not scrolled, so its own width tells us nothing —
  // the centring needs the visible width of the clipping viewport.
  //
  // Depends on `count`: the catalog arrives async, and until it does this
  // component returns null, so the first run finds a null ref. Without `count`
  // in the deps it would never re-run once the element actually mounted, the
  // width would stay 0, and every card would centre on x=0 instead.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const read = () => setViewport(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  /**
   * Teleport: once a move settles outside the middle copy, shift by exactly one
   * catalog length with the transition off. Because every copy is identical and
   * the offset is linear in `active` (see below), the pixel position after the
   * shift is the same one already on screen — so nothing moves visually, and the
   * next step has a full catalog of runway again.
   */
  useEffect(() => {
    if (!loops) return;
    if (active >= count && active < count * 2) return;
    const settle = setTimeout(() => {
      setTeleporting(true);
      setActive((a) => (a < count ? a + count : a - count));
    }, reducedMotion ? 0 : DURATION);
    return () => clearTimeout(settle);
  }, [active, count, loops, reducedMotion]);

  // Re-arm the transition on the frame after the teleport has been painted.
  useEffect(() => {
    if (!teleporting) return;
    const id = requestAnimationFrame(() => setTeleporting(false));
    return () => cancelAnimationFrame(id);
  }, [teleporting]);

  /** Unbounded — no clamp, so Next runs off the end and wraps. */
  const step = (delta: number) => setActive((i) => i + delta);

  // Cards shrink to fit a narrow viewport; the side card keeps its step down
  // from the active one so the spotlight still reads at phone widths.
  const activeW = viewport > 0 ? Math.min(ACTIVE_W, viewport - 40) : ACTIVE_W;
  const sideW = Math.max(180, Math.min(SIDE_W, activeW - 66));

  /**
   * Translate the track so the active card's centre meets the viewport's centre.
   *
   * This replaces `card.scrollIntoView({ inline: 'center' })`, which could not
   * work here: with few cards the flex content is narrower than the container,
   * so scrollWidth === clientWidth, there is no scrollable overflow, and the
   * call silently did nothing — only the width swap was visible. Once the
   * catalog did overflow, `justify-center` on a scroll container pushed the
   * leading cards into negative scroll space where they could not be reached.
   *
   * Every card before the active one is a side card, so the leading edge is just
   * `active * (sideW + GAP)` — linear in `active`. That is what lets the loop
   * teleport by a whole catalog without computing a running sum.
   */
  const offset = viewport / 2 - (active * (sideW + GAP) + activeW / 2);

  if (count === 0) return null;

  const rendered = loops
    ? Array.from({ length: count * COPIES }, (_, i) => packages[i % count])
    : packages;
  /** Which real package is centred, for the dots and the counter. */
  const realIndex = ((active % count) + count) % count;

  const motion =
    reducedMotion || teleporting
      ? 'none'
      : `transform ${DURATION}ms ${EASE}, width ${DURATION}ms ${EASE}`;

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={canStep ? 0 : -1}
      onKeyDown={(e) => {
        if (!canStep) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'Home') { e.preventDefault(); setActive(loops ? count : 0); }
        else if (e.key === 'End') { e.preventDefault(); setActive(loops ? count * 2 - 1 : count - 1); }
      }}
      className="pkg-theme relative"
    >
      <div className="relative">
        {canStep && (
          /* Never disabled: the track wraps, so there is no last card to stop on. */
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous package"
            className="absolute top-1/2 -translate-y-1/2 left-[-20px] w-[40px] h-[40px] flex items-center justify-center rounded-full border border-border bg-surface text-text-primary cursor-pointer z-10 transition-colors duration-200 hover:bg-bg-subtle hover:border-border-accent"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        )}

        {/* Clipping viewport. overflow-hidden, not overflow-x-auto: the track
            moves under transform, so a scrollbar here would be a second,
            conflicting way to move it. */}
        <div ref={viewportRef} className="overflow-hidden py-2">
          <div
            className="flex items-stretch"
            style={{
              gap: `${GAP}px`,
              transform: `translate3d(${offset}px, 0, 0)`,
              transition: motion,
              willChange: 'transform',
            }}
          >
            {rendered.map((pkg, i) => {
              const isActive = i === active;
              /* Only the centre card and its two neighbours are on screen. The
                 rest are loop runway: hidden from assistive tech and out of the
                 tab order, so the clones don't read as duplicate packages. */
              const onScreen = Math.abs(i - active) <= 1;
              return (
                <div
                  key={`${pkg.id}-${i}`}
                  style={{
                    width: isActive ? activeW : sideW,
                    flex: '0 0 auto',
                    transition: motion,
                    minHeight: isActive ? MIN_ACTIVE_H : undefined,
                    // Shorter than the centre card, top and bottom.
                    paddingBlock: isActive ? 0 : SIDE_INSET,
                  }}
                  /* Side cards are a real affordance, so they carry a role and a
                     name and answer the keyboard. Previously this was a bare div
                     with onClick — unreachable without a mouse — and the whole
                     wrapper was aria-hidden while still containing a focusable
                     button, which put tabbable content inside hidden content. */
                  {...(isActive
                    ? {}
                    : onScreen
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': `Show ${pkg.name}`,
                          onClick: () => setActive(i),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              setActive(i);
                            }
                          },
                          className: 'cursor-pointer rounded-[24px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                        }
                      : { 'aria-hidden': true })}
                >
                  {renderItem ? (
                    renderItem(pkg, isActive)
                  ) : (
                    <PackageCard
                      pkg={pkg}
                      isActive={isActive}
                      reducedMotion={reducedMotion}
                      onAction={() => onAction(pkg)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {canStep && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next package"
            className="absolute top-1/2 -translate-y-1/2 right-[-20px] w-[40px] h-[40px] flex items-center justify-center rounded-full border border-border bg-surface text-text-primary cursor-pointer z-10 transition-colors duration-200 hover:bg-bg-subtle hover:border-border-accent"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {canStep && (
        <div aria-live="polite" className="flex items-center justify-center gap-[7px] mt-[28px]">
          {count <= 7 ? (
            packages.map((pkg, i) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setActive(loops ? count + i : i)}
                aria-label={`Show ${pkg.name}`}
                aria-current={i === realIndex}
                className={`h-[7px] rounded-full border-none p-0 cursor-pointer transition-all duration-300 ${i === realIndex ? 'w-[26px] bg-accent' : 'w-[7px] bg-border-strong hover:bg-accent/60'}`}
              />
            ))
          ) : (
            <span className="tabular-nums text-[0.75rem] text-text-muted">
              {realIndex + 1} / {count}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
