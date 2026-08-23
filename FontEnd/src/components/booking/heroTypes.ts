import type { LucideIcon } from 'lucide-react';

/**
 * Which booking flow a hero card starts.
 *
 * Lives here rather than in BookingPage so the hero components and the page can
 * both name it without the components importing from a page module. BookingPage
 * re-exports nothing — it imports this and uses it exactly as before.
 *
 * Maps to the backend `BookingType` enum downstream at SUBMIT time, not here:
 * 'event' → FullService, 'rentals' → RentalService. `FoodDelivery` is a fourth
 * BookingType that this picker deliberately does not offer.
 */
export type ServiceFlow = 'event' | 'rentals';

/**
 * What a card does when clicked.
 *
 * A discriminated union rather than a bare callback because the third card is
 * NOT like the other two: 'flow' advances the wizard to step 1, while 'plan'
 * swaps the entire card grid out for <PlanByBudget />. Modelling that as one
 * uniform onClick is how the Plan-by-Budget flow gets silently broken.
 */
export type HeroCardAction =
  | { kind: 'flow'; flow: ServiceFlow }
  | { kind: 'plan' };

export interface HeroCard {
  id: string;
  /** Bottom-right title, e.g. "Full Event Catering". */
  label: string;
  description: string;
  icon: LucideIcon;
  action: HeroCardAction;
  /**
   * Surface class for the card. Three token-backed fills — bg-bg-card,
   * bg-primary-muted, bg-accent-muted — rather than three invented colours.
   */
  surface: string;
}
