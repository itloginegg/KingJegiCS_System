import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getApprovedTestimonials, type PublicTestimonial } from '../../api/testimonialsApi';
import { AmbientCanvas } from './AmbientCanvas';
import { SectionHeading } from './SectionHeading';

/**
 * Fallback copy only.
 *
 * The section renders approved reviews from /api/Testimonials/approved; these stand
 * in while they load and if the business has not approved any of its own yet, so
 * the section is never visibly empty.
 */
const FALLBACK = [
  {
    id: 'fallback-1',
    name: 'Maria Santos',
    caption: 'Wedding · 150 guests',
    quote: 'King Jegi made our wedding feast unforgettable. Guests are still talking about the lechon months later!',
    initials: 'MS',
  },
  {
    id: 'fallback-2',
    name: 'Jerome dela Cruz',
    caption: 'Corporate Event · 80 guests',
    quote: 'Professional from quotation to cleanup. The buffet setup looked stunning and everything was served on time.',
    initials: 'JD',
  },
  {
    id: 'fallback-3',
    name: 'Ana Reyes',
    caption: 'Birthday · 60 guests',
    quote: "Farm-fresh talaga ang lasa! The team handled everything so I could actually enjoy my daughter's party.",
    initials: 'AR',
  },
];

/** Pixels a second. Slow enough to read a quote as it passes. */
const SPEED = 45;
/**
 * How sharply the marquee changes speed, as a time constant in seconds.
 *
 * The pause is an ease, not a freeze: hovering pulls the target speed to zero and
 * the track coasts down to it over roughly three tau — about a second — then eases
 * back up the same way. `animation-play-state: paused` cannot do this, which is why
 * the CSS keyframe this replaced is gone: a CSS animation outranks an inline
 * transform, so the two cannot share the track.
 */
const EASE_TAU = 0.32;
/** Cards a run needs before it is wider than any viewport it has to fill. */
const MIN_RUN = 6;

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();

/**
 * Client stories, on the plum band.
 *
 * One quote leads at 1.6fr with the opening mark and display-face type; two more
 * stack beside it, dropped 30px. The previous build put three equal cards on the
 * light ground, which gave the section no focal point and no tonal break between
 * the menu above and the closing band below — the page ran four light sections in
 * a row. The band carries `.dark-band` so it stays dark in both themes.
 *
 * The star row is gone: the design leads on the words, and a rating repeated on
 * every card was the thing competing with them.
 */
