import { useEffect, useMemo, useRef, useState } from 'react';
import {
  quoteProposal,
  SuggestionsApiError,
  type MaterializeProposal,
  type MaterializeRequest,
  type PlanEventDetails,
  type Proposal,
  type QuoteRequest,
  type QuoteResponse,
} from '../../api/suggestionsApi';
import { fetchMenuItems, fetchMenuTrays } from '../../api/menuAdminApi';
import { fetchRentalItems, type AdminRentalItem } from '../../api/rentalAdminApi';
import { fetchServiceItems, type AdminServiceItem } from '../../api/serviceAdminApi';
import { getPackageTemplate, type PackageTemplateResponse } from '../../api/bookingApi';
import { getBookingRules } from '../../api/calendarApi';
import { readSession } from '../../lib/tokenStorage';
import { isCompletePhPhone } from '../../lib/phone';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  parseVenueAddress,
  type VenueAddress,
} from '../../lib/venue';
import { snapFromQuote, type CartPlan, type CartPlanInput } from '../../context/CartContext';
import { useCart } from '../../hooks/useCart';
import { PhoneNumberInput } from '../forms/PhoneNumberInput';
import { VenueAddressFields } from '../forms/VenueAddressFields';

/*
 * Review your plan — where a plan is edited, both on its way into the cart and
 * when it is opened again from the cart to fix it.
 *
 * The guest edits the plan here: quantities, removals, additions from the catalog,
 * the dishes chosen for each package course, the date and times. Every price, line
 * total and total on screen comes from POST /api/suggestions/quote, which prices the
 * plan with the same computation a booking's own total uses. Once a start time is
 * filled in, the same call also judges the date and time with the rules booking
 * creation applies, so "that date is now inside the lead time" shows up here, live,
 * rather than as a refusal at checkout. The one figure worked out in the browser is
 * "budget remaining", the difference between two numbers the server produced.
 *
 * Nothing is saved to the server. The cart stores the recipe and the quote it was
 * saved with; checkout re-prices it and places it all or nothing.
 *
 * Needs the `pbg-` styles (PlanByBudgetStyles) mounted on the same page.
 */

