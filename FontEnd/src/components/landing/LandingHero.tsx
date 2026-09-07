import { useEffect, useRef, useState } from 'react';
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
   * Background layers, cycled in order.
   *
   * A list rather than the old `image: string`, because a `<video>` cannot be a
   * CSS `background-image` — mixing the two means real stacked elements, not a
   * value swap. A single-entry list is the old behaviour and never cycles.
   */
  media: HeroMedia[];
}

/** Read once per mount; the preference does not change mid-session in practice. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The hero: one centred column over full-bleed media.
 *
 * Previously a two-column split with the live date picker in the right column, so
 * that "is my date free" was answerable in the fold. The picker now has its own
 * section below — see AvailabilitySection, and the note in LandingPage about what
 * that costs. What is left here is the pitch, so it takes the whole width and the
 * media runs behind all of it rather than beside it.
 *
 * The `children` prop went with the calendar: this component no longer has a slot,
 * and LandingPage renders `<LandingHero media={HERO_MEDIA} />` self-closing.
 *
 * Legibility over playing video is a CSS concern, not a JS one — one scrim built
 * from --bg sits between the layers and this copy, at an opacity chosen so the
 * text clears 4.5:1 against any frame. The ambience then paints over that scrim,
 * so it counts as part of the text's background too, which is what sets the lead
 * and the stat labels to --text-primary. See the .lp-hero block in landing.css.
 */
export function LandingHero({ media }: LandingHeroProps) {
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
      {/* Full-bleed, behind the copy rather than beside it. Decorative: the copy
          carries the meaning, so the whole stack is hidden from assistive tech
          rather than captioned. */}
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

      {/* Ambience, over the scrim rather than under it — beneath a 0.72 veil the
          effect's own 0.05–0.10 alphas land near 0.02 and it is invisible. Default
          variant="auto", which is the whole point here: a slow warm glow in --accent
          and --gold-on-band under the light theme, rain in --band-text under the
          dark one. The component owns the theme read, the reduced-motion opt-out and
          the IntersectionObserver that stops the loop when the hero scrolls away. */}
      <div className="lp-hero-ambient" aria-hidden="true">
        <AmbientCanvas />
      </div>

      <div className="lp-hero-copy">
        <div className="ui-pill">
          <span className="ui-pill-dot" aria-hidden="true" />
          <span className="ui-pill-text">Catering &amp; events · Calamba, Laguna</span>
        </div>

        <h1 className="ui-h1">The fresh feasts, handled end to end.</h1>

        <p className="ui-lead">
          Packages, menus and event rentals from one team. Pick your date and we
          build the quote around it.
        </p>

        <div className="lp-hero-actions">
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
    </section>
  );
}

export default LandingHero;
