import {
  AddButton,
  QuantityStepper,
  RentalBadge,
  RentalPrice,
  RentalThumb,
} from './RentalCard';
import type { RentalItem } from './rentalData';

/**
 * List-view row: thumbnail left, copy in the middle, price and actions right.
 *
 * Below `sm` the same element stacks into the card shape — the thumbnail goes
 * full-width at 4:3 and the columns become rows. That is done in CSS on one
 * element rather than by swapping in <RentalCard> at a breakpoint, so the row is
 * announced once and holds one set of controls; rendering both and hiding one
 * would put every stepper and Add button into the accessibility tree twice.
 *
 * The badge sits in the content column rather than floating over the image: at
 * the 120px thumbnail size an overlay pill covers most of the photo.
 */
export function RentalListRow({
  item,
  quantity,
  onStep,
  onAdd,
}: {
  item: RentalItem;
  quantity: number;
  onStep: (delta: number) => void;
  onAdd: () => void;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-card transition-colors hover:border-border-strong sm:flex-row sm:items-stretch sm:gap-4 sm:p-4">
      <RentalThumb
        item={item}
        className="aspect-[4/3] w-full sm:h-[120px] sm:w-[120px] sm:shrink-0 sm:rounded-xl"
      />

      <div className="flex flex-1 flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-4 sm:p-0">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <RentalBadge item={item} />
            <span
              className="text-[0.75rem] text-text-muted"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {item.category} · {item.stock} available
            </span>
          </div>

          <h3
            className="text-[1.05rem] leading-tight font-semibold text-text-primary"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {item.name}
          </h3>

          <p
            className="line-clamp-2 text-[0.8rem] leading-relaxed text-text-secondary"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {item.description}
          </p>
        </div>

        {/* Right rail. Below sm it drops under the copy and the divider returns,
            matching how the card separates its footer. */}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4 sm:shrink-0 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:pt-0">
          <RentalPrice item={item} />
          <div className="flex items-center gap-2">
            <QuantityStepper
              value={quantity}
              stock={item.stock}
              onStep={onStep}
              itemName={item.name}
            />
            <AddButton item={item} onAdd={onAdd} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** List-view skeleton, sized to the row so the switch does not jump. */
export function RentalListRowSkeleton() {
  return (
    <div
      className="flex animate-pulse items-center gap-4 rounded-2xl border border-border bg-bg-card p-4 shadow-card"
      aria-hidden="true"
    >
      <div className="h-[120px] w-[120px] shrink-0 rounded-xl bg-bg-subtle" />
      <div className="flex flex-1 flex-col gap-3">
        <div className="h-3 w-1/3 rounded bg-bg-subtle" />
        <div className="h-4 w-1/2 rounded bg-bg-subtle" />
        <div className="h-3 w-full rounded bg-bg-subtle" />
      </div>
      <div className="hidden h-9 w-40 shrink-0 rounded-full bg-bg-subtle sm:block" />
    </div>
  );
}
