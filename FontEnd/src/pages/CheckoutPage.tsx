import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Package, UtensilsCrossed } from 'lucide-react';

import { Navbar } from '../components/site/Navbar';
import { SiteFooter } from '../components/site/SiteFooter';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { readSession } from '../lib/tokenStorage';
import { formatPeso } from '../components/rentals/rentalData';
import { PhoneNumberInput } from '../components/forms/PhoneNumberInput';
import { VenueAddressFields } from '../components/forms/VenueAddressFields';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  type VenueAddress,
} from '../lib/venue';
import { isCompletePhPhone } from '../lib/phone';
import {
  addMenuItem,
  addMenuTray,
  addRental,
  createBooking,
  submitBooking,
  uploadMotifImage,
  uploadThemeImage,
  BookingApiError,
  type BookingCreatePayload,
} from '../api/bookingApi';
import { getBookingRules, getCalendarDays, type CalendarDay } from '../api/calendarApi';
import { checkoutPlan, SuggestionsApiError } from '../api/suggestionsApi';
import { fmtDate, fmtTime } from '../lib/format';
import { usePlanRecheck } from '../hooks/usePlanRecheck';
import { dropPlanImages, peekPlanImages } from '../lib/planImages';
import type { CartItemType, CartLine, CartPlan } from '../context/CartContext';

/**
 * /checkout — the short path for food and equipment.
 *
 * WHY THIS EXISTS RATHER THAN REUSING /book. BookingPage is the FullService
 * wizard: it asks for event type, guest count, motif and event-specific details
 * because a catered event genuinely needs them. A drop-off does not, and the
 * backend agrees — BookingCreateDto.Validate requires only date, time and
 * address for FoodDelivery, and additionally end date/time (the return window)
 * for RentalService. Neither type requires event type or guest count; sending a
 * customer through the event wizard to order two trays was frontend friction
 * with no rule behind it.
 *
 * WHY A MIXED CART BECOMES TWO BOOKINGS. Bookingservice.EnsureNotDeliveryAsync
 * rejects rental and service lines on a FoodDelivery booking outright — "Food
 * delivery orders can only contain menu items and trays." So trays + chairs
 * cannot be one delivery. They become a FoodDelivery booking and a
 * RentalService booking, created back to back from one form, which is how the
 * domain already models them: a rental is event-dated but consumes no calendar
 * slot, so the two never contend.
 *
 * WHAT THE THREE TYPES ACTUALLY REQUIRE, per BookingCreateDto.Validate:
 *   FoodDelivery  — date, time, address.            No end, no event type, no guests.
 *   RentalService — date, time, END date/time, address.  No event type, no guests.
 *   FullService   — all of the above plus event type and guest count.  → /book
 *
 * PLANNED BOOKINGS. A plan from the budget planner carries its own date, venue and
 * lines, so this form doesn't apply to it. Each plan is placed on its own through
 * POST /api/suggestions/checkout, which re-prices it and books it all or nothing;
 * a refused plan stays in the cart with the reasons.
 *
 * WHO CAN GET HERE. Guests can: they see the order and sign in at "Place order",
 * which comes back here through ?redirect=. Admin accounts can see it but not place
 * it — customer bookings are made by customers, and the checkout endpoint refuses
 * an admin token anyway.
 *
 * WHAT IS PLACED. Only what is ticked in the cart (see SELECTION in CartContext). The
 * form, the summary and the bookings all follow the selection, and afterwards exactly
 * the entries that became bookings are removed. Everything else stays in the cart.
 */

type Mode = 'food' | 'rental' | 'both';

const FOOD_TYPES: CartItemType[] = ['MenuItem', 'MenuTray'];

/** Sum of a slice of the cart. Mirrors the subtotal rule in CartContext. */
function sumOf(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.snap.price * l.qty, 0);
}

/** "HH:mm" from an <input type="time"> → the "HH:mm:ss" the API expects. */
function apiTime(value: string): string {
  return `${value}:00`;
}