const fmt = (n: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
const toHms = (t: string) => (t.length === 5 ? `${t}:00` : t);

type LineType = 'MenuItem' | 'MenuTray' | 'Rental' | 'Service';

/** Matches the EventType enum the booking rules validate against. */
const EVENT_TYPES = ['Wedding', 'Corporate', 'Birthday', 'Debut', 'Others'] as const;

const LINE_LABEL: Record<string, string> = {
  Package: 'Package',
  MenuItem: 'Dish',
  MenuTray: 'Tray',
  Rental: 'Rental',
  Service: 'Service',
};

interface EditLine {
  type: LineType;
  refId: string;
  name: string;
  quantity: number;
}

/** One thing the guest can add. `serves` sizes the default quantity for food. */
interface CatalogOption {
  id: string;
  name: string;
  price: number;
  serves?: number;
}

type Catalog = Record<LineType, CatalogOption[]>;

const sameLine = (a: { type: string; refId: string }, b: { type: string; refId: string }) =>
  a.type === b.type && a.refId === b.refId;

/** Where the editor starts: a fresh budget proposal, or a plan already in the cart. */
export type PlanReviewSource =
  | {
      kind: 'proposal';
      proposal: Proposal;
      bookingType: 'FullService' | 'FoodDelivery';
      eventDate: string;
      eventType: string | null;
      guestCount: number;
      budget: number;
    }
  | { kind: 'plan'; plan: CartPlan };

export interface PlanReviewProps {
  source: PlanReviewSource;
  /** Dish names per tray id, so a tray row says what is in it. */
  trayDishes: Record<string, string[]>;
  onClose: () => void;
  /** The plan was added to (or updated in) the cart. */
  onDone: () => void;
}

/** Everything the editor needs from its source, resolved once at mount. */
function initialFrom(source: PlanReviewSource) {
  if (source.kind === 'proposal') {
    const { proposal } = source;
    const pkg = proposal.lines.find((l) => l.type === 'Package');
    return {
      editing: null as CartPlan | null,
      bookingType: source.bookingType as MaterializeRequest['bookingType'],
      eventType: source.eventType,
      guestCount: source.guestCount,
      recipeGuestCount: source.bookingType === 'FullService' ? (source.guestCount as number | null) : null,
      eventDetails: null as PlanEventDetails | null,
      budget: source.budget as number | null,
      tier: proposal.tier as string | null,
      packageId: pkg?.refId ?? null,
      packageName: pkg?.name ?? null,
      lines: proposal.lines
        .filter((l) => l.type !== 'Package')
        .map((l) => ({ type: l.type as LineType, refId: l.refId, name: l.name, quantity: l.quantity })),
      slotPicks: Object.fromEntries(proposal.packageSlotSelections.map((s) => [s.slotId, s.itemIds])),
      eventDate: source.eventDate,
      venue: emptyVenueAddress,
      startTime: '',
      endDate: source.eventDate,
      endTime: '',
      contact: '',
    };
  }

  const { plan } = source;
  const r = plan.recipe;
  const nameOf = (type: string, refId: string) =>
    plan.snap.lines.find((l) => sameLine(l, { type, refId }))?.name ?? LINE_LABEL[type] ?? type;
  return {
    editing: plan,
    bookingType: r.bookingType,
    eventType: r.eventType ?? null,
    /* A delivery's booking stores no guest count; the fallback only sizes the
       default quantity of something newly added. */
    guestCount: r.guestCount ?? 1,
    /* Carried through untouched: this editor doesn't edit guests or event details,
       and a rental built in the wizard may have both. */
    recipeGuestCount: r.guestCount ?? null,
    eventDetails: r.eventDetails ?? null,
    budget: null,
    tier: null,
    packageId: r.proposal.packageId ?? null,
    packageName: r.proposal.packageId ? nameOf('Package', r.proposal.packageId) : null,
    lines: r.proposal.lines.map((l) => ({
      type: l.type as LineType,
      refId: l.refId,
      name: nameOf(l.type, l.refId),
      quantity: l.quantity,
    })),
    slotPicks: Object.fromEntries(r.proposal.packageSlotSelections.map((s) => [s.slotId, s.itemIds])),
    eventDate: r.eventDate,
    venue: parseVenueAddress(r.venueAddress),
    startTime: r.startTime.slice(0, 5),
    endDate: r.endDate ?? r.eventDate,
    endTime: (r.endTime ?? '').slice(0, 5),
    contact: r.contactNumber ?? '',
  };
}

export function PlanReview({ source, trayDishes, onClose, onDone }: PlanReviewProps) {
  const { addPlan, updatePlan } = useCart();
  const [init] = useState(() => initialFrom(source));
  const { editing, bookingType, guestCount, budget, tier, packageName } = init;
  const isFull = bookingType === 'FullService';
  const isRental = bookingType === 'RentalService';
  /** Events and rentals both run over a window (a rental's is its return); a delivery doesn't. */
  const hasWindow = bookingType !== 'FoodDelivery';

  /* ── the plan being edited ── */
  const [packageId, setPackageId] = useState<string | null>(init.packageId);
  const [lines, setLines] = useState<EditLine[]>(init.lines);
  const [slotPicks, setSlotPicks] = useState<Record<string, string[]>>(init.slotPicks);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);

  /* ── event details ── */
  const [eventDate, setEventDate] = useState(init.eventDate);
  const [venue, setVenue] = useState<VenueAddress>(init.venue);
  const [startTime, setStartTime] = useState(init.startTime);
  const [endDate, setEndDate] = useState(init.endDate);
  const [endTime, setEndTime] = useState(init.endTime);
  const [contact, setContact] = useState(init.contact);
  /* Empty only for a plan the assistant proposed: the budget form always asks for an
     event type, but a visitor can say "full service" in chat without naming the
     occasion — and full service can't be booked without one. Editable here rather than
     fixed at the source, because this is where the plan is completed. */
  const [eventType, setEventType] = useState(init.eventType ?? '');
  const [formError, setFormError] = useState('');

  const recipeProposal = useMemo<MaterializeProposal>(
    () => ({
      packageId,
      lines: lines.map((l) => ({ type: l.type, refId: l.refId, quantity: l.quantity })),
      packageSlotSelections: packageId
        ? Object.entries(slotPicks).map(([slotId, itemIds]) => ({ slotId, itemIds }))
        : [],
    }),
    [packageId, lines, slotPicks],
  );

  /* The details are only sent once they're complete enough to judge, so a half-typed
     time doesn't flash "end time is required" at someone still filling the form in. */
  const detailsReady = startTime !== '' && (!hasWindow || (endDate !== '' && endTime !== ''));
  const quoteBody = useMemo<QuoteRequest>(
    () => ({
      bookingType,
      eventDate,
      guestCount: init.recipeGuestCount,
      ...(detailsReady
        ? {
            startTime: toHms(startTime),
            endDate: hasWindow ? endDate || eventDate : null,
            endTime: hasWindow ? toHms(endTime) : null,
            eventType: hasWindow ? eventType || null : null,
            eventDetails: init.eventDetails,
          }
        : {}),
      proposal: recipeProposal,
    }),
    [bookingType, eventDate, init.recipeGuestCount, init.eventDetails, detailsReady, startTime, endDate, endTime, eventType, hasWindow, recipeProposal],
  );
  const quoteKey = JSON.stringify(quoteBody);

  /* ── live quote ──
     Debounced, so a run of stepper clicks is one request. Keyed, so a slow response
     for an older version of the plan can never land on top of a newer one. State is
     only ever set from the timer's promise, never synchronously inside the effect. */
  const [quoted, setQuoted] = useState<{ key: string; quote: QuoteResponse | null; error: string | null } | null>(null);
  const latestKey = useRef(quoteKey);

  useEffect(() => {
    latestKey.current = quoteKey;
    const key = quoteKey;
    const timer = window.setTimeout(() => {
      quoteProposal(readSession()?.token ?? '', JSON.parse(key) as QuoteRequest)
        .then((quote) => {
          if (latestKey.current === key) setQuoted({ key, quote, error: null });
        })
        .catch((err: unknown) => {
          if (latestKey.current !== key) return;
          setQuoted({
            key,
            quote: null,
            error: err instanceof SuggestionsApiError ? err.message : 'Could not price this plan right now.',
          });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [quoteKey]);

  const isCurrent = quoted?.key === quoteKey;
  const pricing = !isCurrent;
  const quote = isCurrent ? quoted?.quote ?? null : null;
  /* While re-pricing, the previous quote stays on screen, dimmed, so the totals
     don't blink to nothing on every click. It never enables the save button. */
  const shown = quoted?.quote ?? null;
  const quoteError = isCurrent ? quoted?.error ?? null : null;

  const quoteLine = (type: string, refId: string) =>
    shown?.lines.find((l) => sameLine(l, { type, refId }));

  /* ── earliest legal date, for the date picker ── */
  const [earliest, setEarliest] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getBookingRules()
      .then((rules) => {
        /* A rental takes the full-service lead time; only a delivery takes the shorter one. */
        if (!cancelled) setEarliest(hasWindow ? rules.earliestFullServiceDate : rules.earliestDeliveryDate);
      })
      .catch(() => {
        /* Only the picker's lower bound is lost; the quote still judges the date. */
      });
    return () => {
      cancelled = true;
    };
  }, [hasWindow]);

  /* ── catalog, for "add to this plan" ── */
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    const token = readSession()?.token ?? '';
    void Promise.allSettled([
      fetchMenuItems(token),
      fetchMenuTrays(token),
      /* A delivery can only carry food (EnsureNotDeliveryAsync), so rentals and
         services are not offered for one at all. */
      hasWindow ? fetchRentalItems(token) : Promise.resolve([] as AdminRentalItem[]),
      isFull ? fetchServiceItems(token) : Promise.resolve([] as AdminServiceItem[]),
    ]).then(([items, trays, rentals, services]) => {
      if (cancelled) return;
      const ok = <T,>(r: PromiseSettledResult<T[]>): T[] => (r.status === 'fulfilled' ? r.value : []);
      setCatalog({
        MenuItem: ok(items)
          .filter((i) => i.isActive && i.pricePerTray != null)
          .map((i) => ({ id: i.id, name: i.itemName, price: i.pricePerTray as number, serves: i.servesPerTray })),
        MenuTray: ok(trays)
          .filter((t) => t.isActive)
          .map((t) => ({ id: t.id, name: t.trayName, price: t.pricePerTray, serves: t.servesMin })),
        Rental: ok(rentals)
          .filter((r) => r.isActive)
          .map((r) => ({ id: r.id, name: r.itemName, price: r.unitPrice })),
        Service: ok(services)
          .filter((s) => s.isActive)
          .map((s) => ({ id: s.id, name: s.serviceName, price: s.unitCost })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isFull, hasWindow]);

  const addTypes: LineType[] = isFull
    ? ['MenuTray', 'MenuItem', 'Rental', 'Service']
    : isRental
      ? ['Rental']
      : ['MenuTray', 'MenuItem'];
  const [addType, setAddType] = useState<LineType>(isRental ? 'Rental' : 'MenuTray');
  const [addId, setAddId] = useState('');

  /* ── package courses ── */
  const [template, setTemplate] = useState<PackageTemplateResponse | null>(null);
  useEffect(() => {
    if (!packageId) return;
    let cancelled = false;
    getPackageTemplate(readSession()?.token ?? '', packageId)
      .then((t) => {
        if (!cancelled) setTemplate(t);
      })
      .catch(() => {
        /* The courses stay read-only; the quote still judges the existing choices. */
      });
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  /* ── edits ── */
  const setQty = (line: EditLine, qty: number) =>
    setLines((prev) =>
      prev.map((l) => (sameLine(l, line) ? { ...l, quantity: Math.max(1, Math.min(999, Math.floor(qty))) } : l)),
    );

  const removeLine = (line: EditLine) => setLines((prev) => prev.filter((l) => !sameLine(l, line)));

  const removePackage = () => {
    setPackageId(null);
    setSlotPicks({});
    setEditingSlot(null);
  };

  const addLine = () => {
    const option = catalog?.[addType].find((o) => o.id === addId);
    if (!option) return;
    const existing = lines.find((l) => sameLine(l, { type: addType, refId: option.id }));
    if (existing) {
      setQty(existing, existing.quantity + 1);
    } else {
      /* Food defaults to enough to cover the guests, the same ceil(guests / serves)
         a booking uses when no quantity is given. Everything else starts at one. */
      const quantity = option.serves ? Math.max(1, Math.ceil(guestCount / Math.max(1, option.serves))) : 1;
      setLines((prev) => [...prev, { type: addType, refId: option.id, name: option.name, quantity }]);
    }
    setAddId('');
  };

  const toggleDish = (slotId: string, itemId: string, chooseCount: number) =>
    setSlotPicks((prev) => {
      const current = prev[slotId] ?? [];
      if (current.includes(itemId)) return { ...prev, [slotId]: current.filter((i) => i !== itemId) };
      if (current.length >= chooseCount) return prev;
      return { ...prev, [slotId]: [...current, itemId] };
    });

  const changeEventDate = (next: string) => {
    setEventDate(next);
    /* An event can't end before it starts, so the end date follows a later start. */
    if (endDate && next && endDate < next) setEndDate(next);
  };

  /* ── save ── */
  const detailsProblem = (() => {
    if (!eventDate) return 'Choose a date.';
    if (!isVenueAddressComplete(venue)) return isFull ? 'Add the venue street and city.' : 'Add the delivery street and city.';
    if (!startTime) return hasWindow ? 'Add a start time.' : 'Add a delivery time.';
    if (hasWindow) {
      if (!endDate || !endTime) return isRental ? 'Add the return date and time.' : 'Add the end date and time.';
      if (new Date(`${endDate}T${toHms(endTime)}`) <= new Date(`${eventDate}T${toHms(startTime)}`)) {
        return isRental ? 'The return must be after the start.' : 'The event must end after it starts.';
      }
    }
    if (isFull && !eventType) return 'Choose an event type.';
    if (contact.trim() !== '' && !isCompletePhPhone(contact)) return "That contact number doesn't look complete.";
    return null;
  })();

  const isEmpty = lines.length === 0 && !packageId;
  const canSave = !pricing && !!quote && quote.canCheckout && !isEmpty;

  const save = () => {
    if (!quote || !canSave) return;
    if (detailsProblem) {
      setFormError(detailsProblem);
      return;
    }
    const recipe: MaterializeRequest = {
      bookingType,
      eventDate,
      startTime: toHms(startTime),
      endDate: hasWindow ? endDate || eventDate : null,
      endTime: hasWindow ? toHms(endTime) : null,
      eventType: hasWindow ? eventType || null : null,
      venueAddress: composeVenueAddress(venue),
      guestCount: init.recipeGuestCount,
      contactNumber: contact.trim() || null,
      eventDetails: init.eventDetails,
      proposal: recipeProposal,
    };
    const input: CartPlanInput = {
      title:
        editing?.title ??
        (isFull ? `${eventType || 'Event'} · ${guestCount} guests` : `Food delivery · ${guestCount} guests`),
      recipe,
      snap: snapFromQuote(quote),
      imageNames: editing?.imageNames,
    };
    if (editing) updatePlan(editing.key, input);
    else addPlan(input);
    onDone();
  };

  const packageQuote = packageId ? quoteLine('Package', packageId) : undefined;
  const slots = packageId ? shown?.packageSlots ?? [] : [];
  const templateSlots = template && template.packageId === packageId ? template.slots : [];
  const remaining = shown && budget !== null ? budget - shown.total : null;
  const headerProblem = shown?.headerProblem ?? null;

  return (
    <div className="pbg-overlay" onClick={onClose}>
      <div
        className="pbg-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit your plan' : 'Review your plan'}
        style={{ maxWidth: 760 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.2rem' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
              {editing ? 'Edit your plan' : 'Review your plan'}
            </h3>
            <p className="pbg-sub" style={{ fontSize: '0.74rem' }}>
              {editing
                ? editing.title
                : `${tier} plan · ${guestCount} guests${budget !== null ? ` · budget ${fmt(budget)}` : ''}`}
            </p>
          </div>
          <button type="button" className="pbg-btn outline" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* ── lines ── */}
        <span className="pbg-label">In this plan</span>
        <div className="pbg-card" style={{ padding: '0.3rem 1rem', marginBottom: '1.1rem' }}>
          {isEmpty && (
            <p className="pbg-sub" style={{ padding: '0.9rem 0', fontSize: '0.8rem' }}>
              This plan is empty. Add a tray, dish or service below.
            </p>
          )}

          {packageId && (
            <div className="pbg-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pbg-line-name">{packageQuote?.name ?? packageName ?? 'Menu package'}</div>
                <div className="pbg-sub">Package for {guestCount} guests</div>
                {packageQuote?.problem && <div className="pbg-problem">{packageQuote.problem}</div>}
              </div>
              <span className="pbg-tag">{LINE_LABEL.Package}</span>
              <span className="pbg-line-total" style={{ opacity: pricing ? 0.5 : 1 }}>
                {packageQuote && !packageQuote.problem ? fmt(packageQuote.lineTotal) : '—'}
              </span>
              <button type="button" className="pbg-link" onClick={removePackage} aria-label="Remove the package">
                Remove
              </button>
            </div>
          )}

          {lines.map((line) => {
            const q = quoteLine(line.type, line.refId);
            const dishes = line.type === 'MenuTray' ? trayDishes[line.refId] : undefined;
            return (
              <div key={`${line.type}-${line.refId}`} className="pbg-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pbg-line-name">{q?.name ?? line.name}</div>
                  {dishes && dishes.length > 0 && <div className="pbg-sub">{dishes.join(' · ')}</div>}
                  {q && !q.problem && <div className="pbg-sub">{fmt(q.unitPrice)} each</div>}
                  {q?.problem && <div className="pbg-problem">{q.problem}</div>}
                </div>
                <span className="pbg-tag">{LINE_LABEL[line.type]}</span>
                <span className="pbg-step">
                  <button
                    type="button"
                    onClick={() => setQty(line, line.quantity - 1)}
                    disabled={line.quantity <= 1}
                    aria-label={`One fewer ${line.name}`}
                  >
                    −
                  </button>
                  <span style={{ minWidth: '1.8rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600 }}>
                    {line.quantity}
                  </span>
                  <button type="button" onClick={() => setQty(line, line.quantity + 1)} aria-label={`One more ${line.name}`}>
                    +
                  </button>
                </span>
                <span className="pbg-line-total" style={{ opacity: pricing ? 0.5 : 1 }}>
                  {q && !q.problem ? fmt(q.lineTotal) : '—'}
                </span>
                <button type="button" className="pbg-link" onClick={() => removeLine(line)} aria-label={`Remove ${line.name}`}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>

        {/* ── package courses ── */}
        {packageId && slots.length > 0 && (
          <>
            <span className="pbg-label">Package courses</span>
            <div className="pbg-card" style={{ padding: '0.3rem 1rem', marginBottom: '1.1rem' }}>
              {slots.map((slot) => {
                const options = templateSlots.find((s) => s.slotId === slot.slotId)?.eligibleItems ?? [];
                const picked = slotPicks[slot.slotId] ?? [];
                const open = editingSlot === slot.slotId;
                return (
                  <div key={slot.slotId} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'baseline' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="pbg-line-name">
                          {slot.slotLabel} <span className="pbg-sub">choose {slot.chooseCount}</span>
                        </div>
                        <div className="pbg-sub" style={{ fontSize: '0.74rem' }}>
                          {slot.itemNames.length > 0 ? slot.itemNames.join(', ') : 'Nothing chosen yet'}
                        </div>
                        {slot.problem && <div className="pbg-problem">{slot.problem}</div>}
                      </div>
                      {options.length > 0 && (
                        <button type="button" className="pbg-link" onClick={() => setEditingSlot(open ? null : slot.slotId)}>
                          {open ? 'Done' : 'Change'}
                        </button>
                      )}
                    </div>
                    {open && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.35rem 0.9rem', marginTop: '0.6rem' }}>
                        {options.map((item) => {
                          const checked = picked.includes(item.id);
                          const full = !checked && picked.length >= slot.chooseCount;
                          return (
                            <label
                              key={item.id}
                              style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: full ? 'var(--text-dim)' : 'var(--text-primary)', cursor: full ? 'not-allowed' : 'pointer' }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={full}
                                onChange={() => toggleDish(slot.slotId, item.id, slot.chooseCount)}
                              />
                              {item.itemName}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── add from the catalog ── */}
        <span className="pbg-label">Add to this plan</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 0.6fr) minmax(0, 1.4fr) auto', gap: '0.6rem', marginBottom: '1.3rem' }}>
          <select
            className="pbg-input"
            aria-label="What to add"
            value={addType}
            onChange={(e) => {
              setAddType(e.target.value as LineType);
              setAddId('');
            }}
          >
            {addTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'MenuTray' ? 'Trays' : t === 'MenuItem' ? 'Dishes' : t === 'Rental' ? 'Rentals' : 'Services'}
              </option>
            ))}
          </select>
          <select
            className="pbg-input"
            aria-label="Item to add"
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            disabled={!catalog}
          >
            <option value="">{catalog ? 'Choose…' : 'Loading the catalog…'}</option>
            {(catalog?.[addType] ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {fmt(o.price)}
              </option>
            ))}
          </select>
          <button type="button" className="pbg-btn outline" onClick={addLine} disabled={!addId}>
            Add
          </button>
        </div>

        {/* ── event details ── */}
        <span className="pbg-label">{isFull ? 'Event details' : isRental ? 'Rental details' : 'Delivery details'}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginBottom: '1.3rem' }}>
          <VenueAddressFields
            value={venue}
            onChange={setVenue}
            labelClassName="pbg-label"
            inputClassName="pbg-input"
            required
            labels={{ street: isFull ? 'Venue street' : 'Delivery street' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.9rem' }}>
            {/* Shown only when the plan arrived without one — see the eventType state. */}
            {hasWindow && !init.eventType && (
              <label>
                <span className="pbg-label">Event type{isRental ? ' (optional)' : ''}</span>
                <select
                  className="pbg-input"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  required={isFull}
                >
                  <option value="">Select…</option>
                  {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
            )}
            <label>
              <span className="pbg-label">{isFull ? 'Event date' : isRental ? 'Start date' : 'Delivery date'}</span>
              <input className="pbg-input" type="date" value={eventDate} min={earliest} onChange={(e) => changeEventDate(e.target.value)} required />
            </label>
            <label>
              <span className="pbg-label">{hasWindow ? 'Start time' : 'Delivery time'}</span>
              <input className="pbg-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </label>
            {hasWindow && (
              <label>
                <span className="pbg-label">{isRental ? 'Return date' : 'End date'}</span>
                <input className="pbg-input" type="date" value={endDate} min={eventDate} onChange={(e) => setEndDate(e.target.value)} required />
              </label>
            )}
            {hasWindow && (
              <label>
                <span className="pbg-label">{isRental ? 'Return time' : 'End time'}</span>
                <input className="pbg-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </label>
            )}
          </div>
          {headerProblem && (
            <div className="pbg-problem" role="alert" style={{ fontSize: '0.78rem' }}>
              {headerProblem}
            </div>
          )}
          <label>
            <span className="pbg-label">Contact number (optional)</span>
            <PhoneNumberInput className="pbg-input" value={contact} onChange={setContact} />
          </label>
        </div>

        {/* ── totals ── */}
        <div className="pbg-card" style={{ padding: '0.9rem 1.1rem', background: 'var(--bg-subtle)', opacity: pricing ? 0.6 : 1 }} aria-live="polite">
          {shown ? (
            <>
              <div className="pbg-total-row"><span>Subtotal</span><span>{fmt(shown.subtotal)}</span></div>
              <div className="pbg-total-row"><span>Tax</span><span>{fmt(shown.tax)}</span></div>
              <div className="pbg-total-row grand"><span>Total</span><span>{fmt(shown.total)}</span></div>
              {remaining !== null && (
                <div className="pbg-total-row">
                  <span>{remaining >= 0 ? 'Budget remaining' : 'Over budget by'}</span>
                  <span style={{ color: remaining >= 0 ? 'var(--primary)' : 'var(--danger-ink)' }}>{fmt(Math.abs(remaining))}</span>
                </div>
              )}
            </>
          ) : (
            <p className="pbg-sub" style={{ margin: 0, fontSize: '0.78rem' }}>{quoteError ?? 'Pricing your plan…'}</p>
          )}
          {pricing && shown && <p className="pbg-sub" style={{ margin: '0.4rem 0 0' }}>Updating…</p>}
        </div>

        {quoteError && shown && <div className="pbg-problem" style={{ marginTop: '0.6rem' }}>{quoteError}</div>}
        {quote && !quote.canCheckout && (
          <div className="pbg-problem" style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}>
            Fix what's marked above before {editing ? 'saving this plan' : 'adding this plan to your cart'}.
          </div>
        )}
        {formError && <div className="pbg-problem" style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}>{formError}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginTop: '1.1rem', flexWrap: 'wrap' }}>
          <span className="pbg-sub" style={{ flex: 1, minWidth: 200, fontSize: '0.72rem' }}>
            Nothing is booked yet. You'll sign in and place the order at checkout.
          </span>
          <button type="button" className="pbg-btn outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="pbg-btn primary"
            onClick={() => {
              setFormError('');
              save();
            }}
            disabled={!canSave}
          >
            {editing ? 'Save changes' : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}
