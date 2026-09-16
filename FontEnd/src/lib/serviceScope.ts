/**
 * Service scope and serving style — the values the backend's ServiceScope and
 * ServingStyle enums take, with the words the wizard and the admin show for them.
 *
 * Scope is a fact about a full-service booking's lines, not a booking type: all three
 * are BookingType 'FullService'. A booking made before scope existed has none, and
 * reads as Full Event.
 */

export type ServiceScope = 'FullEvent' | 'StylingOnly' | 'CateringOnly';

/** No drop-off: food with no on-site service is a FoodDelivery order, not a serving style. */
export type ServingStyle = 'Buffet' | 'Plated' | 'FamilyStyle';

export const SERVICE_SCOPES: { value: ServiceScope; label: string; icon: string; includes: string; excludes: string }[] = [
  {
    value: 'FullEvent',
    label: 'Full Event Catering',
    icon: '🍽️',
    includes: 'Food and styling: menu, serving staff, motif, decor and furniture.',
    excludes: 'Everything in one booking.',
  },
  {
    value: 'StylingOnly',
    label: 'Event Styling Only',
    icon: '🎀',
    includes: 'Motif and theme, decor, furniture and setup.',
    excludes: 'No food. Add a menu later and it becomes Full Event Catering.',
  },
  {
    value: 'CateringOnly',
    label: 'Catering Alone',
    icon: '🥘',
    includes: 'Menu, headcount and on-site serving staff.',
    excludes: 'No styling by default. You can still add a backdrop or motif.',
  },
];

export const SERVING_STYLES: { value: ServingStyle; label: string; description: string }[] = [
  { value: 'Buffet', label: 'Buffet', description: 'Guests serve themselves from a spread.' },
  { value: 'Plated', label: 'Plated', description: 'Each course is served at the table by waiters.' },
  { value: 'FamilyStyle', label: 'Family style', description: 'Shared platters on each table, passed around.' },
];

export const scopeIncludesFood = (scope: ServiceScope | null | undefined) => scope !== 'StylingOnly';

/** Null (a booking made before scope existed) reads as Full Event. */
export const scopeLabel = (scope: string | null | undefined) =>
  SERVICE_SCOPES.find((s) => s.value === scope)?.label ?? 'Full Event Catering';

export const servingStyleLabel = (style: string | null | undefined) =>
  SERVING_STYLES.find((s) => s.value === style)?.label ?? null;
