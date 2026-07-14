/**
 * View-model types consumed by the landing page components.
 * These are the *display* shapes — `src/utils/api.ts` maps the backend's raw
 * JSON payloads into these, so components never deal with decimals/Guids/etc.
 */

/** A catering package card ("Starter / Classic / Premium"). */
export interface ManagedPackage {
  id: string;
  name: string;
  /** Pre-formatted for display, e.g. "₱25,000". */
  price: string;
  description: string;
  /** e.g. "50–100 pax" — handy for the card subtitle. */
  paxRange: string;
  inclusions: string[];
}

/** A menu tier / tray preview card ("Chicken Package", "Beef Package", …). */
export interface ManagedMenu {
  id: string;
  /** Display name of the tier — comes from the backend's TrayName. */
  tier: string;
  /** Pre-formatted for display, e.g. "₱2,800". */
  price: string;
  /** e.g. "Serves 8–10". */
  serves: string;
}

/** An approved testimonial as rendered on the landing page. */
export interface Testimonial {
  id: string;
  name: string;
  event: string;
  quote: string;
  initials: string;
  rating: number;
}
