/**
 * Date helpers for the availability calendar.
 *
 * Lifted out of LandingPage unchanged when the picker moved into the hero — the
 * hero and any future consumer need the same arithmetic, and leaving it inline
 * in a page component was the only reason it wasn't shared already.
 */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DAY_ABBR = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

/** Local-time ISO date (`2026-08-14`). Deliberately not toISOString(), which is UTC. */
export function toISO(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "2026-08-14" → "August 14, 2026". */
export function fmtSelected(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/**
 * A TimeOnly from the API → a compact clock label: "8 AM", "2:30 PM".
 *
 * Accepts both shapes because the API sends the first one: the project's
 * TimeOnlyJsonConverter writes 12-hour "h:mm tt", while raw TimeOnly elsewhere (and
 * anything hand-built) is "HH:mm:ss". Whole hours drop their ":00" so a list of
 * windows stays short.
 */
export function fmtClock(hms: string) {
  const twelveHour = hms.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
  if (twelveHour) {
    const [, hour, minute, period] = twelveHour;
    const suffix = period.toUpperCase();
    return minute === '00' ? `${Number(hour)} ${suffix}` : `${Number(hour)}:${minute} ${suffix}`;
  }

  const [h, m] = hms.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "8 AM–2 PM" — an en dash, no spaces, so a list of windows stays readable. */
export function fmtWindow(start: string, end: string) {
  return `${fmtClock(start)}–${fmtClock(end)}`;
}
