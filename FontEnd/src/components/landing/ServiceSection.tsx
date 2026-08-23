import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { CollidingBlobsCanvas } from './CollidingBlobsCanvas';

/**
 * The three offerings, as headed copy columns rather than icon cards.
 *
 * Kept as data so the top row stays a map rather than three near-identical blocks.
 */
const OFFERINGS = [
  {
    title: 'Catering Service',
    body:
      'Full-service Filipino catering for any occasion — buffet, plated, or family-style. '
      + 'Fresh ingredients, professional staff, and a setup that fits the room you have.',
  },
  {
    title: 'Catering Packages',
    body:
      'Curated all-in-one packages covering food, setup, and service staff. Choose Starter, '
      + 'Classic, or Premium and we handle the rest from arrival to pack-down.',
  },
  {
    title: 'Party Rentals',
    body:
      'Tables, chairs, tents, sound systems, and décor — everything you need to turn any '
      + 'space into a room your guests remember.',
  },
];

/**
 * Team photographs, served from public/gallery.
 *
 * Alt text describes the crew and the setting rather than saying "team photo": these
 * are real staff at real events, and that is the part a screen-reader user is missing.
 */
const GALLERY_FRAMES = [
  {
    src: '/gallery/team-wedding-setup.jpg',
    alt: 'The King Jegi crew in black-and-burgundy uniforms at a wedding reception, '
      + 'photographed in front of the floral backdrop and cake table they set up.',
  },
  {
    src: '/gallery/team-function-hall.jpg',
    alt: 'Eleven King Jegi servers and kitchen staff lined up beside a laid buffet '
      + 'in a function hall, before guests arrive.',
  },
];

/**
 * The "what we offer" section.
 *
 * The seven-layer background (three colour-mix radials, a linear wash, the blob
 * canvas, an SVG noise plate, a backdrop blur, two edge fades and a vignette) is
 * carried over unchanged from the original inline section. It is what ties this
 * section visually to #packages and the rest of the page — only the content inside
 * it was rebuilt. Flattening to a plain `bg-bg` would strand this section as the one
 * flat panel on an otherwise layered page.
 *
 * Content uses Tailwind utilities over the token bridge, which diverges from
 * LandingPage's inline-style regime; see the note in the section header comment there.
 */
export function ServiceSection() {
  return (
    <section
      id="services"
      style={{
        padding: '6rem 0',
        position: 'relative',
        overflow: 'hidden',
        background: `
          radial-gradient(ellipse 80% 60% at 15% 20%,  color-mix(in srgb, var(--primary) 22%, transparent) 0%, transparent 70%),
          radial-gradient(ellipse 60% 50% at 85% 75%,  color-mix(in srgb, var(--accent)  18%, transparent) 0%, transparent 65%),
          radial-gradient(ellipse 50% 40% at 50% 110%, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 60%),
          linear-gradient(160deg, var(--bg) 0%, var(--bg-subtle) 50%, color-mix(in srgb, var(--bg) 85%, var(--primary)) 100%)
        `,
      }}
    >
      <CollidingBlobsCanvas />

      {/* noise plate */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, zIndex: 1, opacity: 0.032, pointerEvents: 'none',
          backgroundImage:
            `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='340'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '220px 220px',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
          backdropFilter: 'blur(24px) saturate(1.4) brightness(1.04)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.4) brightness(1.04)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '38%', zIndex: 4, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--primary) 7%, transparent) 0%, transparent 100%)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', zIndex: 4, pointerEvents: 'none',
          background: 'linear-gradient(to top, color-mix(in srgb, var(--accent) 6%, var(--bg)) 0%, transparent 100%)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 45%, color-mix(in srgb, var(--bg) 55%, transparent) 100%)',
        }}
      />

      {/* Raised panel over the layered ground.
          Deliberately NO backdrop-filter: this section already carries a full-width
          blur(24px) layer at z-index 2, and the content sits above it at z-5 — so a
          nested blur here would sample the gradients AND the animated
          CollidingBlobsCanvas, re-running a large blur pass every frame on the first
          section a visitor sees. --glass is semi-opaque instead: same lift, no
          per-frame cost. */}
      <div className="relative z-[5] mx-auto w-full max-w-[1200px] px-6 sm:px-10">
        <div className="rounded-3xl border border-glass-border bg-glass p-8 sm:p-12">
          {/* ── top row: three offering columns ── */}
          <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-12">
            {OFFERINGS.map((o) => (
              <div key={o.title}>
                <h3 className="text-lg font-semibold tracking-tight text-accent sm:text-xl">
                  {o.title}
                </h3>
                <p className="mt-3 text-left text-sm leading-relaxed text-text-secondary">
                  {o.body}
                </p>
              </div>
            ))}
          </div>

          {/* ── bottom row: gallery + about ── */}
          <div className="mt-16 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-14">
            {/* The divider between the two frames is bg-bg, not a border: it reads as a
                gap cut through the panel, so it inverts with the theme rather than
                staying a fixed grey line. */}
            <div className="overflow-hidden rounded-2xl border border-border bg-bg-subtle">
              <div className="flex flex-col gap-3 bg-bg">
                {GALLERY_FRAMES.map((frame) => (
                  <img
                    key={frame.src}
                    src={frame.src}
                    alt={frame.alt}
                    loading="lazy"
                    decoding="async"
                    /* Fixed height + object-cover so two photos of differing aspect
                       ratios still stack as an even pair; bg-bg-subtle shows through
                       while the image is still loading rather than a white flash. */
                    className="h-48 w-full bg-bg-subtle object-cover sm:h-56"
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col items-start justify-center">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                About Us
              </p>
              <h2
                className="mt-3 text-3xl font-medium leading-tight text-text-primary sm:text-4xl"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                What Makes our Service Great!
              </h2>
              <p className="mt-5 text-sm leading-relaxed text-text-secondary">
                We cook the way a Filipino household cooks for the people it loves — in
                quantity, on time, and without cutting the corner nobody sees. Every event
                gets the same kitchen, the same staff standards, and a coordinator who
                answers the phone on the day itself.
              </p>
              <Link
                to="/packages"
                className="mt-8 inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-5 py-2.5 text-sm font-medium text-text-primary transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Learn More
                <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ServiceSection;
