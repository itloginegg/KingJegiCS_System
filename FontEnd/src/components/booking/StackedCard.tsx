import type { HeroCard, HeroCardAction } from './heroTypes';

/**
 * One card in the hero's left-hand stack.
 *
 * A real <button>, not a clickable <div> — the version this replaces used
 * `<div onClick>`, which is unreachable by keyboard and announces as nothing.
 * The whole card is the hit target, so the button carries the layout.
 *
 * Radius is --r-xl (20px), the top of the token scale. 24px would sit 4px
 * softer than every other card in the app with no token behind it.
 */
export function StackedCard({
  card,
  onSelect,
}: {
  card: HeroCard;
  onSelect: (action: HeroCardAction) => void;
}) {
  const Icon = card.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(card.action)}
      className={`group flex w-full items-start gap-5 rounded-[var(--r-xl)] border border-border p-8 text-left transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:outline-none ${card.surface}`}
    >
      {/* Graphic placeholder. The shape is decorative — the label beneath
          carries the meaning, so it is hidden from the accessibility tree. */}
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--r-lg)] border border-border bg-surface">
        <Icon
          size={22}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-text-secondary transition-colors group-hover:text-accent"
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-3">
        <span
          className="text-[0.82rem] leading-relaxed text-text-secondary"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {card.description}
        </span>
        <span
          className="text-[1.15rem] leading-tight font-semibold text-text-primary"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {card.label}
        </span>
      </span>
    </button>
  );
}
