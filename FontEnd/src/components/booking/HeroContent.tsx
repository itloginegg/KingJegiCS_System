import { ArrowUpRight, Flame } from 'lucide-react';

/**
 * The hero's right column: eyebrow, heading, CTA pill, footer.
 *
 * Typography note — the heading keeps the site's display face (Cormorant
 * Garamond) and the italic accent-coloured second word, rather than the
 * uppercase sans the reference layout implies. That treatment is what ties this
 * page to the landing page, and Inter here would read as a different product.
 */
export function HeroContent({ onPrimaryAction }: { onPrimaryAction: () => void }) {
  return (
    <div className="flex h-full min-h-[inherit] flex-col">
      {/* ── top half: centred ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          <Flame size={13} aria-hidden="true" className="text-accent" />
          <span className="text-[0.58rem] font-semibold tracking-[0.3em] text-text-secondary uppercase">
            Start here
          </span>
        </span>

        <h1
          className="text-[clamp(2.8rem,5.5vw,4.5rem)] leading-[1.08] font-normal text-balance text-text-primary"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Book Your <em className="text-accent italic">Experience</em>
        </h1>

        {/* CTA pill. The copy sits left and must wrap without pushing the
            button off the edge, hence min-w-0 on the text and shrink-0 on the
            circle — at ~360px the pill is only just wider than the button. */}
        <div className="flex w-full max-w-[560px] items-center gap-4 rounded-full border border-glass-border bg-glass py-3 pr-3 pl-6">
          <p
            className="min-w-0 flex-1 text-left text-[0.85rem] leading-relaxed text-text-secondary"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Choose the service that fits your occasion. We&rsquo;ll guide you through
            every detail.
          </p>
          {/* No destination of its own — it starts the most common flow, the
              same one card 1 starts, rather than being a dead control. */}
          <button
            type="button"
            onClick={onPrimaryAction}
            aria-label="Start a full event catering booking"
            className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-text transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:outline-none"
          >
            <ArrowUpRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── footer: pinned bottom ── */}
      <div className="mt-10 border-t border-border pt-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span
              className="text-[0.58rem] font-bold tracking-[0.24em] text-text-muted uppercase"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Prepared by experts
            </span>
            {/* Decorative step indicator — the wizard's real position is step
                state, which this hero is not part of. Not a control, so no
                buttons and no tab stops. */}
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="h-1.5 w-1.5 rounded-full border border-border" />
              <span className="h-1.5 w-1.5 rounded-full border border-border" />
            </span>
          </div>

          {/* Centre and right are intentionally empty — the reference's portrait
              is excluded by instruction, and nothing was specified for the
              right. Left empty rather than filled with invented content. */}
          <div />
        </div>
      </div>
    </div>
  );
}
