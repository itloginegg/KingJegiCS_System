/**
 * Philippine mobile number formatting — one implementation for every form.
 *
 * Two representations, deliberately kept apart:
 *
 *   display  "+63 917-123-4567"  what the user types and sees
 *   E.164    "+639171234567"     what strict backends demand
 *
 * `BookingCreateDto.ContactNumber` is only `[MaxLength(30)]`, so it takes the
 * display form as-is. `CustomerRegistrationDto` / `WalkInCustomerDto` carry a
 * `^\+[1-9]\d{6,14}$` regex, so those call sites must submit `toE164()`.
 */

/** The only country code the business serves. */
const PH_DIAL = '+63';

/** Local subscriber numbers are 10 digits (9XX XXX XXXX). */
const PH_LOCAL_DIGITS = 10;

export const PH_PHONE_PLACEHOLDER = '+63 000-000-0000';

/**
 * Strips everything down to the local subscriber digits, tolerating the three
 * ways people write the same number: `+63 917…`, `0917…`, and bare `917…`.
 */
export function phLocalDigits(input: string): string {
  let digits = (input ?? '').replace(/\D/g, '');
  if (digits.startsWith('63')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, PH_LOCAL_DIGITS);
}

/**
 * Live input mask. Grows with the user rather than demanding a complete number,
 * so partial input stays editable: "9" → "+63 9", "917123" → "+63 917-123".
 * An empty field stays empty so a placeholder can show and "optional" stays
 * genuinely optional.
 */
export function formatPhPhone(input: string): string {
  const d = phLocalDigits(input);
  if (d.length === 0) return '';
  if (d.length <= 3) return `${PH_DIAL} ${d}`;
  if (d.length <= 6) return `${PH_DIAL} ${d.slice(0, 3)}-${d.slice(3)}`;
  return `${PH_DIAL} ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Display form → `+639171234567`. Empty in, empty out. */
export function toE164(input: string): string {
  const d = phLocalDigits(input);
  return d.length === 0 ? '' : `${PH_DIAL}${d}`;
}

/** True once a full 10-digit local number has been entered. */
export function isCompletePhPhone(input: string): boolean {
  return phLocalDigits(input).length === PH_LOCAL_DIGITS;
}
