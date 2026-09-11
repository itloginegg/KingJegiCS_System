import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';

import { Navbar } from '../components/landing/Navbar';
import { SiteFooter } from '../components/landing/SiteFooter';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { readSession } from '../lib/tokenStorage';
import { formatPeso, toRentalItem } from '../components/rentals/rentalData';
import { fetchRentalItems } from '../api/rentalAdminApi';
import { fetchMenuItems, fetchMenuTrays, getFullImageUrl } from '../api/menuAdminApi';
import type { CartItemType, CartLine } from '../context/CartContext';

/**
 * /cart — the one place a mixed booking is reviewed before it becomes a booking.
 *
 * LAYOUT follows the supplied reference: a ~65/35 two-column grid, items left in
 * a bordered panel, summary card right. COLOUR does not. Every surface, hairline
 * and label below reads a semantic token (--bg-card, --border, --text-muted,
 * --accent), so this page follows the theme toggle exactly like every other page.
 * Hardcoding the reference's light palette — or the dark hexes that spec'd this
 * page — would have produced the one screen in the app that ignores the user's
 * theme choice, and would have had to be rewritten again at the next re-skin.
 *
 * WHY THE CATALOGS ARE FETCHED HERE. A cart restored from localStorage carries a
 * display snapshot, not a trusted price (see CartContext). Someone can land on
 * /cart directly, days later, with no other page having run. So this page pulls
 * all three catalogs on mount and reconciles — which is what turns 'unverified'
 * lines into priced ones, and what surfaces a delisted item before the user
 * reaches a payment screen rather than after.
 */

const TYPE_LABEL: Record<CartItemType, string> = {
  MenuItem: 'Menu Item',
  MenuTray: 'Menu Tray',
  Rental: 'Rental Item',
};

/** Where an item's catalog lives, so the type badge is also a way back. */
const TYPE_HREF: Record<CartItemType, string> = {
  MenuItem: '/menus',
  MenuTray: '/menus',
  Rental: '/rentals',
};

