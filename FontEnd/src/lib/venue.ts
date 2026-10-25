/**
 * Venue / delivery address — one shape and one city list for every form.
 *
 * The business only serves part of Laguna, so the city is a closed list
 * rather than free text. The API stores a single `VenueAddress` string
 * (`[MaxLength(500)]`, nvarchar), so the parts are composed on submit.
 */

export interface VenueAddress {
  /** Optional place name ("Villa Rosa Events Place"); blank for a private home. */
  name: string;
  street: string;
  city: string;
  zip: string;
}

export const emptyVenueAddress: VenueAddress = { name: '', street: '', city: '', zip: '' };

/**
 * Sits between the venue name and the rest of the address. Never appears in a
 * street typed by hand, so parseVenueAddress can split on it without guessing.
 */
const NAME_SEPARATOR = ' — ';

export interface ServiceAreaCity {
  value: string;
  label: string;
  kind: 'city' | 'municipality';
}

/**
 * The Laguna lakeshore stretch the business serves, San Pedro down to Santa Cruz
 * along the national highway. `value` is what the API stores; `label` is what the
 * user reads. They differ where the name has an ñ (Biñan, Los Baños) so the
 * stored string stays ASCII, matching what BookingPage has always sent.
 */
export const SERVICE_AREA_CITIES: readonly ServiceAreaCity[] = [
  { value: 'Binan', label: 'Biñan', kind: 'city' },
  { value: 'Cabuyao', label: 'Cabuyao', kind: 'city' },
  { value: 'Calamba', label: 'Calamba', kind: 'city' },
  { value: 'San Pedro', label: 'San Pedro', kind: 'city' },
  { value: 'Santa Rosa', label: 'Santa Rosa', kind: 'city' },
  { value: 'Bay', label: 'Bay', kind: 'municipality' },
  { value: 'Calauan', label: 'Calauan', kind: 'municipality' },
  { value: 'Los Banos', label: 'Los Baños', kind: 'municipality' },
  { value: 'Pila', label: 'Pila', kind: 'municipality' },
  { value: 'Santa Cruz', label: 'Santa Cruz', kind: 'municipality' },
  { value: 'Victoria', label: 'Victoria', kind: 'municipality' },
];

export const SERVICE_AREA_NOTE = 'Currently catering from San Pedro to Santa Cruz, Laguna';

/**
 * "Villa Rosa — 123 Main St., Calamba, 4027" — blank parts are dropped, not left
 * dangling, so an address without a name reads exactly as it always has.
 */
export function composeVenueAddress(value: VenueAddress): string {
  const address = [value.street, value.city, value.zip]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
  const name = value.name.trim();
  return name && address ? `${name}${NAME_SEPARATOR}${address}` : name || address;
}

/** Street and city are the meaningful parts; zip is a nicety. */
export function isVenueAddressComplete(value: VenueAddress): boolean {
  return value.street.trim().length > 0 && value.city.trim().length > 0;
}

/**
 * The inverse of composeVenueAddress, for editing an address that was stored as one
 * string. Best effort, and deliberately forgiving: anything before the name
 * separator is the venue name, a trailing four-digit part is the zip, a part naming
 * a service-area city is the city, and everything else — commas included — stays
 * the street, so nothing typed is ever dropped.
 */
export function parseVenueAddress(text: string): VenueAddress {
  const at = text.indexOf(NAME_SEPARATOR);
  const name = at >= 0 ? text.slice(0, at).trim() : '';
  const rest = at >= 0 ? text.slice(at + NAME_SEPARATOR.length) : text;
  const parts = rest.split(',').map((part) => part.trim()).filter(Boolean);

  let zip = '';
  if (parts.length > 1 && /^\d{4}$/.test(parts[parts.length - 1])) zip = parts.pop() ?? '';

  let city = '';
  if (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase();
    const match = SERVICE_AREA_CITIES.find((c) => c.value.toLowerCase() === last || c.label.toLowerCase() === last);
    if (match) {
      city = match.value;
      parts.pop();
    }
  }

  return { name, street: parts.join(', '), city, zip };
}
