import type { AdminMenuItem } from '../api/menuAdminApi';

/**
 * Today's Feature picks one dish per calendar day.
 *
 * Deliberately a hash of the date rather than `Math.random()`: the dish has to
 * survive a reload, so every visitor on the same day sees the same feature and
 * it rolls over at midnight.
 *
 * Note the emergent behaviour, which is kept on purpose: because `h*31 + c`
 * shifts by exactly one when the day-of-month digit increments, consecutive
 * days step one place through the sorted list. That makes the feature a clean
 * rotation rather than a random draw — no repeats on consecutive days, and
 * every dish gets equal exposure. Month boundaries jump, which is fine.
 */
function hashDateKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * @param dateKey a local `YYYY-MM-DD` day, not a UTC timestamp — the feature
 *                should turn over at the visitor's midnight.
 */
export function pickFeatureOfTheDay(
  items: AdminMenuItem[],
  dateKey: string,
): AdminMenuItem | null {
  const candidates = items
    // Same rule MenuPage uses for à-la-carte: a dish with no standalone price is
    // package-only and has nothing to show here.
    .filter((i) => i.isActive && i.pricePerTray != null)
    // Sorted so the order the API happens to return rows in can't shift the pick.
    .sort((a, b) => a.id.localeCompare(b.id));

  if (candidates.length === 0) return null;
  return candidates[hashDateKey(dateKey) % candidates.length];
}
