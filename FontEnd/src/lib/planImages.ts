/**
 * Reference images (motif, theme) for planned bookings, held in memory until checkout.
 *
 * WHY IN MEMORY. A File can't be written to localStorage, and uploading needs a booking
 * id that only exists once checkout has placed the plan. So the files wait here, keyed
 * by the plan's cart key, and checkout uploads them after the booking is created. The
 * catch is honest and deliberate: a refresh, or a different tab, loses them. The plan
 * itself remembers the file NAMES (CartPlan.imageNames), which is how the cart and
 * checkout can tell a customer their images were lost rather than dropping them quietly.
 *
 * A module-level map rather than React state, so the files survive the route change
 * from /book to /cart to /checkout, which remounts every page.
 */

export interface PlanImages {
  motif: File | null;
  theme: File | null;
}

const held = new Map<string, PlanImages>();

/** Hold a plan's images. Holding none clears any it had. */
export function holdPlanImages(planKey: string, images: PlanImages): void {
  if (images.motif || images.theme) held.set(planKey, images);
  else held.delete(planKey);
}

/** The images still held for a plan, or null if there are none (or they were lost). */
export function peekPlanImages(planKey: string): PlanImages | null {
  return held.get(planKey) ?? null;
}

/** Forget a plan's images — it was removed, or its booking now has them. */
export function dropPlanImages(planKey: string): void {
  held.delete(planKey);
}

export function dropAllPlanImages(): void {
  held.clear();
}