export function CartPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const {
    lines,
    subtotal,
    pieces,
    hasBlockingIssue,
    restored,
    revision,
    setQty,
    removeItem,
    clear,
    reconcile,
  } = useCart();

  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  /**
   * Which line types this page has actually managed to price against the live
   * catalog. Checkout is gated on it.
   *
   * The module note above promises every line is reconciled before checkout is
   * allowed, and that was not enforced: if all three fetches failed, `checking`
   * still went false and nothing was 'unavailable', so the button went live over
   * snapshot prices that could be weeks old.
   */
  const [verified, setVerified] = useState<Set<CartItemType>>(() => new Set());
  /** Bumped by the retry button, which is the only way back from a failed price check. */
  const [retryToken, setRetryToken] = useState(0);

  /* ── Reconcile against the live catalogs ──
     All three run together: a mixed cart needs all three before any total it
     shows is trustworthy, and serialising them would make the page flash a
     stale subtotal three times on the way to the real one. allSettled rather
     than all, so one dead endpoint degrades that section instead of the page. */
  useEffect(() => {
    if (!restored) return;
    let cancelled = false;

    void (async () => {
      setChecking(true);
      const token = readSession()?.token ?? '';
      const results = await Promise.allSettled([
        fetchRentalItems(token),
        fetchMenuItems(token),
        fetchMenuTrays(token),
      ]);
      if (cancelled) return;

      const [rentals, items, trays] = results;

      if (rentals.status === 'fulfilled') {
        reconcile(
          'Rental',
          rentals.value
            .filter((r) => r.isActive)
            .map(toRentalItem)
            .map((r) => ({
              id: r.id,
              name: r.name,
              price: r.pricePerDay,
              image: r.image,
              meta: r.category,
              stock: r.stock,
            })),
        );
      }

      if (items.status === 'fulfilled') {
        reconcile(
          'MenuItem',
          items.value
            /* Package-only dishes carry no standalone price and cannot be
               booked a la carte — the same filter MenuPage applies. */
            .filter((i) => i.isActive && i.pricePerTray != null)
            .map((i) => ({
              id: i.id,
              name: i.itemName,
              price: i.pricePerTray as number,
              image: getFullImageUrl(i.imageUrl),
              meta: i.servesPerTray ? `Serves ${i.servesPerTray}` : undefined,
            })),
        );
      }

      if (trays.status === 'fulfilled') {
        reconcile(
          'MenuTray',
          trays.value
            .filter((t) => t.isActive)
            .map((t) => ({
              id: t.id,
              name: t.trayName,
              price: t.pricePerTray,
              /* AdminMenuTray carries no imageUrl — a tray is a composition of
                 dishes, not a photographed product. The row falls back to its
                 placeholder rather than borrowing a dish's photo, which would
                 misrepresent what arrives. */
              image: null,
              meta: `Serves ${t.servesMin}–${t.servesMax}`,
            })),
        );
      }

      const ok = new Set<CartItemType>();
      if (rentals.status === 'fulfilled') ok.add('Rental');
      if (items.status === 'fulfilled') ok.add('MenuItem');
      if (trays.status === 'fulfilled') ok.add('MenuTray');
      setVerified(ok);

      const failed = results.filter((r) => r.status === 'rejected').length;
      setCatalogError(
        failed === 0
          ? null
          : failed === results.length
            ? 'Could not reach the catalogue, so we can’t confirm prices right now.'
            : 'Part of the catalogue did not load, so some prices are unconfirmed.',
      );
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
    /* `revision` and not `restored`: the latter latches true on the first load and
       never moves again, so a cart edited in another tab came back as unverified
       lines that nothing re-checked. See CartState.revision. */
  }, [revision, restored, reconcile, retryToken]);

  /* ── Promo code ──
     There is no promo endpoint in this API yet, so this validates nothing and
     says so rather than pretending to apply a discount. Wire the real call in
     `applyPromo`; the UI around it is already in place. */
  const [promo, setPromo] = useState('');
  const [promoNote, setPromoNote] = useState<string | null>(null);
  const discount = 0;

  const applyPromo = useCallback(() => {
    const code = promo.trim();
    if (!code) return;
    // TODO: POST the code to the pricing endpoint once one exists.
    setPromoNote(`"${code}" isn't an active code.`);
  }, [promo]);

  const total = Math.max(0, subtotal - discount);

  /* Every type in the cart has to have been priced against a catalog that
     actually answered. A cart of trays is fine when only the rentals endpoint is
     down; the same cart is not fine when the menu endpoints are. */
  const unpriced = useMemo(
    () => [...new Set(lines.map((l) => l.type))].filter((t) => !verified.has(t)),
    [lines, verified],
  );
  const cannotPrice = !checking && unpriced.length > 0;

  /* ── Auth-gated checkout ──
     A guest keeps their cart (it is in localStorage), signs in, and comes
     straight back here. The redirect param is what closes that loop. */
  const goToCheckout = useCallback(() => {
    if (lines.length === 0 || hasBlockingIssue || cannotPrice) return;
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent('/cart')}`);
      return;
    }
    navigate('/book', { state: { fromCart: true } });
  }, [lines.length, hasBlockingIssue, cannotPrice, isAuthenticated, navigate]);

  /* Grouped so a mixed cart reads as "food, then equipment" rather than as one
     undifferentiated column where a tray and a chair look like the same thing. */
  const grouped = useMemo(() => {
    const order: CartItemType[] = ['MenuItem', 'MenuTray', 'Rental'];
    return order
      .map((t) => ({ type: t, rows: lines.filter((l) => l.type === t) }))
      .filter((g) => g.rows.length > 0);
  }, [lines]);

  const deadCount = lines.filter((l) => l.status === 'unavailable').length;

  return (
    <div className="min-h-screen bg-bg">
      <Navbar activePage="cart" placement="sticky" />

      <main className="mx-auto w-full max-w-[var(--page-max)] px-4 pt-10 pb-20 sm:px-6 lg:px-8">
        <Link
          to="/rentals"
          className="mb-6 inline-flex items-center gap-2 rounded text-[0.8rem] text-text-muted transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Continue browsing
        </Link>

        {lines.length === 0 ? (
          <EmptyCart restored={restored} />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            {/* ── Left: the items ─────────────────────────────────────── */}
            <section
              aria-labelledby="cart-heading"
              className="rounded-2xl border border-border bg-bg-card p-5 shadow-card sm:p-8"
            >
              <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
                <h1
                  id="cart-heading"
                  className="text-[1.75rem] font-bold text-text-primary sm:text-[2rem]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  My Cart
                </h1>
                <button
                  type="button"
                  onClick={clear}
                  className="cursor-pointer rounded text-[0.75rem] text-text-muted underline-offset-4 transition-colors hover:text-danger-ink hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Clear all
                </button>
              </div>

              {catalogError && (
                <p
                  role="status"
                  className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-[0.78rem] text-text-secondary"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <AlertCircle size={15} className="mt-px shrink-0 text-warning-ink" aria-hidden="true" />
                  {catalogError}
                </p>
              )}

              {grouped.map((group, gi) => (
                <div key={group.type} className={gi > 0 ? 'mt-8' : undefined}>
                  <h2
                    className="mb-1 text-[0.68rem] font-semibold tracking-[0.14em] text-text-muted uppercase"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    {TYPE_LABEL[group.type]}
                    <span className="ml-2 tracking-normal normal-case text-text-dim">
                      {group.rows.length}
                    </span>
                  </h2>

                  <ul className="list-none p-0">
                    {group.rows.map((line) => (
                      <CartRow
                        key={line.key}
                        line={line}
                        onQty={(q) => setQty(line.key, q)}
                        onRemove={() => removeItem(line.key)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            {/* ── Right: the summary ──────────────────────────────────── */}
            <aside
              aria-labelledby="summary-heading"
              className="rounded-2xl border border-border bg-bg-card p-5 shadow-card sm:p-8 lg:sticky lg:top-24"
            >
              <h2
                id="summary-heading"
                className="mb-6 text-[1.35rem] font-bold text-text-primary sm:text-[1.6rem]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Order Summary
              </h2>

              <dl className="space-y-3 text-[0.85rem]" style={{ fontFamily: 'var(--font-body)' }}>
                <SummaryRow label={`Subtotal (${pieces} ${pieces === 1 ? 'item' : 'items'})`}>
                  {formatPeso(subtotal)}
                </SummaryRow>
                <SummaryRow label="Discount">
                  {discount > 0 ? `−${formatPeso(discount)}` : '—'}
                </SummaryRow>
                {/* Delivery is quoted by the booking flow from the venue address,
                    which this page does not collect. Named as a pending line so
                    the summary matches what the next step itemises, rather than
                    showing a zero we would have invented. */}
                <SummaryRow label="Delivery">
                  <span className="font-normal text-text-muted">Quoted at booking</span>
                </SummaryRow>
              </dl>

              <div className="mt-6">
                <label
                  htmlFor="promo"
                  className="mb-2 block text-[0.7rem] font-semibold tracking-[0.1em] text-text-muted uppercase"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Promo code
                </label>
                <div className="flex gap-2">
                  <input
                    id="promo"
                    value={promo}
                    onChange={(e) => {
                      setPromo(e.target.value);
                      setPromoNote(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyPromo();
                      }
                    }}
                    placeholder="Type here"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2.5 text-[0.82rem] text-text-primary placeholder:text-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    style={{ fontFamily: 'var(--font-body)' }}
                  />
                  <button
                    type="button"
                    onClick={applyPromo}
                    disabled={promo.trim() === ''}
                    className="cursor-pointer rounded-xl border border-border bg-bg-subtle px-4 py-2.5 text-[0.78rem] font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    Apply
                  </button>
                </div>
                {promoNote && (
                  <p
                    role="status"
                    className="mt-2 text-[0.74rem] text-text-muted"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    {promoNote}
                  </p>
                )}
              </div>

              <div className="my-6 h-px bg-border" />

              <div className="flex items-baseline justify-between gap-4">
                <span
                  className="text-[0.95rem] font-semibold text-text-primary"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Total
                </span>
                <span
                  className="text-[1.4rem] font-bold text-text-primary"
                  style={{ fontFamily: 'var(--font-numeric)' }}
                >
                  {formatPeso(total)}
                </span>
              </div>

              {cannotPrice && !hasBlockingIssue && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl bg-danger-muted px-3.5 py-2.5 text-[0.76rem] text-danger-ink"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <p className="flex items-start gap-2">
                    <AlertCircle size={15} className="mt-px shrink-0" aria-hidden="true" />
                    {/* Blocking rather than warning. The alternative is letting someone
                        commit to a total we cannot stand behind, and the booking
                        endpoint prices independently — so the figure on screen could
                        differ from the one they are charged. */}
                    We couldn’t confirm today’s prices, so checkout is paused.
                  </p>
                  <button
                    type="button"
                    onClick={() => setRetryToken((n) => n + 1)}
                    className="mt-2 cursor-pointer rounded-lg border border-danger-ink/40 px-2.5 py-1 text-[0.72rem] font-semibold underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    Try again
                  </button>
                </div>
              )}

              {hasBlockingIssue && (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-xl bg-danger-muted px-3.5 py-2.5 text-[0.76rem] text-danger-ink"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <AlertCircle size={15} className="mt-px shrink-0" aria-hidden="true" />
                  Remove the unavailable {deadCount > 1 ? 'items' : 'item'} above to continue.
                </p>
              )}

              <button
                type="button"
                onClick={goToCheckout}
                disabled={checking || hasBlockingIssue || cannotPrice}
                className="mt-5 w-full cursor-pointer rounded-full bg-accent px-6 py-3.5 text-[0.85rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {checking
                  ? 'Checking availability…'
                  : cannotPrice
                    ? 'Prices unavailable'
                    : 'Proceed to Checkout'}
              </button>

              {!isAuthenticated && (
                <p
                  className="mt-3 text-center text-[0.73rem] text-text-muted"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  You'll be asked to sign in first. Your cart is saved.
                </p>
              )}
            </aside>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-semibold text-text-primary" style={{ fontFamily: 'var(--font-numeric)' }}>
        {children}
      </dd>
    </div>
  );
}

/**
 * One line.
 *
 * A grid rather than a flex chain, so the price column stays put when a title
 * wraps to two lines — under flex the price drifts upward and the column stops
 * reading as a column.
 */
function CartRow({
  line,
  onQty,
  onRemove,
}: {
  line: CartLine;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const dead = line.status === 'unavailable';
  /* Stock is only known for rentals; menu lines get no ceiling. */
  const max = line.stock ?? 99;
  const atMax = line.qty >= max;

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-3 border-b border-border py-5 last:border-b-0 sm:gap-x-5">
      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-bg-subtle sm:h-24 sm:w-32">
        {line.snap.image ? (
          <img
            src={line.snap.image}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover ${dead ? 'opacity-40 grayscale' : ''}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-dim">
            <ShoppingCart size={18} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p
          className={`truncate text-[0.95rem] font-semibold ${dead ? 'text-text-muted line-through' : 'text-text-primary'}`}
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {line.snap.name}
        </p>

        <p
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-text-muted"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          <Link
            to={TYPE_HREF[line.type]}
            className="rounded-full border border-border px-2 py-0.5 transition-colors hover:border-border-strong hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {TYPE_LABEL[line.type]}
          </Link>
          {line.snap.meta && <span className="truncate">{line.snap.meta}</span>}
        </p>

        {dead ? (
          <p
            className="mt-2 text-[0.74rem] font-medium text-danger-ink"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            No longer available — remove it to continue.
          </p>
        ) : (
          <>
            <div className="mt-3 inline-flex items-center rounded-full border border-border">
              <QtyButton label={`Remove one ${line.snap.name}`} onClick={() => onQty(line.qty - 1)}>
                <Minus size={14} aria-hidden="true" />
              </QtyButton>
              <span
                className="min-w-9 px-1 text-center text-[0.82rem] font-semibold tabular-nums text-text-primary"
                style={{ fontFamily: 'var(--font-numeric)' }}
              >
                {line.qty}
              </span>
              <QtyButton
                label={`Add one ${line.snap.name}`}
                onClick={() => onQty(line.qty + 1)}
                disabled={atMax}
              >
                <Plus size={14} aria-hidden="true" />
              </QtyButton>
            </div>

            {/* Suppressed when the line was reduced: the message below already says
               the stock figure AND what happened to their quantity, and running
               both reads as two different problems. */}
            {atMax && line.stock !== undefined && line.status !== 'reduced' && (
              <p
                className="mt-1.5 text-[0.72rem] text-text-muted"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Only {line.stock} available.
              </p>
            )}

            {line.status === 'reduced' && (
              <p
                className="mt-1.5 text-[0.72rem] text-warning-ink"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Only {line.stock} left — we’ve reduced this to {line.qty}.
              </p>
            )}

            {line.priceWhenAdded !== undefined && (
              <p
                className="mt-1.5 text-[0.72rem] text-warning-ink"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Price changed from {formatPeso(line.priceWhenAdded)}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex h-full flex-col items-end justify-between gap-6">
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${line.snap.name} from cart`}
          className="cursor-pointer rounded-lg p-1.5 text-text-dim transition-colors hover:bg-danger-muted hover:text-danger-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>

        <div className="text-right">
          <p
            className={`text-[0.95rem] font-bold whitespace-nowrap ${dead ? 'text-text-dim line-through' : 'text-text-primary'}`}
            style={{ fontFamily: 'var(--font-numeric)' }}
          >
            {formatPeso(line.snap.price * line.qty)}
          </p>
          {line.qty > 1 && !dead && (
            <p
              className="mt-0.5 text-[0.72rem] whitespace-nowrap text-text-muted"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {formatPeso(line.snap.price)} each
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function QtyButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="cursor-pointer rounded-full px-2.5 py-2 text-text-secondary transition-colors hover:bg-primary-muted hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function EmptyCart({ restored }: { restored: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-card px-6 py-20 text-center shadow-card">
      <ShoppingCart size={34} className="mx-auto text-text-dim" aria-hidden="true" />
      <h1
        className="mt-5 text-[1.5rem] font-bold text-text-primary"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {restored ? 'Your cart is empty' : 'Loading your cart…'}
      </h1>
      {restored && (
        <>
          <p
            className="mx-auto mt-2 max-w-sm text-[0.87rem] text-text-secondary"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Add trays from the menu or pieces from the rental catalogue and they will collect here.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              to="/menus"
              className="rounded-full bg-accent px-6 py-3 text-[0.82rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Browse menus
            </Link>
            <Link
              to="/rentals"
              className="rounded-full border border-border px-6 py-3 text-[0.82rem] font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Browse rentals
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