export function TestimonialsSection() {
  /* Approved reviews, newest first. Owns its own fetch: nothing else on the page
     reads them, and keeping the call here is what lets the whole section — data
     and markup — move as one unit. */
  const [reviews, setReviews] = useState<PublicTestimonial[]>([]);

  useEffect(() => {
    let cancelled = false;
    getApprovedTestimonials(6)
      .then((rows) => { if (!cancelled) setReviews(rows); })
      .catch(() => { /* keep the fallback copy */ });
    return () => { cancelled = true; };
  }, []);

  const cards = reviews.length > 0
    ? reviews.map((r) => ({
        id: r.id,
        quote: r.body,
        name: r.authorName,
        caption: new Date(r.submittedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' }),
        initials: initialsOf(r.authorName),
      }))
    : FALLBACK;

  /**
   * The marquee's repeating unit.
   *
   * Two things have to hold for the loop to be seamless. The track is exactly two
   * identical runs and slides by half its width, so the moment it snaps back is the
   * moment the second run is sitting where the first one started — nothing moves on
   * screen. And the asymmetry has to be a function of the index WITHIN a run, never
   * of the index across the whole track, or the two halves would not match and the
   * seam would show as a jump every cycle.
   *
   * A short list is padded up to MIN_RUN first: three cards make a run narrower than
   * the container, which would leave a visible hole rather than a queue.
   */
  const run = useMemo(() => {
    if (cards.length === 0) return [];
    const copies = Math.max(1, Math.ceil(MIN_RUN / cards.length));
    return Array.from({ length: cards.length * copies }, (_, i) => cards[i % cards.length]);
  }, [cards]);

  const trackRef = useRef<HTMLDivElement>(null);
  /** Where the track is, how fast it is going, and how fast it wants to be going. */
  const offset = useRef(0);
  const speed = useRef(0);
  const wanted = useRef(SPEED);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    const track = trackRef.current;
    if (!track || reducedMotion) return;

    /* One run's width — the distance after which the second run is sitting exactly
       where the first started, so resetting by it moves nothing on screen. Measured
       rather than assumed: card widths are clamps of the viewport. */
    let runWidth = 0;
    const measure = () => {
      const first = track.firstElementChild as HTMLElement | null;
      runWidth = first ? first.getBoundingClientRect().width : 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;

      /* Exponential approach, framed in dt rather than per-frame, so the ease takes
         the same wall-clock time at 60Hz and at 144Hz. */
      speed.current += (wanted.current - speed.current) * (1 - Math.exp(-dt / EASE_TAU));
      offset.current -= speed.current * dt;
      if (runWidth > 0 && -offset.current >= runWidth) offset.current += runWidth;

      track.style.transform = `translate3d(${offset.current.toFixed(2)}px, 0, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [reducedMotion]);

  if (run.length === 0) return null;

  /* Hover and focus both aim the track at a standstill; leaving aims it back at
     speed. Nothing is set directly — the loop above eases toward whatever is here,
     so an interrupted pause resumes from whatever speed it had reached. */
  const slow = () => { wanted.current = 0; };
  const resume = () => { wanted.current = SPEED; };

  return (
    <section className="ui-section lp-testi-band dark-band">
      <AmbientCanvas variant="rain" />
      <div className="ui-wrap lp-testi-fore">
        {/* The same ruled header every other section carries. It reads band tokens
            rather than the page ones — see the .dark-band block in index.css: the
            rose kicker is 3.1:1 on this ground, so it becomes the amber. The aside
            is a plain span, not a link: there is no testimonials page to send
            anyone to, and a dead "see all" is worse than none. */}
        <SectionHeading
          kicker="Client stories"
          title="What clients say after"
          aside={<span className="lp-testi-stat">500+ events · 4.9 average</span>}
        />

        {/* tabIndex so the marquee is reachable, because :focus-within is what pauses
            it for anyone not using a pointer. The cards hold no interactive content,
            so without this there would be nothing inside to focus and no way to stop
            moving text from the keyboard. */}
        <div
          className="lp-testi-marquee"
          role="group"
          aria-label="Client stories, scrolling automatically. Focus or hover to pause."
          tabIndex={0}
          onPointerEnter={slow}
          onPointerLeave={resume}
          onFocus={slow}
          onBlur={resume}
        >
          <div className="lp-testi-track" ref={trackRef}>
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className="lp-testi-run"
                /* The second run is the same quotes again — present so the loop has
                   something to hand over to, hidden so a screen reader does not read
                   the section twice. */
                aria-hidden={copy === 1 || undefined}
              >
                {run.map((t, i) => (
                  <figure
                    key={`${copy}-${t.id}-${i}`}
                    className={[
                      'lp-testi-card',
                      /* Every third card leads: wider, and it keeps the display face
                         and the opening mark the old bento gave its one lead quote.
                         The rhythm repeats with the run, so the loop still matches. */
                      i % 3 === 0 ? 'lp-testi-card--lead' : '',
                      i % 2 === 1 ? 'lp-testi-card--drop' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {i % 3 === 0 && (
                      <span className="lp-testi-mark" aria-hidden="true">&ldquo;</span>
                    )}
                    <blockquote className="lp-testi-card-quote">{t.quote}</blockquote>
                    <figcaption className="lp-testi-who2">
                      <span
                        className={`lp-avatar-band lp-avatar-band--${i % 3 === 0 ? 'lg' : 'sm'}`}
                        aria-hidden="true"
                      >
                        {t.initials}
                      </span>
                      <span>
                        <span className="lp-testi-name2">{t.name}</span>
                        <span className="lp-testi-meta2">{t.caption}</span>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default TestimonialsSection;
