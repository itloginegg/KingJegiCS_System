import { Circle, Square, Triangle } from 'lucide-react';
import { HeroContent } from './HeroContent';
import { StackedCard } from './StackedCard';
import type { HeroCard, HeroCardAction } from './heroTypes';

/**
 * The three service cards.
 *
 * Client-side navigation, not entities — nothing is fetched and no DTO is
 * involved. Copy is verbatim from the production strings this replaces.
 *
 * The icons are the reference's geometric placeholders rather than semantic
 * icons: cards 2 and 3 are specified as "small triangle" and "circular", so
 * card 1 takes Square to complete the set. If these should be meaningful icons
 * instead (PartyPopper / Armchair / Lightbulb, matching the emoji they
 * replace), it is a one-line change each.
 */
export const HERO_CARDS: HeroCard[] = [
  {
    id: 'event',
    label: 'Full Event Catering',
    description:
      'Complete event packages with staff, styling, and curated menus for any occasion.',
    icon: Square,
    action: { kind: 'flow', flow: 'event' },
    surface: 'bg-bg-card',
  },
  {
    id: 'rentals',
    label: 'Rental Items Only',
    description: 'Tables, chairs, linens, and decor — delivered to your venue.',
    icon: Triangle,
    action: { kind: 'flow', flow: 'rentals' },
    surface: 'bg-primary-muted',
  },
  {
    id: 'plan',
    label: 'Plan by Budget',
    description:
      "Tell us your budget — we'll suggest complete, kitchen-priced options you can book.",
    icon: Circle,
    action: { kind: 'plan' },
    surface: 'bg-accent-muted',
  },
];

/**
 * Hero shell: card stack left, content right.
 *
 * The asymmetric 4/8 split is the primary target rather than a desktop
 * enhancement — the single-column stack below `lg` is the fallback. Breaking at
 * `lg` and not `md`: at 768px a 4-column card stack leaves the descriptions
 * about 230px wide, which wraps them to five lines.
 */
export function HeroLayout({
  cards,
  onSelect,
  onPrimaryAction,
}: {
  cards: HeroCard[];
  onSelect: (action: HeroCardAction) => void;
  /** The CTA circle's action — wired to the same flow as card 1. */
  onPrimaryAction: () => void;
}) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
      <div className="flex flex-col gap-5 lg:col-span-4">
        {cards.map((card) => (
          <StackedCard key={card.id} card={card} onSelect={onSelect} />
        ))}
      </div>

      <div className="lg:col-span-8">
        <HeroContent onPrimaryAction={onPrimaryAction} />
      </div>
    </div>
  );
}
