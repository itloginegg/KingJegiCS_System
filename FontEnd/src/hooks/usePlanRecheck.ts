import { useEffect, useRef } from 'react';
import { quoteProposal } from '../api/suggestionsApi';
import { readSession } from '../lib/tokenStorage';
import { useCart } from './useCart';

/**
 * Re-checks the planned bookings in the cart against today's catalog and calendar.
 *
 * A plan can sit in a browser for weeks. Its dishes can be delisted, its rentals
 * booked out, its date pushed inside the lead time or filled by someone else's
 * event. So every plan restored from storage comes back 'unverified', and whichever
 * page is showing the cart — /cart or /checkout — re-quotes it here with its full
 * details, including the start time, so the server also judges the date. The result
 * is folded back in by CartContext (see applyPlanCheck).
 *
 * Keyed on the plan's recipe object as well as its key: a plan edited while its
 * check was in flight keeps the new version, and the stale answer is discarded.
 */
export function usePlanRecheck() {
  const { plans, selectedPlans, restored, markPlanChecked, markPlanCheckFailed, recheckPlans } = useCart();
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!restored) return;
    const token = readSession()?.token ?? '';

    for (const plan of plans) {
      if (plan.status !== 'unverified' || inFlight.current.has(plan.key)) continue;
      const { key, recipe } = plan;
      inFlight.current.add(key);

      quoteProposal(token, {
        bookingType: recipe.bookingType,
        eventDate: recipe.eventDate,
        endDate: recipe.endDate ?? null,
        guestCount: recipe.guestCount ?? null,
        startTime: recipe.startTime,
        endTime: recipe.endTime ?? null,
        eventType: recipe.eventType ?? null,
        /* Sent so a wizard plan's names are judged against its event type on every
           re-check, as checkout will judge them — not only when it was first priced. */
        eventDetails: recipe.eventDetails ?? null,
        proposal: recipe.proposal,
      })
        .then((quote) => markPlanChecked(key, recipe, quote))
        .catch(() => markPlanCheckFailed(key, recipe))
        .finally(() => inFlight.current.delete(key));
    }
  }, [plans, restored, markPlanChecked, markPlanCheckFailed]);

  /* Every plan is re-checked, ticked or not, so an unticked one still shows what is
     wrong with it. Only the ticked ones hold checkout. */
  return {
    /** Some ticked plan hasn't been re-checked yet. Checkout waits for it. */
    checking: selectedPlans.some((p) => p.status === 'unverified'),
    /** A ticked plan's re-check couldn't reach the server. Checkout is paused until a retry works. */
    failed: selectedPlans.some((p) => p.status === 'unchecked'),
    retry: () => recheckPlans(),
  };
}
