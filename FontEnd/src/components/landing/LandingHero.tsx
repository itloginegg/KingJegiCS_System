import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AmbientCanvas } from './AmbientCanvas';

const STATS = [
  { value: '500+', label: 'Events Served' },
  { value: '12 yrs', label: 'Experience' },
  { value: '4.9 ★', label: 'Client Rating' },
];

/** How long a still holds before the next layer fades in. Videos ignore it. */
const IMAGE_MS = 6000;

export type HeroMedia =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string; poster?: string };

export interface LandingHeroProps {
  /**
   * Background layers for the right column, cycled in order.
   *
   * A list rather than the old `image: string`, because a `<video>` cannot be a
   * CSS `background-image` — mixing the two means real stacked elements, not a
   * value swap. A single-entry list is the old behaviour and never cycles.
   */
  media: HeroMedia[];
  /** The date picker. Passed in rather than rendered here so the hero stays presentational. */
  children: ReactNode;
}

/** Read once per mount; the preference does not change mid-session in practice. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The split hero.
 *
 * The old hero was a full-bleed photo slideshow with the copy floating on top and
 * three decorative cards stacked over it; availability lived three sections down,
 * behind a modal. This puts the pitch on the left and the live date picker on the
 * right, so the one question a visitor actually arrives with — "is my date free" —
 * is answered above the fold without a click.
 */
export function LandingHero({ media, children }: LandingHeroProps) {
  const [index, setIndex] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const count = media.length;
  /* One layer has nothing to cross-fade to, and reduced motion holds frame one. */
  const cycles = count > 1 && !reduced;

  /**
   * Advance the slideshow.
   *
   * A still gets a fixed timer; a clip is given its own duration instead, so a
   * 3-second loop and a 20-second one each get their full run rather than being
   * cut at an arbitrary interval. `ended` never fires on a looping video, so the
   * timer is armed from `loadedmetadata` — and falls back to IMAGE_MS while the
   * duration is still NaN.
   */
  useEffect(() => {
    if (!cycles) return;
    const current = media[index];
    const advance = () => setIndex((i) => (i + 1) % count);

    if (current.type === 'image') {
      const t = setTimeout(advance, IMAGE_MS);
      return () => clearTimeout(t);
    }

    const el = videoRefs.current[index];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const ms = el && Number.isFinite(el.duration) && el.duration > 0
        ? el.duration * 1000
        : IMAGE_MS;
      timer = setTimeout(advance, ms);
    };
    if (el && el.readyState >= 1) arm();
    else el?.addEventListener('loadedmetadata', arm, { once: true });

    return () => {
      if (timer) clearTimeout(timer);
      el?.removeEventListener('loadedmetadata', arm);
    };
  }, [cycles, index, count, media]);

  /**
   * Only the visible clip plays. Reduced motion holds the poster and never
   * autoplays, which is also why `autoPlay` is not on the element itself.
   */
  useEffect(() => {
    videoRefs.current.forEach((el, i) => {
      if (!el) return;
      if (i === index && !reduced) {
        // A rejected play() is normal (no gesture yet, tab hidden) — the poster
        // stays up and the layer is still correct, so it must not throw.
        void el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
  }, [index, reduced]);

  return (
    <section id="home" className="lp-hero">
      {/* Spans the whole hero, behind both columns, so the weather sits directly
          behind the headline. It used to live inside .lp-hero-media, which is the
          photograph column — the copy column never saw it. */}
      <div className="lp-hero-ambient" aria-hidden="true">
        <AmbientCanvas />
      </div>

      <div className="lp-hero-copy">
        <div className="ui-pill">
          <span className="ui-pill-dot" aria-hidden="true" />
          <span className="ui-pill-text">Catering &amp; events · Calamba, Laguna</span>
        </div>

        <h1 className="ui-h1">Farm-fresh feasts, handled end to end.</h1>

        <p className="ui-lead">
          Packages, menus and event rentals from one team. Pick your date and we
          build the quote around it.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/book" className="ui-btn ui-btn-accent">Check a date</Link>
          <Link to="/packages" className="ui-btn ui-btn-outline">Browse packages</Link>
        </div>

        <div className="lp-stats">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="lp-stat-value">{s.value}</p>
              <p className="lp-stat-label">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="lp-hero-media">
        {/* Decorative: the copy carries the meaning, so the whole stack is hidden
            from assistive tech rather than captioned. */}
        <div className="lp-hero-layers" aria-hidden="true">
          {media.map((m, i) =>
            m.type === 'image' ? (
              <div
                key={`${m.src}-${i}`}
                className={`lp-hero-layer${i === index ? ' is-on' : ''}`}
                style={{ backgroundImage: `url(${m.src})` }}
              />
            ) : (
              <video
                key={`${m.src}-${i}`}
                ref={(el) => { videoRefs.current[i] = el; }}
                className={`lp-hero-layer${i === index ? ' is-on' : ''}`}
                src={m.src}
                poster={m.poster}
                /* Muted is not a preference: AmbientAudio already owns sound on
                   this page, and a second source would talk over it. muted +
                   playsInline are also what make autoplay legal on mobile. */
                muted
                playsInline
                loop
                preload="metadata"
              />
            ),
          )}
        </div>

        {/* Above every media layer, and still interactive — the calendar lives here. */}
        <div className="lp-hero-fore">{children}</div>
      </div>
    </section>
  );
}

export default LandingHero;
