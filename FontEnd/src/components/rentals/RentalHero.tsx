import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

/** Stock backdrop until a real asset is dropped in. */
const HERO_MEDIA_FALLBACK =
  'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=2000&q=80';

/**
 * Rentals hero — the same treatment as MenuPage's hero, token for token.
 *
 * The band is gone. It was here as the page's distinguishing device, and blush was
 * the closest the band could get to the menu hero's rose — --accent measures 2.7:1
 * against --band-bg, failing as text and failing the 3:1 floor even as a button
 * fill. That constraint is what kept the two catalog pages looking like different
 * sites in light mode: one inverted with pink chrome, one on the page ground with
 * rose. Off the band, --accent is simply available, so the two heroes now read the
 * same and follow the theme toggle together.
 *
 * Dropping `.dark-band` also drops its Navbar overrides, which is the visible half
 * of this change: the logo, the active link and the CTA go back to the tokens every
 * other page uses. The nav stays rendered INSIDE this section because it overlays
 * rather than stacks — the top padding below is what clears it.
 *
 * The scrim densities are MenuPage's, not the band's. A light ground needs a denser
 * veil than a dark one: the copy sits in the 95% zone so --text-primary clears AA
 * over any photograph behind it.
 */
export function RentalHero({
  query,
  onQueryChange,
  children,
  media,
}: {
  /** Raw search text. Owned by RentalPage — this input is fully controlled. */
  query: string;
  onQueryChange: (next: string) => void;
  /** Slot for the Navbar, so it inherits the band's colour overrides. */
  children?: ReactNode;
  /** Background layer. Omit for the stock photograph. */
  media?: { type: 'image'; src: string } | { type: 'video'; src: string; poster?: string };
}) {
  return (
    <section className="relative overflow-hidden bg-[var(--bg-subtle)]">
      {/* Background media, behind everything. The blush stays as the section fill,
          so a slow or failed load degrades to the page's own tinted ground. */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        {media?.type === 'video' ? (
          <video
            className="h-full w-full object-cover"
            src={media.src}
            poster={media.poster}
            /* Muted is structural, not taste: autoplay is only legal muted. */
            muted
            playsInline
            loop
            autoPlay
            preload="metadata"
          />
        ) : (
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${media?.src ?? HERO_MEDIA_FALLBACK})` }}
          />
        )}
        {/* Derived from --bg-subtle, the ground this hero now sits on, rather than a
            black scrim: this band is LIGHT, and black over it would read as grey
            haze and drop the heading's contrast. Same densities MenuPage uses, kept
            dense enough that --text-primary clears AA over any photograph. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(100deg, color-mix(in srgb, var(--bg-subtle) 95%, transparent) 0%, color-mix(in srgb, var(--bg-subtle) 86%, transparent) 55%, color-mix(in srgb, var(--bg-subtle) 70%, transparent) 100%)',
          }}
        />
      </div>

      {children}

      {/* Top padding clears the Navbar, which overlays rather than stacks —
          same allowance MenuPage's hero makes. */}
      {/* Left-aligned at every width, like MenuPage's hero. Centring below md put the
          two catalog pages on different axes at the same viewport. */}
      <div className="relative z-10 mx-auto w-full max-w-[1200px] px-6 pt-[calc(4rem+80px)] pb-16 sm:px-10">
        <p
          className="mb-4 text-[0.6875rem] font-semibold tracking-[0.14em] text-[var(--accent)] uppercase"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Equipment for rent
        </p>

        <h1
          /* Weight, tracking, leading and clamp all taken from MenuPage's h1: it was
             400 with no tracking at 1.1, which read as a different typeface beside
             the menu hero's 600 at -0.04em. */
          className="mb-4 text-[clamp(2.375rem,5vw,3.875rem)] leading-[0.98] font-semibold tracking-[-0.04em] text-balance text-[var(--text-primary)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Everything but
          <br />
          the Venue.
        </h1>

        <p
          className="mb-8 max-w-[560px] text-[1.0625rem] leading-[1.6] text-[var(--text-secondary)]"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Tables, chairs, linens, sound, and styling — rented per day, delivered, set
          up, and picked up by our own crew.
        </p>

        {/* Submitting is a no-op: filtering is live off the debounced query, and the
            button is the affordance for anyone who expects to press it. The <form>
            is still real so Enter does not reload the page. */}
        {/* --border-strong, the same hairline MenuPage's search carries. It is what
            separates the white pill from the tinted ground it now sits on. */}
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className="flex w-full max-w-[620px] items-center gap-2.5 rounded-full border border-[var(--border-strong)] bg-surface py-1.5 pr-1.5 pl-5"
        >
          <label htmlFor="rental-search" className="sr-only">
            Search equipment for rent
          </label>
          <Search size={17} aria-hidden="true" className="shrink-0 text-text-muted" />
          <input
            id="rental-search"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search chairs, tables, linens or equipment…"
            /* The ring replaces the suppressed outline rather than removing the
               focus indicator outright. */
            className="min-w-0 flex-1 rounded-full border-none bg-transparent px-1 text-[0.9rem] text-text-primary placeholder:text-text-dim focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          />
          {/* --accent with --accent-text, the pairing MenuPage's search button uses.
              Both flip together with the theme, so the label is white on the rose in
              light and dark on the blush in dark — one declaration, both cases. */}
          <button
            type="submit"
            className="shrink-0 cursor-pointer rounded-full bg-accent px-6 py-2.5 text-[0.8rem] font-semibold text-[var(--accent-text)] transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Search
          </button>
        </form>
      </div>
    </section>
  );
}
