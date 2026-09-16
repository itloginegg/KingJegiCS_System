import { useLayoutEffect, useRef } from 'react';
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
 * figure the backend will not bill.
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
 *
 * Placed around the two controls that own the bottom corners on this page: the chat
 * widget bottom-right and the sound toggle bottom-left. It used to be a pill in the
 * bottom-right corner, where the widget covered "View Cart".
 *  - From 768px the widget is a 150px standing avatar and the sound toggle is ~170px, so
 *    the bar is centred (like MenuPage's plan bar) and capped at 100vw - 22rem, which
 *    keeps it out of both corners.
 *  - Below 768px there is no room between them, so the bar is a full-width strip along
 *    the bottom edge instead, and it publishes its height as --kj-bottom-bar-h. The chat
 *    bubble and the sound toggle lift themselves by that much, so they sit above the
 *    strip rather than on top of it. Measured, not written down, because the strip
 *    wraps to two lines on a narrow phone.
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
  const barRef = useRef<HTMLDivElement | null>(null);
  const visible = lines.length > 0;

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!visible || !bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--kj-bottom-bar-h', `${bar.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      // Gone from the page (emptied, or navigated away): the corners drop back down.
      root.style.removeProperty('--kj-bottom-bar-h');
    };
  }, [visible]);

  if (!visible) return null;

  const pieces = cartPieces(lines);

  return (
    <div
      ref={barRef}
      role="status"
      aria-label="Rental list summary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-card/95 px-4 py-3 shadow-card backdrop-blur md:inset-x-auto md:bottom-6 md:left-1/2 md:w-max md:max-w-[calc(100vw-22rem)] md:-translate-x-1/2 md:rounded-full md:border md:px-5"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
            {/* Not "Book Rentals" any more: this hands off to /cart, which reviews
                the whole cart — food included — before the booking wizard. */}
            View Cart
          </button>
        </div>
      </div>
    </div>
  );
}
