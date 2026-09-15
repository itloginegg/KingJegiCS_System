import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';

import { Navbar } from '../components/site/Navbar';
import { SiteFooter } from '../components/site/SiteFooter';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { readSession } from '../lib/tokenStorage';
import { formatPeso, toRentalItem } from '../components/rentals/rentalData';
import { fetchRentalItems } from '../api/rentalAdminApi';
import { fetchMenuItems, fetchMenuTrays, getFullImageUrl } from '../api/menuAdminApi';
import { fmtDate, fmtTime } from '../lib/format';
import { usePlanRecheck } from '../hooks/usePlanRecheck';
import { holdPlanImages, peekPlanImages } from '../lib/planImages';
import { validateReferenceImage } from '../api/bookingApi';
import { PlanReview } from '../components/suggestions/PlanReview';
import { PlanByBudgetStyles } from '../components/suggestions/PlanByBudget';
import type { CartItemType, CartLine, CartPlan } from '../context/CartContext';

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
 *
 * SELECTION. Checkout takes what is ticked (see SELECTION in CartContext). The summary
 * totals only the ticked entries, and only a ticked entry can hold checkout up: a
 * delisted line or a stale plan can't be ticked, so it is left out of the order rather
 * than blocking the rest of it.
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
    pieces,
    restored,
    revision,
    setQty,
    removeItem,
    clear,
    reconcile,
    plans,
    removePlan,
    selectedKeys,
    isSelected,
    isSelectable,
    toggle,
    setSelection,
    selectAll,
    selectNone,
    selectedLines,
    selectedPlans,
    selectedSubtotal,
    selectedPieces,
    selectedPlansTotal,
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

  /* Planned bookings: re-checked on every load (see usePlanRecheck), and opened back
     up in the plan editor to fix one the re-check flagged. */
  const planCheck = usePlanRecheck();
  const [editingPlanKey, setEditingPlanKey] = useState<string | null>(null);
  const editingPlan = plans.find((p) => p.key === editingPlanKey) ?? null;
  const planStale = plans.some((p) => p.status === 'stale');
  /** Dish names per tray, for the editor's tray rows. Filled by the catalog fetch below. */
  const [trayDishes, setTrayDishes] = useState<Record<string, string[]>>({});

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
        setTrayDishes(Object.fromEntries(trays.value.map((t) => [t.id, t.dishes.map((d) => d.itemName)])));
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

  /* Only what is ticked: the summary is what checkout will take. */
  const total = Math.max(0, selectedSubtotal - discount) + selectedPlansTotal;

  /* Every TICKED type has to have been priced against a catalog that actually
     answered. A cart of trays is fine when only the rentals endpoint is down; the
     same cart is not fine when the menu endpoints are — unless the trays are
     unticked, since checkout won't take them. */
  const unpriced = useMemo(
    () => [...new Set(selectedLines.map((l) => l.type))].filter((t) => !verified.has(t)),
    [selectedLines, verified],
  );
  const cannotPrice = !checking && unpriced.length > 0;
  /* The catalog check only holds checkout while there is a ticked line to price. */
  const linesChecking = checking && selectedLines.length > 0;
  const nothingSelected = selectedKeys.size === 0;

  /* ── Checkout ──
     No sign-in here. /checkout shows a guest their order and asks at "Place order",
     returning with ?redirect=. Making someone sign in just to LOOK at what they are
     about to buy was the wall the guest cart exists to take down. */
  const goToCheckout = useCallback(() => {
    /* Scoped to the selection. planCheck's flags are too (see usePlanRecheck). */
    if (nothingSelected || linesChecking || cannotPrice) return;
    if (planCheck.checking || planCheck.failed) return;
    /* Not /book. That is the FullService wizard, which asks for event type and
       guest count — neither of which a drop-off or an equipment rental needs, and
       neither of which the backend requires for those two types. /checkout collects
       only what BookingCreateDto actually validates for them. */
    navigate('/checkout');
  }, [nothingSelected, linesChecking, cannotPrice, planCheck.checking, planCheck.failed, navigate]);

  /* Grouped so a mixed cart reads as "food, then equipment" rather than as one
     undifferentiated column where a tray and a chair look like the same thing. */
  const grouped = useMemo(() => {
    const order: CartItemType[] = ['MenuItem', 'MenuTray', 'Rental'];
    return order
      .map((t) => ({ type: t, rows: lines.filter((l) => l.type === t) }))
      .filter((g) => g.rows.length > 0);
  }, [lines]);

  const deadCount = lines.filter((l) => l.status === 'unavailable').length;

  /** A checkbox's state over some entries. Only entries that could be ticked count. */
  const tickState = (keys: string[]): TickState => {
    const open = keys.filter((k) => isSelectable(k));
    const on = open.filter((k) => isSelected(k)).length;
    return { keys: open, checked: open.length > 0 && on === open.length, indeterminate: on > 0 && on < open.length };
  };
  const everything = tickState([...plans.map((p) => p.key), ...lines.map((l) => l.key)]);

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

        {lines.length === 0 && plans.length === 0 ? (
          <EmptyCart restored={restored} />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            {/* ── Left: the items ─────────────────────────────────────── */}
            <section
              aria-labelledby="cart-heading"
              className="rounded-2xl border border-border bg-bg-card p-5 shadow-card sm:p-8"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h1
                  id="cart-heading"
                  className="text-[1.75rem] font-bold text-text-primary sm:text-[2rem]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  My Cart
                </h1>
                <div className="flex items-center gap-5">
                  <TickBox
                    label="Select all"
                    showLabel
                    checked={everything.checked}
                    indeterminate={everything.indeterminate}
                    disabled={everything.keys.length === 0}
                    onChange={() => (everything.checked ? selectNone() : selectAll())}
                  />
                  <button
                    type="button"
                    onClick={clear}
                    className="cursor-pointer rounded text-[0.75rem] text-text-muted underline-offset-4 transition-colors hover:text-danger-ink hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    Clear all
                  </button>
                </div>
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

              {plans.length > 0 && (
                <div className={grouped.length > 0 ? 'mb-8' : undefined}>
                  <GroupHeading
                    label="Planned bookings"
                    count={plans.length}
                    tick={tickState(plans.map((p) => p.key))}
                    onTick={setSelection}
                  />
                  <ul className="list-none p-0">
                    {plans.map((plan) => (
                      <PlanRow
                        key={plan.key}
                        plan={plan}
                        selected={isSelected(plan.key)}
                        selectable={isSelectable(plan.key)}
                        onToggle={() => toggle(plan.key)}
                        onEdit={() => setEditingPlanKey(plan.key)}
                        onRemove={() => removePlan(plan.key)}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {grouped.map((group, gi) => (
                <div key={group.type} className={gi > 0 ? 'mt-8' : undefined}>
                  <GroupHeading
                    label={TYPE_LABEL[group.type]}
                    count={group.rows.length}
                    tick={tickState(group.rows.map((l) => l.key))}
                    onTick={setSelection}
                  />

                  <ul className="list-none p-0">
                    {group.rows.map((line) => (
                      <CartRow
                        key={line.key}
                        line={line}
                        selected={isSelected(line.key)}
                        selectable={isSelectable(line.key)}
                        onToggle={() => toggle(line.key)}
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
                {/* The ticked figures, with the cart's own count beside them whenever the
                    two differ, so what is left behind is stated rather than inferred. */}
                {lines.length > 0 && (
                  <SummaryRow
                    label={`Subtotal (${selectedPieces === pieces ? '' : `${selectedPieces} of `}${pieces} ${pieces === 1 ? 'item' : 'items'})`}
                  >
                    {formatPeso(selectedSubtotal)}
                  </SummaryRow>
                )}
                {plans.length > 0 && (
                  <SummaryRow
                    label={`Planned bookings (${selectedPlans.length === plans.length ? '' : `${selectedPlans.length} of `}${plans.length})`}
                  >
                    {formatPeso(selectedPlansTotal)}
                  </SummaryRow>
                )}
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

              {cannotPrice && (
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
                    We couldn’t confirm today’s prices for what’s ticked, so checkout is paused. Try again, or
                    untick those items to go ahead without them.
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

              {/* Neither blocks any more: an entry that can't be ticked is left out of the
                  order. Said here so the gap between the cart and the total is explained. */}
              {deadCount > 0 && (
                <p
                  role="status"
                  className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-bg-subtle px-3.5 py-2.5 text-[0.76rem] text-text-secondary"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <AlertCircle size={15} className="mt-px shrink-0 text-warning-ink" aria-hidden="true" />
                  {deadCount > 1 ? `${deadCount} items are` : 'An item is'} no longer available, so{' '}
                  {deadCount > 1 ? 'they’re' : 'it’s'} left out of this order.
                </p>
              )}

              {planStale && (
                <p
                  role="status"
                  className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-bg-subtle px-3.5 py-2.5 text-[0.76rem] text-text-secondary"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <AlertCircle size={15} className="mt-px shrink-0 text-warning-ink" aria-hidden="true" />
                  A planned booking has changed since you added it, so it’s left out of this order. Fix it to add it
                  back.
                </p>
              )}

              {planCheck.failed && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl bg-danger-muted px-3.5 py-2.5 text-[0.76rem] text-danger-ink"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  <p className="flex items-start gap-2">
                    <AlertCircle size={15} className="mt-px shrink-0" aria-hidden="true" />
                    We couldn’t re-check a ticked planned booking, so checkout is paused. Try again, or untick it
                    to go ahead without it.
                  </p>
                  <button
                    type="button"
                    onClick={planCheck.retry}
                    className="mt-2 cursor-pointer rounded-lg border border-danger-ink/40 px-2.5 py-1 text-[0.72rem] font-semibold underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    Try again
                  </button>
                </div>
              )}

              {nothingSelected && (
                <p
                  id="checkout-hint"
                  role="status"
                  className="mt-4 text-center text-[0.76rem] text-text-muted"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Select at least one item to check out.
                </p>
              )}

              <button
                type="button"
                onClick={goToCheckout}
                disabled={nothingSelected || linesChecking || planCheck.checking || planCheck.failed || cannotPrice}
                aria-describedby={nothingSelected ? 'checkout-hint' : undefined}
                className="mt-5 w-full cursor-pointer rounded-full bg-accent px-6 py-3.5 text-[0.85rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {linesChecking || planCheck.checking
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
                  You'll sign in when you place the order. Your cart is saved.
                </p>
              )}
            </aside>
          </div>
        )}
      </main>

      {editingPlan && (
        <>
          <PlanByBudgetStyles />
          <PlanReview
            key={editingPlan.key}
            source={{ kind: 'plan', plan: editingPlan }}
            trayDishes={trayDishes}
            onClose={() => setEditingPlanKey(null)}
            onDone={() => setEditingPlanKey(null)}
          />
        </>
      )}

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

interface TickState {
  /** The entries the checkbox acts on: those that could be ticked. */
  keys: string[];
  checked: boolean;
  indeterminate: boolean;
}

/**
 * A checkbox that can also show "some of these are ticked". `indeterminate` exists
 * only as a DOM property — there is no HTML attribute for it — so it is set through a
 * ref; browsers then report it to assistive tech as "mixed".
 */
function TickBox({
  label,
  showLabel = false,
  checked,
  indeterminate = false,
  disabled = false,
  title,
  onChange,
}: {
  label: string;
  showLabel?: boolean;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  title?: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const box = (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={showLabel ? undefined : label}
      title={title}
      className="h-4 w-4 shrink-0 cursor-pointer accent-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
  if (!showLabel) return box;
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 text-[0.75rem] text-text-muted"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {box}
      {label}
    </label>
  );
}

/** A group's heading, with the checkbox that ticks or unticks the whole group. */
function GroupHeading({
  label,
  count,
  tick,
  onTick,
}: {
  label: string;
  count: number;
  tick: TickState;
  onTick: (keys: string[], on: boolean) => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-3">
      <TickBox
        label={`Select all in ${label}`}
        checked={tick.checked}
        indeterminate={tick.indeterminate}
        disabled={tick.keys.length === 0}
        onChange={() => onTick(tick.keys, !tick.checked)}
      />
      <h2
        className="text-[0.68rem] font-semibold tracking-[0.14em] text-text-muted uppercase"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {label}
        <span className="ml-2 tracking-normal normal-case text-text-dim">{count}</span>
      </h2>
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
  selected,
  selectable,
  onToggle,
  onQty,
  onRemove,
}: {
  line: CartLine;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const dead = line.status === 'unavailable';
  /* Stock is only known for rentals; menu lines get no ceiling. */
  const max = line.stock ?? 99;
  const atMax = line.qty >= max;

  return (
    <li className="grid grid-cols-[auto_auto_1fr_auto] items-start gap-x-3 gap-y-3 border-b border-border py-5 last:border-b-0 sm:gap-x-5">
      <div className="pt-1">
        <TickBox
          label={`Include ${line.snap.name} in checkout`}
          checked={selected}
          disabled={!selectable}
          title={selectable ? undefined : 'No longer available, so it can’t be checked out'}
          onChange={onToggle}
        />
      </div>
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
            No longer available, so it’s left out of your order.
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

/**
 * One planned booking. Changing it means opening it in the plan editor again.
 * The figures are its latest quote: re-checked on every load, and flagged when the
 * total moved or when something in it can no longer be booked.
 */
function PlanRow({
  plan,
  selected,
  selectable,
  onToggle,
  onEdit,
  onRemove,
}: {
  plan: CartPlan;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const r = plan.recipe;
  return (
    <li className="border-b border-border py-5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="pt-1">
            <TickBox
              label={`Include ${plan.title} in checkout`}
              checked={selected}
              disabled={!selectable}
              title={selectable ? undefined : 'This plan needs fixing before it can be checked out'}
              onChange={onToggle}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[0.95rem] font-semibold text-text-primary" style={{ fontFamily: 'var(--font-body)' }}>
              {plan.title}
            </p>
            <p className="mt-1 text-[0.75rem] text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
              {fmtDate(r.eventDate)} · {fmtTime(r.startTime)} · {r.venueAddress}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer rounded-lg px-2 py-1 text-[0.75rem] font-semibold text-text-secondary underline-offset-4 transition-colors hover:text-text-primary hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Edit plan
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${plan.title} from cart`}
            className="cursor-pointer rounded-lg p-1.5 text-text-dim transition-colors hover:bg-danger-muted hover:text-danger-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      {plan.status === 'unverified' && (
        <p className="mt-2 text-[0.72rem] text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
          Checking today’s prices and availability…
        </p>
      )}
      {plan.status === 'unchecked' && (
        <p className="mt-2 text-[0.72rem] text-warning-ink" style={{ fontFamily: 'var(--font-body)' }}>
          Couldn’t re-check this plan.
        </p>
      )}
      {plan.status === 'repriced' && plan.totalWhenAdded !== undefined && (
        <p className="mt-2 text-[0.72rem] text-warning-ink" style={{ fontFamily: 'var(--font-body)' }}>
          The total changed from {formatPeso(plan.totalWhenAdded)} to {formatPeso(plan.snap.total)}.
        </p>
      )}
      {plan.status === 'stale' && (
        <div
          role="alert"
          className="mt-3 rounded-xl bg-danger-muted px-3.5 py-2.5 text-[0.76rem] text-danger-ink"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          <p className="font-semibold">This plan can’t be booked as it is, so it’s left out of your order:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {(plan.problems ?? []).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onEdit}
            className="mt-2 cursor-pointer rounded-lg border border-danger-ink/40 px-2.5 py-1 text-[0.72rem] font-semibold underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {plan.headerProblem ? 'Pick another date or time' : 'Fix this plan'}
          </button>
        </div>
      )}

      <PlanImagesNote plan={plan} />

      <ul className="mt-3 list-none space-y-1.5 p-0">
        {plan.snap.lines.map((l) => (
          <li key={`${l.type}-${l.refId}`} className="flex items-baseline justify-between gap-3 text-[0.8rem]">
            <span className="min-w-0 truncate text-text-secondary" style={{ fontFamily: 'var(--font-body)' }}>
              {l.type === 'Package' ? l.name : `${l.quantity} × ${l.name}`}
            </span>
            <span className="whitespace-nowrap text-text-primary" style={{ fontFamily: 'var(--font-numeric)' }}>
              {formatPeso(l.lineTotal)}
            </span>
          </li>
        ))}
      </ul>

      {plan.snap.slots.length > 0 && (
        <ul className="mt-2 list-none space-y-0.5 p-0">
          {plan.snap.slots.map((s) => (
            <li key={s.slotId} className="text-[0.74rem] text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
              <span className="text-text-dim">{s.slotLabel}:</span> {s.itemNames.join(', ')}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-right text-[0.95rem] font-bold text-text-primary" style={{ fontFamily: 'var(--font-numeric)' }}>
        {formatPeso(plan.snap.total)}
      </p>
    </li>
  );
}

/**
 * The reference images a wizard plan carries. The files live in memory only (see
 * lib/planImages), so a refresh loses them; this says so and lets the customer pick
 * them again, rather than letting checkout place the plan without them unannounced.
 */
function PlanImagesNote({ plan }: { plan: CartPlan }) {
  const [, rerender] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const names = plan.imageNames;
  if (!names || (!names.motif && !names.theme)) return null;

  const held = peekPlanImages(plan.key);
  const lost = (['motif', 'theme'] as const).filter((kind) => names[kind] && !held?.[kind]);

  const pick = (kind: 'motif' | 'theme', file: File | null) => {
    if (!file) return;
    const problem = validateReferenceImage(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const current = peekPlanImages(plan.key) ?? { motif: null, theme: null };
    holdPlanImages(plan.key, { ...current, [kind]: file });
    rerender((n) => n + 1);
  };

  if (lost.length === 0) {
    return (
      <p className="mt-2 text-[0.72rem] text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
        Reference images attached at checkout: {[held?.motif?.name, held?.theme?.name].filter(Boolean).join(', ')}. Keep
        this tab open until you place the order — they aren't saved anywhere yet.
      </p>
    );
  }

  return (
    <div
      className="mt-2 rounded-xl border border-border bg-bg-subtle px-3.5 py-2.5 text-[0.74rem] text-text-secondary"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      <p>
        Your {lost.join(' and ')} image{lost.length > 1 ? 's were' : ' was'} lost when the page reloaded. Pick{' '}
        {lost.length > 1 ? 'them' : 'it'} again, or place the plan without.
      </p>
      {lost.map((kind) => (
        <label key={kind} className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="capitalize">{kind}:</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={`Pick the ${kind} image again`}
            onChange={(e) => pick(kind, e.target.files?.[0] ?? null)}
            className="text-[0.72rem]"
          />
        </label>
      ))}
      {error && <p className="mt-1 text-danger-ink">{error}</p>}
    </div>
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
