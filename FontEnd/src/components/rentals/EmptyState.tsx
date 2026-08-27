import { PackageOpen, PlugZap } from 'lucide-react';

/**
 * Shown in place of the grid when the filters match nothing.
 *
 * Six categories crossed with a price range and an availability toggle makes an
 * empty result easy to reach by accident, so this carries the escape hatch
 * rather than just reporting the dead end — otherwise the only way out is to
 * remember which of three controls caused it.
 */
export function EmptyState({
  onClear,
  /**
   * 'filtered' — the catalog has stock, this combination just excludes it.
   * 'catalog-empty' — the request succeeded and returned nothing rentable.
   *
   * Distinguished because offering "Clear Filters" against an empty inventory
   * sends the customer to fiddle with controls that cannot change the outcome.
   */
  reason = 'filtered',
}: {
  onClear: () => void;
  reason?: 'filtered' | 'catalog-empty';
}) {
  const filtered = reason === 'filtered';

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-bg-card px-6 py-20 text-center shadow-card">
      <PackageOpen size={44} strokeWidth={1.25} aria-hidden="true" className="text-text-dim" />
      <p
        className="text-[1.15rem] text-text-primary"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {filtered
          ? 'No equipment matches your filters'
          : 'Nothing is available for rent yet'}
      </p>
      <p
        className="max-w-[380px] text-[0.82rem] leading-relaxed text-text-muted"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {filtered
          ? 'Try widening the price range, or clear the filters to see the whole catalog.'
          : 'Our rental inventory is being set up. Please check back soon, or get in touch and we’ll tell you what we can source.'}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 cursor-pointer rounded-full bg-accent px-5 py-2.5 text-[0.78rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}

/**
 * Shown when the catalog request fails.
 *
 * Kept distinct from EmptyState on purpose: "nothing matched your filters" and
 * "we could not reach the server" ask for opposite responses, and collapsing
 * them into one message sends the customer off widening filters against a
 * catalog that never loaded.
 */
export function CatalogError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-bg-card px-6 py-20 text-center shadow-card"
    >
      <PlugZap size={44} strokeWidth={1.25} aria-hidden="true" className="text-danger" />
      <p
        className="text-[1.15rem] text-text-primary"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        We couldn’t load the rental catalog
      </p>
      <p
        className="max-w-[380px] text-[0.82rem] leading-relaxed text-text-muted"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-1 cursor-pointer rounded-full bg-accent px-5 py-2.5 text-[0.78rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}
