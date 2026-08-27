/**
 * Venue / delivery address — one shape and one city list for every form.
 *
 * The business only serves four Laguna cities, so the city is a closed list
 * rather than free text. The API stores a single `VenueAddress` string
 * (`[MaxLength(500)]`), so the parts are composed on submit.
 */

export interface VenueAddress {
  street: string;
  city: string;
  zip: string;
}

export const emptyVenueAddress: VenueAddress = { street: '', city: '', zip: '' };

/**
 * `value` is what the API stores; `label` is what the user reads. They differ
 * for Los Baños so the stored string stays ASCII, matching what BookingPage has
 * always sent.
 */
export const SERVICE_AREA_CITIES: readonly { value: string; label: string }[] = [
  { value: 'Calamba', label: 'Calamba' },
  { value: 'Cabuyao', label: 'Cabuyao' },
  { value: 'Santa Rosa', label: 'Santa Rosa' },
  { value: 'Los Banos', label: 'Los Baños' },
];

export const SERVICE_AREA_NOTE = 'Currently catering to the Laguna area only';

/** "123 Main St., Calamba, 4027" — blank parts are dropped, not left dangling. */
export function composeVenueAddress(value: VenueAddress): string {
  return [value.street, value.city, value.zip]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** Street and city are the meaningful parts; zip is a nicety. */
export function isVenueAddressComplete(value: VenueAddress): boolean {
  return value.street.trim().length > 0 && value.city.trim().length > 0;
}
