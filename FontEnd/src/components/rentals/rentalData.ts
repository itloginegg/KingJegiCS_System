import { getFullImageUrl, type AdminRentalItem } from '../../api/rentalAdminApi';

/**
 * Rental catalog types and the DTO→view mapping.
 *
 * The categories are the backend's `RentalCategory` enum verbatim
 * (Models/Rentalitem.cs), serialized by name through JsonStringEnumConverter.
 * They are NOT a presentation-layer list: the API filters and the admin
 * dashboard both speak these exact strings, so renaming one here would make the
 * customer-facing filter disagree with the inventory screen an owner edits.
 */
export type RentalCategory = 'Chairs' | 'Tables' | 'Linens' | 'Lights' | 'Others';

/**
 * Render order for the sidebar. Fixed rather than derived from the response, so
 * a category with nothing in it still lists at 0 instead of disappearing — a
 * filter list that changes shape as stock moves is hard to aim at.
 */
export const RENTAL_CATEGORIES: readonly RentalCategory[] = [
  'Chairs',
  'Tables',
  'Linens',
  'Lights',
  'Others',
] as const;

const CATEGORY_BY_KEY = new Map<string, RentalCategory>(
  RENTAL_CATEGORIES.map((c) => [c.toLowerCase(), c]),
);

export interface RentalItem {
  id: string;
  name: string;
  category: RentalCategory;
  /** Pesos per day, as a number. Formatting is the view's job — see formatPeso. */
  pricePerDay: number;
  /** Units on the shelf today: TotalQuantity − committed. Computed server-side. */
  stock: number;
  description: string;
  image: string | null;
}

/**
 * Peso formatter. Single source of truth for currency in this feature, so
 * "₱20.00" never appears as a literal in JSX — a card, a list row and a filter
 * label all round and group identically.
 */
export function formatPeso(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Rentalitem has no description column, so the card copy is derived from the
 * real inventory numbers rather than invented. Saying how many exist and how
 * many are already out is information the customer can act on; a generated
 * marketing sentence would be a claim the database cannot support.
 */
function describeItem(dto: AdminRentalItem, category: RentalCategory): string {
  const out =
    dto.quantityOut > 0 ? `, ${dto.quantityOut} currently out on other events` : '';
  return `${category} — ${dto.totalQuantity} in our inventory${out}.`;
}

/**
 * Maps one API row onto the shape the cards read.
 *
 * Unknown categories fall back to 'Others' rather than throwing: the enum can
 * gain a member server-side before this file knows about it, and one unfamiliar
 * string should cost that item its filter bucket, not blank the whole catalog.
 */
export function toRentalItem(dto: AdminRentalItem): RentalItem {
  const category = CATEGORY_BY_KEY.get(dto.category?.toLowerCase() ?? '') ?? 'Others';
  return {
    id: dto.id,
    name: dto.itemName,
    category,
    pricePerDay: dto.unitPrice,
    stock: dto.stock,
    description: describeItem(dto, category),
    /* Relative paths are resolved against the API origin, not the Vite origin —
       the images are served by the backend's wwwroot, on a different port. */
    image: getFullImageUrl(dto.imageUrl),
  };
}
