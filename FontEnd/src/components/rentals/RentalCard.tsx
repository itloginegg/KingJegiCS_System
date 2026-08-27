import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatPeso, type RentalItem } from './rentalData';

/**
 * Item thumbnail, with the monogram fallback.
 *
 * The fallback is driven by `onError` and not only by `image === null`. A null
 * check alone covers the case where the catalog admits it has no photo; it does
 * nothing for the far commoner one — a path that exists in the record but 404s
 * because the file was renamed or the upload failed. That case renders a broken
 * image glyph on a card that is otherwise finished, which is worse than no photo
 * at all. Both paths land on the same monogram.
 */
export function RentalThumb({
  item,
  className = '',
}: {
  item: RentalItem;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showMonogram = !item.image || failed;

  return (
    <div className={`relative overflow-hidden bg-bg-subtle ${className}`}>
      {showMonogram ? (
        <div
          className="flex h-full w-full items-center justify-center text-[2.5rem] leading-none text-text-dim select-none"
          style={{ fontFamily: 'var(--font-display)' }}
          aria-hidden="true"
        >
          {item.name.charAt(0).toUpperCase()}
        </div>
      ) : (
        <img
          src={item.image ?? undefined}
          alt={item.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
          style={{ filter: 'var(--menu-img-filter)' }}
        />
      )}
    </div>
  );
}

/** Category pill, or the out-of-stock marker that replaces it. */
export function RentalBadge({ item }: { item: RentalItem }) {
  const soldOut = item.stock === 0;
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold ${
        soldOut ? 'bg-danger text-[var(--danger-text)]' : 'bg-accent text-accent-fg'
      }`}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {soldOut ? 'Out of stock' : item.category}
    </span>
  );
}

/** Price, with the unit set smaller and muted so the number reads first. */
export function RentalPrice({ item }: { item: RentalItem }) {
  return (
    <span
      className="shrink-0 text-right text-[0.95rem] font-bold whitespace-nowrap text-text-primary"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {formatPeso(item.pricePerDay)}
      <span className="ml-1 text-[0.7rem] font-normal text-text-muted">/ day</span>
    </span>
  );
}

/**
 * Quantity stepper. The value is a read-only display rather than an input: a
 * free-text number field would need its own parse, clamp and empty-string states
 * for a control whose only legal values are 1…stock, reachable in one click each.
 */
export function QuantityStepper({
  value,
  stock,
  onStep,
  itemName,
}: {
  value: number;
  stock: number;
  /**
   * Emits a delta rather than the computed next value. Deriving `value + 1` here
   * and sending that up reads the `value` PROP, which is a render-time snapshot:
   * two clicks landing in one React batch both compute from the same stale
   * number, and the second silently overwrites the first with the same result.
   * A delta lets the page apply it against current state, which is correct
   * whatever the batching does.
   */
  onStep: (delta: number) => void;
  /** Names the item in the button labels, so a screen reader hears which
      stepper it is landing on rather than a page full of bare "Decrease". */
  itemName: string;
}) {
  const btnBase =
    'flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
  const btnMinus = `${btnBase} bg-surface text-text-primary hover:bg-bg-card`;
  const btnPlus = `${btnBase} bg-accent text-accent-fg hover:bg-accent-hover`;

  return (
    <div className="flex items-center gap-3 rounded-full bg-primary-muted px-1.5 py-1">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={value <= 1}
        aria-label={`Decrease ${itemName} quantity`}
        className={btnMinus}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <span
        className="min-w-5 text-center text-[0.8125rem] font-medium text-text-primary tabular-nums"
        style={{ fontFamily: 'var(--font-numeric)' }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={value >= stock}
        aria-label={`Increase ${itemName} quantity`}
        className={btnPlus}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The "+ Add" action, shared by the card and the list row. */
export function AddButton({
  item,
  onAdd,
}: {
  item: RentalItem;
  onAdd: () => void;
}) {
  const soldOut = item.stock === 0;
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={soldOut}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-accent px-4 py-2 text-[0.78rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      <Plus size={14} aria-hidden="true" />
      Add
    </button>
  );
}

/**
 * Grid card.
 *
 * `flex flex-col h-full` with the details block on `flex-1` is what keeps the
 * footers on one line across a row: without it a two-line title pushes its own
 * footer down and the row of Add buttons goes ragged.
 */
export function RentalCard({
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
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-card transition-colors hover:border-border-strong">
      <div className="relative">
        <RentalThumb item={item} className="aspect-[4/3] w-full" />
        <div className="absolute top-3 left-3">
          <RentalBadge item={item} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3
            className="text-[1.05rem] leading-tight font-semibold text-text-primary"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {item.name}
          </h3>
          <RentalPrice item={item} />
        </div>

        <p
          className="text-[0.75rem] text-text-muted"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {item.category} · {item.stock} available
        </p>

        <p
          className="line-clamp-2 text-[0.8rem] leading-relaxed text-text-secondary"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {item.description}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border p-4">
        <QuantityStepper
          value={quantity}
          stock={item.stock}
          onStep={onStep}
          itemName={item.name}
        />
        <AddButton item={item} onAdd={onAdd} />
      </div>
    </article>
  );
}

/**
 * Loading placeholder. Mirrors the card's real dimensions — image block, three
 * text lines, footer — so switching from skeletons to content does not reflow
 * the grid under the reader's eye.
 */
export function RentalCardSkeleton() {
  return (
    <div
      className="flex h-full animate-pulse flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-card"
      aria-hidden="true"
    >
      <div className="aspect-[4/3] w-full bg-bg-subtle" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="h-4 w-3/4 rounded bg-bg-subtle" />
        <div className="h-3 w-1/2 rounded bg-bg-subtle" />
        <div className="h-3 w-full rounded bg-bg-subtle" />
        <div className="h-3 w-5/6 rounded bg-bg-subtle" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border p-4">
        <div className="h-9 w-24 rounded-full bg-bg-subtle" />
        <div className="h-9 w-20 rounded-full bg-bg-subtle" />
      </div>
    </div>
  );
}
