import { formatPeso, type RentalItem } from './rentalData';

export interface CartLine {
  item: RentalItem;
  quantity: number;
}

/**
 * Sum of the rental lines.
 *
 * quantity × unit price, with NO duration multiplier — this mirrors
 * Bookingservice.ComputeTotal, which sums `Rental.Subtotal`
 * (`RentalItem.UnitPrice * Quantity`) and never consults the booking's
 * delivery/pickup window. Multiplying by the rental length here would show a
 * figure the backend will not bill; see the note in CheckoutModal.
 */
export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.item.pricePerDay * l.quantity, 0);
}

export function cartPieces(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Floating summary bar, shown once anything is in the list.
 *
 * `role="status"` rather than a live region on the total alone: adding an item
 * changes the count and the amount together, and two separate announcements for
 * one action is noise.
 */
export function CartBar({
  lines,
  onClear,
  onCheckout,
}: {
  lines: CartLine[];
  onClear: () => void;
  onCheckout: () => void;
}) {
  if (lines.length === 0) return null;

  const pieces = cartPieces(lines);

  return (
    <div
      role="status"
      aria-label="Rental list summary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-card/95 px-4 py-3 shadow-card backdrop-blur sm:inset-x-auto sm:right-6 sm:bottom-6 sm:rounded-full sm:border sm:px-5"
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end">
        <p
          className="text-[0.78rem] whitespace-nowrap text-text-secondary"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          <strong className="font-semibold text-text-primary">{pieces}</strong>{' '}
          {pieces === 1 ? 'item' : 'items'}
          <span className="mx-1.5 text-text-dim">·</span>
          <span className="font-semibold text-text-primary">
            {formatPeso(cartSubtotal(lines))}
          </span>
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer rounded-full border border-border bg-transparent px-4 py-2 text-[0.75rem] text-text-secondary transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onCheckout}
            className="cursor-pointer rounded-full bg-accent px-5 py-2 text-[0.75rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Book Rentals
          </button>
        </div>
      </div>
    </div>
  );
}