/** One booking's outcome, so a partial failure can be reported precisely. */
interface Placed {
  label: string;
  ok: boolean;
  reference?: string;
  error?: string;
  /**
   * The cart entries this booking was made from. On success exactly these are removed —
   * never "every rental", which would also take the unticked ones nobody ordered.
   */
  keys: string[];
  /** Set for a planned booking, so a refused plan can be re-checked. */
  planKey?: string;
  /** Every reason a plan was refused, when the server listed more than one. */
  problems?: string[];
  /** Said instead of the plain success line — e.g. a reference image that didn't make it. */
  note?: string;
}

/**
 * Uploads the reference images a wizard plan was holding, now that its booking exists.
 *
 * The booking is already placed by the time this runs, so nothing here throws: an
 * inspiration photo that didn't upload is not a reason to report the order as failed.
 * It says what happened instead, including when the images were lost to a refresh.
 */
async function attachPlanImages(token: string, bookingId: string, plan: CartPlan): Promise<string | undefined> {
  const names = plan.imageNames;
  if (!names || (!names.motif && !names.theme)) return undefined;

  const held = peekPlanImages(plan.key);
  const lost = (['motif', 'theme'] as const).filter((kind) => names[kind] && !held?.[kind]);
  try {
    if (held?.motif) await uploadMotifImage(token, bookingId, held.motif);
    if (held?.theme) await uploadThemeImage(token, bookingId, held.theme);
  } catch {
    return "Submitted — awaiting confirmation. A reference image didn't upload, so please send it to us once we confirm.";
  } finally {
    dropPlanImages(plan.key);
  }
  return lost.length > 0
    ? `Submitted — awaiting confirmation. Placed without your ${lost.join(' and ')} image, which was lost when the page reloaded.`
    : undefined;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const {
    lines,
    plans,
    restored,
    selectedKeys,
    selectedLines,
    selectedPlans,
    selectedPlansTotal,
    removeKeys,
    recheckPlans,
  } = useCart();
  const isAdmin = user?.role === 'admin';
  /* Plans are re-checked here as well as on /cart: a direct visit, or a tab left open
     for days, must not place a plan nobody has looked at since the catalog changed. A
     plan found stale unticks itself (CartContext), so it drops out of this order and
     the summary says so; /cart shows what changed and lets it be edited. */
  const planCheck = usePlanRecheck();

  /* The ticked lines only. Tick just trays and it is one delivery, not two bookings. */
  const foodLines = useMemo(() => selectedLines.filter((l) => FOOD_TYPES.includes(l.type)), [selectedLines]);
  const rentalLines = useMemo(() => selectedLines.filter((l) => l.type === 'Rental'), [selectedLines]);

  /* What this order leaves behind. Stale plans are named on their own, so the count of
     "other items" excludes them rather than mentioning them twice. */
  const stalePlans = plans.filter((p) => p.status === 'stale');
  const leftInCart = lines.length + plans.length - selectedKeys.size - stalePlans.length;

  const mode: Mode | null =
    foodLines.length > 0 && rentalLines.length > 0
      ? 'both'
      : foodLines.length > 0
        ? 'food'
        : rentalLines.length > 0
          ? 'rental'
          : null;

  const needsRentalWindow = mode === 'rental' || mode === 'both';

  /* ── Server rules ──
     Lead times and the earliest legal dates come from the API, never a constant
     here: they are owner-editable settings, and the server's clock is the one
     CreateAsync validates against — a browser in another timezone would
     otherwise disagree with the API about which dates are legal. */
  const [earliest, setEarliest] = useState<{ delivery: string; rental: string } | null>(null);
  const [days, setDays] = useState<Map<string, CalendarDay>>(new Map());
  const [rulesError, setRulesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rules = await getBookingRules();
        if (cancelled) return;
        setEarliest({
          delivery: rules.earliestDeliveryDate,
          /* RentalService follows the FULL-SERVICE lead time — Bookingservice picks
             the delivery lead only for FoodDelivery. See BookingRulesDto. */
          rental: rules.earliestFullServiceDate,
        });

        const from = rules.earliestDeliveryDate;
        const to = new Date(from);
        to.setMonth(to.getMonth() + 6);
        const rows = await getCalendarDays(from, to.toISOString().slice(0, 10));
        if (cancelled) return;
        setDays(new Map(rows.map((d) => [d.date, d])));
      } catch (err) {
        if (cancelled) return;
        /* Not fatal: the server re-validates everything on submit. The form
           stays usable and simply loses its early warnings. */
        setRulesError(
          err instanceof Error
            ? err.message
            : 'Could not load the delivery calendar; your date will be checked when you place the order.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* The floor for the shared date field. With both kinds in the cart the rental
     rule is the stricter of the two, so it wins — telling the customer a
     tomorrow delivery is fine and then rejecting the chairs would be worse than
     asking for one date that satisfies both. */
  const minDate = needsRentalWindow ? earliest?.rental : earliest?.delivery;

  /* ── Form ── */
  const [date, setDate] = useState('');
  const [time, setTime] = useState('12:00');
  const [returnDate, setReturnDate] = useState('');
  const [returnTime, setReturnTime] = useState('17:00');
  const [venue, setVenue] = useState<VenueAddress>(emptyVenueAddress);
  const [contact, setContact] = useState('');

  const [placing, setPlacing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<Placed[] | null>(null);

  /**
   * Why this date is unusable, or null.
   *
   * Deliveries are blocked whole-day by any CONFIRMED full-service event
   * (Bookingservice.DateHasConfirmedEventAsync); rentals only by an outright
   * manual closure. ConfirmedCount is incremented for FullService alone, so a
   * non-zero count means a real event — another delivery never inflates it.
   *
   * This is an early warning, not the authority: ConfirmedCount lands on the
   * event's START date only, so days 2+ of a multi-day event look clear here
   * and are still refused on submit. The server's message is surfaced verbatim
   * when that happens.
   */
  const dateProblem = useMemo(() => {
    if (!date) return null;
    const day = days.get(date);
    if (!day) return null;
    if (day.isManuallyLocked) return 'That date is closed for bookings.';
    if (mode !== 'rental' && day.confirmedCount > 0) {
      return 'That date already has a booked event, so deliveries are unavailable.';
    }
    return null;
  }, [date, days, mode]);

  const addressComplete = isVenueAddressComplete(venue);
  const contactOk = contact.trim() === '' || isCompletePhPhone(contact);
  const windowOk =
    !needsRentalWindow ||
    (returnDate !== '' && returnTime !== '' &&
      new Date(`${returnDate}T${returnTime}`) > new Date(`${date || '1970-01-01'}T${time}`));

  /* The delivery/rental form only has to be complete when there is something for it
     to place; a cart of plans alone has no product lines and no form. */
  const productFormOk =
    !mode || (date !== '' && time !== '' && addressComplete && contactOk && windowOk && !dateProblem);
  const canSubmit =
    !placing && selectedKeys.size > 0 && productFormOk && !isAdmin && !planCheck.checking && !planCheck.failed;

  /* ── Place the order ──
     Sequential, not Promise.all: each booking is created, filled and submitted
     as a unit, and if the second fails the first is already real. Reporting
     which one landed — and keeping only the un-booked lines in the cart — is
     what stops a customer re-ordering food they have already bought. */
  const placeOrder = useCallback(async () => {
    const session = readSession();
    if (!session || !user) {
      navigate(`/login?redirect=${encodeURIComponent('/checkout')}`);
      return;
    }
    if (user.role === 'admin') {
      setFormError("Admin accounts can't place customer orders. Sign in with a customer account.");
      return;
    }

    setPlacing(true);
    setFormError(null);
    const venueAddress = composeVenueAddress(venue);
    const placed: Placed[] = [];

    const base = {
      customerId: user.id,
      eventDate: date,
      startTime: apiTime(time),
      eventType: null,
      guestCount: null,
      menuPackageId: null,
      venueAddress,
      contactNumber: contact.trim() || null,
    };

    /* Food first: it is the time-critical half, and if the rentals fail the
       customer still has their delivery. */
    if (foodLines.length > 0) {
      try {
        const payload: BookingCreatePayload = {
          ...base,
          bookingType: 'FoodDelivery',
          /* Explicitly null. A delivery has no end instant, and the DTO ignores
             these for FoodDelivery — sending a window would be noise. */
          endDate: null,
          endTime: null,
        };
        const booking = await createBooking(session.token, payload);
        for (const l of foodLines) {
          if (l.type === 'MenuItem') await addMenuItem(session.token, booking.id, l.id, l.qty);
          else await addMenuTray(session.token, booking.id, l.id, l.qty);
        }
        await submitBooking(session.token, booking.id);
        placed.push({ label: 'Food delivery', ok: true, reference: booking.id, keys: foodLines.map((l) => l.key) });
      } catch (err) {
        placed.push({
          label: 'Food delivery',
          ok: false,
          keys: foodLines.map((l) => l.key),
          error: err instanceof BookingApiError || err instanceof Error
            ? err.message
            : 'Could not place the food order.',
        });
      }
    }

    if (rentalLines.length > 0) {
      try {
        const payload: BookingCreatePayload = {
          ...base,
          bookingType: 'RentalService',
          /* Required for RentalService — it is the return window, and the DTO
             rejects the booking without it. */
          endDate: returnDate,
          endTime: apiTime(returnTime),
        };
        const booking = await createBooking(session.token, payload);
        for (const l of rentalLines) {
          await addRental(session.token, booking.id, l.id, l.qty);
        }
        await submitBooking(session.token, booking.id);
        placed.push({ label: 'Equipment rental', ok: true, reference: booking.id, keys: rentalLines.map((l) => l.key) });
      } catch (err) {
        placed.push({
          label: 'Equipment rental',
          ok: false,
          keys: rentalLines.map((l) => l.key),
          error: err instanceof BookingApiError || err instanceof Error
            ? err.message
            : 'Could not place the rental order.',
        });
      }
    }

    /* Plans last, one booking each. The server places a plan all or nothing, so a
       refusal leaves nothing behind and the plan stays in the cart to be fixed. */
    for (const plan of selectedPlans) {
      try {
        const res = await checkoutPlan(session.token, plan.recipe);
        const note = await attachPlanImages(session.token, res.bookingId, plan);
        placed.push({ label: plan.title, ok: true, reference: res.bookingId, keys: [plan.key], planKey: plan.key, note });
      } catch (err) {
        placed.push({
          label: plan.title,
          ok: false,
          keys: [plan.key],
          planKey: plan.key,
          error: err instanceof Error ? err.message : 'Could not place this plan.',
          problems: err instanceof SuggestionsApiError ? err.problems : undefined,
        });
      }
    }

    /* Remove exactly what became a booking: the keys it was made from, lines and plans
       alike. Unticked entries, and anything refused, stay in the cart. */
    const done = placed.filter((p) => p.ok).flatMap((p) => p.keys);
    if (done.length > 0) removeKeys(done);
    /* A refused plan stays in the cart; re-check it so /cart shows why straight away. */
    const refused = placed.filter((p) => !p.ok && p.planKey).map((p) => p.planKey as string);
    if (refused.length > 0) recheckPlans(refused);

    setResults(placed);
    setPlacing(false);
  }, [user, venue, date, time, returnDate, returnTime, contact, foodLines, rentalLines, selectedPlans, removeKeys, recheckPlans, navigate]);

  /* ── Guards ── */
  useEffect(() => {
    if (!restored) return;
    if (results) return;
    /* Guests stay: they sign in at "Place order". Nothing ticked — an empty cart, or one
       with everything unticked — goes back to /cart, which asks for a tick. A delisted
       line or a stale plan no longer bounces anyone: it can't be ticked, so it simply
       isn't part of this order. */
    if (selectedKeys.size === 0) navigate('/cart', { replace: true });
  }, [restored, selectedKeys.size, results, navigate]);

  if (results) return <Outcome results={results} />;
  if (!restored || (!mode && selectedPlans.length === 0)) return <Shell><p className="text-text-muted">Loading…</p></Shell>;

  const foodTotal = sumOf(foodLines);
  const rentalTotal = sumOf(rentalLines);

  return (
    <Shell>
      <Link
        to="/cart"
        className="mb-6 inline-flex items-center gap-2 rounded text-[0.8rem] text-text-muted transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Back to cart
      </Link>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        {mode ? (
        <section className="rounded-2xl border border-border bg-bg-card p-5 shadow-card sm:p-8">
          <h1
            className="text-[1.75rem] font-bold text-text-primary sm:text-[2rem]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {mode === 'rental' ? 'Rental details' : 'Delivery details'}
          </h1>
          <p
            className="mt-2 text-[0.85rem] text-text-secondary"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {mode === 'both'
              ? 'Your food and your equipment are booked separately, but they share one address and date.'
              : mode === 'food'
                ? 'Just where and when to drop it off — no event details needed.'
                : 'When you need the equipment and when it goes back.'}
          </p>

          {rulesError && (
            <p
              role="status"
              className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-[0.78rem] text-text-secondary"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              <AlertCircle size={15} className="mt-px shrink-0 text-warning" aria-hidden="true" />
              {rulesError}
            </p>
          )}

          <div className="mt-7 grid gap-5">
            <Field
              label={mode === 'rental' ? 'Start date' : 'Delivery date'}
              hint={
                minDate && needsRentalWindow && mode === 'both'
                  ? 'Equipment needs more notice than food, so this is the earliest date that works for both.'
                  : undefined
              }
            >
              <input
                type="date"
                value={date}
                min={minDate}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
                style={{ fontFamily: 'var(--font-body)' }}
              />
            </Field>

            <Field label={mode === 'rental' ? 'Start time' : 'Delivery time'}>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={inputCls}
                style={{ fontFamily: 'var(--font-body)' }}
              />
            </Field>

            {dateProblem && (
              <p
                role="alert"
                className="-mt-2 flex items-start gap-2 text-[0.76rem] text-danger-ink"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
                {dateProblem}
              </p>
            )}

            {needsRentalWindow && (
              <>
                <Field label="Return date" hint="When the equipment comes back.">
                  <input
                    type="date"
                    value={returnDate}
                    min={date || minDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className={inputCls}
                    style={{ fontFamily: 'var(--font-body)' }}
                  />
                </Field>
                <Field label="Return time">
                  <input
                    type="time"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                    className={inputCls}
                    style={{ fontFamily: 'var(--font-body)' }}
                  />
                </Field>
                {!windowOk && returnDate !== '' && (
                  <p
                    role="alert"
                    className="-mt-2 text-[0.76rem] text-danger-ink"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    The return must be after the start.
                  </p>
                )}
              </>
            )}

            <div>
              <span
                className="mb-2 block text-[0.7rem] font-semibold tracking-[0.1em] text-text-muted uppercase"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {mode === 'rental' ? 'Delivery address' : 'Where to deliver'}
              </span>
              <VenueAddressFields
                value={venue}
                onChange={setVenue}
                inputClassName={inputCls}
                labelClassName="mb-1.5 block text-[0.72rem] text-text-muted"
                showName={false}
                required
              />
            </div>

            <Field label="Contact number" hint="Optional, but it helps the driver find you.">
              <PhoneNumberInput
                value={contact}
                onChange={setContact}
                className={inputCls}
                style={{ fontFamily: 'var(--font-body)' }}
              />
            </Field>
            {!contactOk && (
              <p
                role="alert"
                className="-mt-3 text-[0.76rem] text-danger-ink"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                That doesn't look like a complete mobile number.
              </p>
            )}
          </div>
        </section>
        ) : (
          <PlansIntro count={selectedPlans.length} isAdmin={isAdmin} />
        )}

        <aside className="rounded-2xl border border-border bg-bg-card p-5 shadow-card sm:p-8 lg:sticky lg:top-[calc(var(--nav-h,74px)+1.5rem)]">
          <h2
            className="mb-5 text-[1.35rem] font-bold text-text-primary sm:text-[1.6rem]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your order
          </h2>

          {/* What stays behind is said, not left to be noticed. */}
          {stalePlans.length > 0 && (
            <p
              role="status"
              className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-bg-subtle px-3.5 py-2.5 text-[0.76rem] text-text-secondary"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              <AlertCircle size={15} className="mt-px shrink-0 text-warning-ink" aria-hidden="true" />
              <span>
                {stalePlans.length === 1
                  ? `“${stalePlans[0].title}” has changed since you added it, so it’s left out.`
                  : `${stalePlans.length} planned bookings have changed since you added them, so they’re left out.`}{' '}
                <Link to="/cart" className="font-semibold underline underline-offset-2">
                  Fix in your cart
                </Link>
              </span>
            </p>
          )}
          {leftInCart > 0 && (
            <p className="mb-4 text-[0.74rem] text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
              {leftInCart === 1 ? '1 other item stays' : `${leftInCart} other items stay`} in your cart for later.
            </p>
          )}

          {foodLines.length > 0 && (
            <Bucket
              icon={<UtensilsCrossed size={15} aria-hidden="true" />}
              title="Food delivery"
              note={mode === 'both' ? 'Booked as its own order' : undefined}
              lines={foodLines}
              total={foodTotal}
            />
          )}
          {rentalLines.length > 0 && (
            <Bucket
              icon={<Package size={15} aria-hidden="true" />}
              title="Equipment rental"
              note={mode === 'both' ? 'Booked separately from the food' : undefined}
              lines={rentalLines}
              total={rentalTotal}
            />
          )}

          {selectedPlans.map((plan) => (
            <PlanBucket key={plan.key} plan={plan} />
          ))}

          <div className="my-5 h-px bg-border" />
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
              {formatPeso(foodTotal + rentalTotal + selectedPlansTotal)}
            </span>
          </div>
          <p
            className="mt-2 text-[0.72rem] text-text-muted"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            A deposit is calculated when your order is confirmed. Delivery is quoted separately.
          </p>

          {formError && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl bg-danger-muted px-3.5 py-2.5 text-[0.76rem] text-danger-ink"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              <AlertCircle size={15} className="mt-px shrink-0" aria-hidden="true" />
              {formError}
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
                We couldn’t re-check a ticked plan against today’s prices. Try again, or untick it in your cart.
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

          <button
            type="button"
            onClick={() => void placeOrder()}
            disabled={!canSubmit}
            className="mt-5 w-full cursor-pointer rounded-full bg-accent px-6 py-3.5 text-[0.85rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {placing
              ? 'Placing your order…'
              : planCheck.checking
                ? 'Checking your plans…'
                : !isAuthenticated
                ? 'Sign in to place your order'
                : mode === 'both'
                ? 'Place both orders'
                : 'Place order'}
          </button>
        </aside>
      </div>
    </Shell>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

const inputCls =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[0.85rem] text-text-primary placeholder:text-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

/**
 * The page frame, laid out as CartPage's is. The sticky bar is position: fixed and takes
 * no room, so the page starts below it by the height it publishes (--nav-h); the column
 * matches the bar's own 1200px with the same side padding, so the edges line up with
 * the logo and account actions; and the frame is a column so <main> takes the spare
 * height and the footer sits at the bottom of a short page, such as the outcome.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Navbar activePage="Checkout" placement="sticky" />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 pt-[calc(var(--nav-h,74px)+2rem)] pb-20 sm:px-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="mb-2 block text-[0.7rem] font-semibold tracking-[0.1em] text-text-muted uppercase"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span
          className="mt-1.5 block text-[0.72rem] text-text-muted"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function Bucket({
  icon,
  title,
  note,
  lines,
  total,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
  lines: CartLine[];
  total: number;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <p
        className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold tracking-[0.1em] text-text-muted uppercase"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <span className="text-text-dim">{icon}</span>
        {title}
      </p>
      {note && (
        <p
          className="mb-2 text-[0.72rem] text-text-dim"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {note}
        </p>
      )}
      <ul className="list-none space-y-1.5 p-0">
        {lines.map((l) => (
          <li key={l.key} className="flex items-baseline justify-between gap-3 text-[0.8rem]">
            <span className="min-w-0 truncate text-text-secondary" style={{ fontFamily: 'var(--font-body)' }}>
              {l.qty} × {l.snap.name}
            </span>
            <span
              className="whitespace-nowrap text-text-primary"
              style={{ fontFamily: 'var(--font-numeric)' }}
            >
              {formatPeso(l.snap.price * l.qty)}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="mt-2 text-right text-[0.8rem] font-semibold text-text-primary"
        style={{ fontFamily: 'var(--font-numeric)' }}
      >
        {formatPeso(total)}
      </p>
    </div>
  );
}

/** Stands in for the delivery form when the cart holds plans alone. */
function PlansIntro({ count, isAdmin }: { count: number; isAdmin: boolean }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5 shadow-card sm:p-8">
      <h1
        className="text-[1.75rem] font-bold text-text-primary sm:text-[2rem]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {count === 1 ? 'Place your plan' : 'Place your plans'}
      </h1>
      <p className="mt-2 text-[0.85rem] text-text-secondary" style={{ fontFamily: 'var(--font-body)' }}>
        {count === 1 ? 'Your plan already has' : 'Each plan already has'} its date, venue and menu, so there's
        nothing more to fill in. Placing it re-checks today's prices and stock first; if anything has changed,
        nothing is booked and the plan stays in your cart with what to fix.
      </p>
      {isAdmin && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl bg-danger-muted px-3.5 py-2.5 text-[0.78rem] text-danger-ink"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          <AlertCircle size={15} className="mt-px shrink-0" aria-hidden="true" />
          Admin accounts can't place customer orders. Sign in with a customer account.
        </p>
      )}
    </section>
  );
}

/** One planned booking in the order summary. */
function PlanBucket({ plan }: { plan: CartPlan }) {
  const r = plan.recipe;
  return (
    <div className="mb-5 last:mb-0">
      <p
        className="mb-1 flex items-center gap-2 text-[0.7rem] font-semibold tracking-[0.1em] text-text-muted uppercase"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <span className="text-text-dim"><CalendarDays size={15} aria-hidden="true" /></span>
        {plan.title}
      </p>
      <p className="mb-2 text-[0.72rem] text-text-dim" style={{ fontFamily: 'var(--font-body)' }}>
        {fmtDate(r.eventDate)} · {fmtTime(r.startTime)} · {r.venueAddress}
      </p>
      <ul className="list-none space-y-1.5 p-0">
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
      <p className="mt-2 text-right text-[0.8rem] font-semibold text-text-primary" style={{ fontFamily: 'var(--font-numeric)' }}>
        {formatPeso(plan.snap.total)}
      </p>
      {plan.status === 'unverified' && (
        <p className="mt-1 text-right text-[0.72rem] text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
          Checking today’s prices…
        </p>
      )}
      {plan.status === 'repriced' && plan.totalWhenAdded !== undefined && (
        <p className="mt-1 text-right text-[0.72rem] text-warning-ink" style={{ fontFamily: 'var(--font-body)' }}>
          Changed from {formatPeso(plan.totalWhenAdded)}
        </p>
      )}
    </div>
  );
}

/**
 * What happened.
 *
 * Rendered instead of the form once anything has been placed, because a mixed
 * order can half-succeed and a redirect would hide that. The failed half is
 * still in the cart, so the copy points there rather than saying "try again"
 * with nothing to try it on.
 */
function Outcome({ results }: { results: Placed[] }) {
  const allOk = results.every((r) => r.ok);
  const anyOk = results.some((r) => r.ok);

  return (
    <Shell>
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-bg-card p-8 text-center shadow-card">
        {allOk ? (
          <CheckCircle2 size={34} className="mx-auto text-accent" aria-hidden="true" />
        ) : (
          <AlertCircle size={34} className="mx-auto text-warning" aria-hidden="true" />
        )}

        <h1
          className="mt-5 text-[1.5rem] font-bold text-text-primary"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {allOk ? 'Order placed' : anyOk ? 'Partly placed' : 'Nothing was placed'}
        </h1>

        <ul className="mt-6 list-none space-y-3 p-0 text-left">
          {results.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              className="flex items-start gap-3 rounded-xl border border-border px-4 py-3"
            >
              <span className={`mt-px shrink-0 ${r.ok ? 'text-accent' : 'text-danger-ink'}`}>
                {r.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span
                  className="block text-[0.85rem] font-semibold text-text-primary"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  {r.label}
                </span>
                <span
                  className="block text-[0.78rem] text-text-secondary"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  {r.ok ? r.note ?? 'Submitted — awaiting confirmation.' : r.error}
                </span>
                {!r.ok && r.problems && r.problems.length > 1 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[0.74rem] text-text-muted">
                    {r.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
              </span>
            </li>
          ))}
        </ul>

        {!allOk && (
          <p
            className="mt-5 text-[0.8rem] text-text-muted"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Whatever didn't go through is still in your cart.
          </p>
        )}

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-full bg-accent px-6 py-3 text-[0.82rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            View my bookings
          </Link>
          {!allOk && (
            <Link
              to="/cart"
              className="rounded-full border border-border px-6 py-3 text-[0.82rem] font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Back to cart
            </Link>
          )}
        </div>
      </div>
    </Shell>
  );
}
