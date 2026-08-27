import { Images } from 'lucide-react';

/**
 * Packages hero: a headline with the gallery photo set inline as a pill.
 *
 * The pill inherits the job of the slideshow banner this replaces — it is the
 * only route to GalleryLightbox on this page. It keeps the banner's semantics
 * exactly: it advances on the same 5s timer (the caller still owns slideIndex,
 * so none of that state is orphaned) and opens the lightbox at the photo
 * currently showing, rather than always at zero.
 *
 * The warm wash is built from --accent-muted, the brand beige at 16%, rather
 * than the reference's #F5EEDB. The palette has no warm cream, and a literal
 * would not re-tint under .dark; the beige does, becoming gold.
 *
 * Headline is font-sans extrabold, not the display serif: Cormorant tops out at
 * 700 and is low-contrast, so it cannot render the weight this layout needs.
 * Card titles stay serif — see PackageCard.
 */
export function PackagesHero({
  photo,
  photoCount,
  hasGallery,
  onOpenGallery,
}: {
  /** Current slide URL — a real gallery photo, or a stock fallback. */
  photo: string;
  /** Only meaningful when hasGallery; names the count in the pill's label. */
  photoCount: number;
  hasGallery: boolean;
  onOpenGallery: () => void;
}) {
  const pillArt = (
    <span
      className="block h-full w-full bg-cover bg-center"
      style={{ backgroundImage: `url(${photo})` }}
      aria-hidden="true"
    />
  );

  return (
    <section className="relative overflow-hidden bg-bg pt-[calc(4rem+80px)] pb-20">
      {/* Warm wash fading into the body. Decorative, so it is out of the
          accessibility tree and cannot swallow a click. */}
      {/* Inline style rather than bg-gradient-to-b: that is the Tailwind v3
          utility name and this project is on v4, where it emits nothing. The
          stops are still tokens, so the wash re-tints from beige to gold under
          .dark exactly as a utility would. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[70%]"
        style={{
          background: 'linear-gradient(to bottom, var(--accent-muted), transparent)',
        }}
      />

      <div className="relative mx-auto w-full max-w-[1100px] px-6 text-center">
        <h1
          /* font-bold (700), not extrabold: this project's Tailwind build emits
             no font-extrabold utility, and index.css loads Inter at 300–700 only,
             so 800 would be a synthesised face rather than a real one. */
          className="font-sans text-[clamp(2.6rem,7.5vw,5rem)] leading-[1.02] font-bold tracking-tight text-text-primary"
          style={{ fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)' }}
        >
          {/* flex-wrap plus a non-shrinking pill: below ~640px the pill drops to
              its own line instead of squeezing into a sliver. */}
          <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <span>Find</span>

            {hasGallery ? (
              <button
                type="button"
                onClick={onOpenGallery}
                aria-label={`Open the Events by King Jegi gallery — ${photoCount} photo${photoCount === 1 ? '' : 's'}`}
                className="group relative h-[0.85em] w-[2.4em] shrink-0 overflow-hidden rounded-full border border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg focus-visible:outline-none"
              >
                {pillArt}
                {/* Reads as a control rather than decoration on hover/focus. */}
                <span className="absolute inset-0 flex items-center justify-center bg-[rgb(0_0_0/0.35)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Images size={18} className="text-[var(--primary-text)]" aria-hidden="true" />
                </span>
              </button>
            ) : (
              /* No photos published — the pill stays as art, matching the old
                 banner's inert-when-empty behaviour. */
              <span
                aria-hidden="true"
                className="block h-[0.85em] w-[2.4em] shrink-0 overflow-hidden rounded-full border border-border-strong"
              >
                {pillArt}
              </span>
            )}

            <span>Your</span>
          </span>

          <span className="mt-1 block">Perfect Package</span>
        </h1>
      </div>
    </section>
  );
}

/**
 * "What We Offer" — the white section header above the carousel.
 *
 * The sentence here was the hero's subheading until this refactor. It is moved,
 * not copied: the hero above now ends at the headline.
 */
export function OfferHeader() {
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 pt-20 pb-12 text-center">
      <span
        className="inline-block rounded-full bg-accent-muted px-4 py-1.5 text-[0.68rem] font-semibold tracking-[0.14em] text-accent uppercase"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        What We Offer
      </span>

      <h2
        className="mt-6 text-[clamp(1.6rem,3.4vw,2.5rem)] leading-[1.15] font-bold text-balance text-text-primary"
        style={{ fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)' }}
      >
        Offering packages tailored to your event size, style, and vision. Pick the one
        that fits &mdash; we&rsquo;ll handle the rest.
      </h2>
    </div>
  );
}
