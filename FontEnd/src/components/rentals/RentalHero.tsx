import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

/**
 * Rentals hero — an inverted band, the same pattern as MenuPreviewSection and
 * MenuPage's hero.
 *
 * It carries the `.dark-band` class rather than a rentals-specific one. The band
 * tokens (--band-bg, --band-text, --band-muted) live in index.css and are scoped
 * to that class, so the three bands stay identical by construction: restyling the
 * band is one edit there, not three here. `.dark-band` also rebinds the Navbar's
 * link colours, which is why the nav is rendered INSIDE this section.
 *
 * The gold is --gold-on-band, not --accent and not --warning. --accent is the
 * bronze #79654e in light mode and reads 1.7:1 against --band-bg; --warning means
 * "needs attention" and spending it on ornament is how real warnings stop
 * registering. --gold-on-band exists for exactly this surface and nowhere else.
 */
export function RentalHero({
  query,
  onQueryChange,
  children,
}: {
  /** Raw search text. Owned by RentalPage — this input is fully controlled. */
  query: string;
  onQueryChange: (next: string) => void;
  /** Slot for the Navbar, so it inherits the band's colour overrides. */
  children?: ReactNode;
}) {
  return (
    <section className="dark-band relative overflow-hidden bg-[var(--band-bg)]">
      {children}

      {/* Top padding clears the Navbar, which overlays rather than stacks —
          same allowance MenuPage's hero makes. */}
      <div className="mx-auto w-full max-w-[1200px] px-6 pt-[calc(4rem+80px)] pb-16 text-center sm:px-10 md:text-left">
        <p
          className="mb-4 text-[0.62rem] font-semibold tracking-[0.3em] text-[var(--gold-on-band)] uppercase"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Equipment for rent
        </p>

        <h1
          className="mb-4 text-[clamp(2.4rem,5vw,3.8rem)] leading-[1.1] font-normal text-balance text-[var(--band-text)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Everything but
          <br />
          the Venue.
        </h1>

        <p
          className="mx-auto mb-8 max-w-[560px] text-[0.95rem] leading-[1.7] text-[var(--band-muted)] md:mx-0"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Tables, chairs, linens, sound, and styling — rented per day, delivered, set
          up, and picked up by our own crew.
        </p>

        {/* Submitting is a no-op: filtering is live off the debounced query, and the
            button is the affordance for anyone who expects to press it. The <form>
            is still real so Enter does not reload the page. */}
        {/* The pill's hairline is load-bearing in dark mode only: --surface
            (#1a1510) on --band-bg (#0A1F1D) separates by 1.1:1, so without an edge
            the pill dissolves into the band. In light it vanishes against white. */}
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className="mx-auto flex w-full max-w-[620px] items-center gap-2.5 rounded-full border border-[var(--band-border)] bg-surface py-1.5 pr-1.5 pl-5"
        >
          <label htmlFor="rental-search" className="sr-only">
            Search equipment for rent
          </label>
          <Search size={17} aria-hidden="true" className="shrink-0 text-text-dim" />
          <input
            id="rental-search"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search chairs, tables, linens or equipment…"
            /* The ring replaces the suppressed outline rather than removing the
               focus indicator outright. --accent is safe here despite the band:
               the input sits on --surface, not on --band-bg. */
            className="min-w-0 flex-1 rounded-full border-none bg-transparent px-1 text-[0.9rem] text-text-primary placeholder:text-text-dim focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          />
          {/* Dark text on the gold, not white: white on #DDA750 is 1.9:1.
              The ring is --band-text rather than --accent — inside the band
              --accent is the bronze #79654e, a 1.7:1 ring nobody can see. */}
          <button
            type="submit"
            className="shrink-0 cursor-pointer rounded-full bg-[var(--gold-on-band)] px-6 py-2.5 text-[0.8rem] font-semibold text-[var(--band-accent-text)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--band-text)] focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Search
          </button>
        </form>
      </div>
    </section>
  );
}
