import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { MaterializeRequest, QuoteResponse } from '../api/suggestionsApi';
import { dropAllPlanImages, dropPlanImages } from '../lib/planImages';

/**
 * The shared cart — menu items, menu trays and rental items in one list.
 *
 * WHY A CONTEXT AND NOT PAGE STATE. RentalPage and MenuPage each kept their own
 * `useState`, so a guest who put chairs in the rental list and then walked to
 * /menus had two carts that could not see each other, and neither survived a
 * refresh. A booking can carry food AND rentals, so the cart has to outlive the
 * page that filled it.
 *
 * WHAT IS PERSISTED, AND WHY IT IS NOT THE PRICE. localStorage holds only
 * `{ type, id, qty }` plus a display snapshot. The snapshot exists so /cart can
 * paint immediately on a cold load; it is NEVER the figure that is charged.
 * Every line is reconciled against the live catalog before checkout is allowed,
 * because a cart can sit in a browser for weeks and a persisted ₱4,500 that the
 * owner has since raised to ₱5,200 is a price the backend will not honour.
 * RentalPage already worked this way (it stored id → qty and joined against the
 * fetched catalog); this generalises that choice rather than MenuPage's, which
 * stored the price inline.
 *
 * PLANS. The cart also holds whole planned bookings (see CartPlan). They sit in
 * their own list and their own storage key: a plan is a recipe, not a catalog row,
 * so product reconciliation has nothing to say about it, and keeping it apart
 * leaves the product cart's stored shape exactly as it was.
 */

export type CartItemType = 'MenuItem' | 'MenuTray' | 'Rental';

/** The stable identity of a line. `${type}:${id}` — a tray and an item may share an id. */
export type CartKey = string;

export function cartKeyOf(type: CartItemType, id: string): CartKey {
  return `${type}:${id}`;
}

/**
 * What the cart shows for a line. `price` is per unit; `meta` is the small grey
 * line under the title — a rental's category, a tray's serving range.
 */
export interface CartSnapshot {
  name: string;
  price: number;
  image: string | null;
  meta?: string;
}

/**
 * How far a line can be trusted.
 *
 * - `unverified` — restored from localStorage, catalog not consulted yet.
 * - `ok`         — matched a live catalog row; name/price/image are current.
 * - `repriced`   — matched, but the price moved. The user is told rather than
 *                  silently charged the new figure.
 * - `unavailable`— no longer in the catalog (delisted or deactivated). Blocks
 *                  checkout until removed.
 */
export type CartLineStatus = 'unverified' | 'ok' | 'repriced' | 'unavailable' | 'reduced';

export interface CartLine {
  key: CartKey;
  type: CartItemType;
  id: string;
  qty: number;
  snap: CartSnapshot;
  status: CartLineStatus;
  /** Set only when status is 'repriced' — what it cost when it went in. */
  priceWhenAdded?: number;
  /** Units available today. Undefined for menu lines, which have no shelf stock. */
  stock?: number;
}

/** One priced line of a planned booking, as it was quoted when the plan went in. */
export interface CartPlanLine {
  type: string;
  refId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** One package course of a planned booking and the dishes chosen for it. */
export interface CartPlanSlot {
  slotId: string;
  slotLabel: string;
  itemNames: string[];
}

/**
 * How far a planned booking can be trusted. Derived, never persisted — like a
 * product line's status, trust is re-earned on every load.
 *
 * - `unverified` — restored from storage, not re-checked yet. Checkout waits.
 * - `ok`         — re-quoted just now (or just saved): still bookable as it is.
 * - `repriced`   — still bookable, but the total moved; the new total is shown and
 *                  the customer is told what it was.
 * - `stale`      — can't be booked as it is: something was delisted or booked out,
 *                  or the date or time no longer works. Blocks checkout.
 * - `unchecked`  — the re-check couldn't reach the server. Blocks checkout until a
 *                  retry succeeds, the same stance /cart takes on unpriced products.
 */
export type CartPlanStatus = 'unverified' | 'ok' | 'repriced' | 'stale' | 'unchecked';

/**
 * A whole booking waiting in the cart, built and priced in the plan editor.
 *
 * `recipe` is exactly what checkout sends to POST /api/suggestions/checkout.
 * `snap` is the quote the plan was added with — a display snapshot, like a product
 * line's, never the figure charged: checkout re-prices the recipe and refuses the
 * whole plan if anything in it has changed.
 */
export interface CartPlan {
  key: string;
  title: string;
  recipe: MaterializeRequest;
  snap: {
    lines: CartPlanLine[];
    slots: CartPlanSlot[];
    subtotal: number;
    tax: number;
    total: number;
  };
  addedAt: string;
  /**
   * Names of the reference images picked for this plan in the booking wizard. The files
   * themselves only live in memory (lib/planImages); the names persist so a refresh
   * that lost them can be owned up to rather than go unnoticed.
   */
  imageNames?: { motif?: string; theme?: string };

  /* ── derived on load; not persisted ── */
  status: CartPlanStatus;
  /** Every reason a stale plan can't be booked. */
  problems?: string[];
  /** The date/time/guest-count reason among them, if any — it has its own fix. */
  headerProblem?: string | null;
  /** Set when a re-check moved the total: what it was when the customer last saw it. */
  totalWhenAdded?: number;
}

/** What the plan editor hands the cart. Everything else is the cart's to derive. */
export type CartPlanInput = Pick<CartPlan, 'title' | 'recipe' | 'snap' | 'imageNames'>;

/** One live catalog row, in the shape reconciliation needs. */
export interface ReconcileRow {
  id: string;
  name: string;
  price: number;
  image: string | null;
  meta?: string;
  stock?: number;
}

interface CartState {
  lines: CartLine[];
  /** Planned bookings. Kept apart from `lines`: a plan has no catalog row to reconcile against. */
  plans: CartPlan[];
  /** False until the first localStorage read lands, so an empty cart never overwrites a real one. */
  restored: boolean;
  /**
   * Bumped on every RESTORE, including the ones the cross-tab storage listener
   * fires. Consumers that reconcile against the catalog watch this rather than
   * `restored`, which latches true and then never changes again — so a cart
   * edited in another tab arrived back as 'unverified' lines with nothing left to
   * trigger a re-check, and /cart went on offering checkout over them.
   */
  revision: number;
}

type CartAction =
  | { type: 'RESTORE'; lines: CartLine[]; plans: CartPlan[] }
  | { type: 'ADD'; line: Omit<CartLine, 'status'> }
  | { type: 'SET_QTY'; key: CartKey; qty: number }
  | { type: 'REMOVE'; key: CartKey }
  | { type: 'CLEAR' }
  | { type: 'ADD_PLAN'; plan: CartPlan }
  | { type: 'REMOVE_PLAN'; key: string }
  | { type: 'UPDATE_PLAN'; key: string; plan: CartPlanInput }
  | { type: 'PLAN_CHECKED'; key: string; recipe: MaterializeRequest; quote: QuoteResponse }
  | { type: 'PLAN_CHECK_FAILED'; key: string; recipe: MaterializeRequest }
  | { type: 'RECHECK_PLANS'; keys?: string[] }
  | { type: 'CLEAR_TYPES'; types: CartItemType[] }
  | { type: 'RECONCILE'; itemType: CartItemType; rows: ReconcileRow[] };

const STORAGE_KEY = 'kingjegi.cart.v1';
/** Plans live under their own key, so the product cart's stored shape is untouched. */
const PLANS_KEY = 'kingjegi.cart.plans.v1';
const MAX_QTY = 99;

/* ── persistence ────────────────────────────────────────────────────────── */

/**
 * Read the saved cart.
 *
 * Deliberately defensive: this parses whatever the user (or another script) has
 * left in localStorage, and one malformed entry must drop that line rather than
 * throw on render. A restored line is always 'unverified' whatever was saved —
 * trust is re-earned from the catalog on every load, never read back from disk.
 */
function readStored(): CartLine[] {
  if (typeof window === 'undefined') return [];

  /* No initialiser: the catch returns, so every path that reaches the read below
     has assigned it, and letting TypeScript prove that catches a future branch
     that forgets to. */
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* Safari private mode throws on access. A cart that cannot persist still works. */
    return [];
  }
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const out: CartLine[] = [];
    for (const row of parsed) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      const type = r.type;
      const id = r.id;
      const qty = r.qty;
      const snap = r.snap as Record<string, unknown> | undefined;

      if (type !== 'MenuItem' && type !== 'MenuTray' && type !== 'Rental') continue;
      if (typeof id !== 'string' || id === '') continue;
      if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 1) continue;
      if (!snap || typeof snap.name !== 'string') continue;

      out.push({
        key: cartKeyOf(type, id),
        type,
        id,
        qty: Math.min(Math.floor(qty), MAX_QTY),
        snap: {
          name: snap.name,
          price:
            typeof snap.price === 'number' && Number.isFinite(snap.price) ? snap.price : 0,
          image: typeof snap.image === 'string' ? snap.image : null,
          meta: typeof snap.meta === 'string' ? snap.meta : undefined,
        },
        status: 'unverified',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Read the saved plans. As defensive as readStored: anything that isn't shaped
 * like a plan checkout could send is dropped rather than allowed to throw later.
 */
function readStoredPlans(): CartPlan[] {
  if (typeof window === 'undefined') return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PLANS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    /* Only the persisted fields are trusted back; status starts over. */
    return Array.isArray(parsed)
      ? parsed.filter(isStoredPlan).map((p) => ({
          key: p.key,
          title: p.title,
          recipe: p.recipe,
          snap: p.snap,
          addedAt: p.addedAt,
          imageNames: p.imageNames,
          status: 'unverified' as const,
        }))
      : [];
  } catch {
    return [];
  }
}

function isStoredPlan(value: unknown): value is CartPlan {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  const recipe = p.recipe as Record<string, unknown> | undefined;
  const proposal = recipe?.proposal as Record<string, unknown> | undefined;
  const snap = p.snap as Record<string, unknown> | undefined;
  return (
    typeof p.key === 'string' &&
    typeof p.title === 'string' &&
    typeof p.addedAt === 'string' &&
    !!recipe &&
    typeof recipe.bookingType === 'string' &&
    typeof recipe.eventDate === 'string' &&
    typeof recipe.startTime === 'string' &&
    typeof recipe.venueAddress === 'string' &&
    !!proposal &&
    Array.isArray(proposal.lines) &&
    Array.isArray(proposal.packageSlotSelections) &&
    !!snap &&
    Array.isArray(snap.lines) &&
    Array.isArray(snap.slots) &&
    typeof snap.total === 'number'
  );
}

function writeStoredPlans(plans: CartPlan[]): void {
  if (typeof window === 'undefined') return;
  try {
    /* The derived fields stay behind, for the reason CartLine's status does: a saved
       'ok' would outlive the check that justified it. */
    const slim = plans.map(({ key, title, recipe, snap, addedAt, imageNames }) => ({ key, title, recipe, snap, addedAt, imageNames }));
    window.localStorage.setItem(PLANS_KEY, JSON.stringify(slim));
  } catch {
    /* Quota exceeded or private mode — the in-memory cart is still correct. */
  }
}

function writeStored(lines: CartLine[]): void {
  if (typeof window === 'undefined') return;
  try {
    /* status/priceWhenAdded/stock are all derived from the catalog, so they are
       deliberately not persisted — saving them would let a stale 'ok' outlive
       the fetch that justified it. */
    const slim = lines.map((l) => ({ type: l.type, id: l.id, qty: l.qty, snap: l.snap }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    /* Quota exceeded or private mode — the in-memory cart is still correct. */
  }
}

/** A quote in the shape a plan keeps: what the cart and checkout display. */
export function snapFromQuote(quote: QuoteResponse): CartPlan['snap'] {
  return {
    lines: quote.lines.map((l) => ({
      type: l.type,
      refId: l.refId,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    slots: quote.packageSlots.map((s) => ({ slotId: s.slotId, slotLabel: s.slotLabel, itemNames: s.itemNames })),
    subtotal: quote.subtotal,
    tax: quote.tax,
    total: quote.total,
  };
}

/**
 * Folds a fresh quote into a plan — RECONCILE's job, for a recipe.
 *
 * A plan the booking would refuse keeps its last good snapshot and becomes stale
 * with the reasons, so the customer still sees what they planned next to what is
 * wrong with it. A bookable plan takes the live figures: showing the old total would
 * mean quoting a price checkout is about to charge differently.
 */
function applyPlanCheck(plan: CartPlan, quote: QuoteResponse): CartPlan {
  if (!quote.canCheckout) {
    return { ...plan, status: 'stale', problems: quote.problems, headerProblem: quote.headerProblem };
  }
  const moved = quote.total !== plan.snap.total;
  const totalWhenAdded = moved ? plan.totalWhenAdded ?? plan.snap.total : plan.totalWhenAdded;
  return {
    ...plan,
    snap: snapFromQuote(quote),
    status: totalWhenAdded !== undefined ? 'repriced' : 'ok',
    totalWhenAdded,
    problems: undefined,
    headerProblem: undefined,
  };
}

/* ── reducer ────────────────────────────────────────────────────────────── */

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'RESTORE':
      return { lines: action.lines, plans: action.plans, restored: true, revision: state.revision + 1 };

    case 'ADD': {
      const existing = state.lines.some((l) => l.key === action.line.key);
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((l) =>
            l.key === action.line.key
              ? /* Adding again refreshes the snapshot: the catalog the user is
                   looking at right now is newer than whatever is in the line. */
                {
                  ...l,
                  /* Clamped by the shelf, not just by MAX_QTY. The catalog says
                     how many exist, and queueing more only defers the rejection
                     to confirm time, where the backend re-validates anyway. */
                  qty: Math.min(l.qty + action.line.qty, action.line.stock ?? MAX_QTY),
                  snap: action.line.snap,
                  stock: action.line.stock,
                  priceWhenAdded: undefined,
                  status: 'ok' as const,
                }
              : l,
          ),
        };
      }
      return {
        ...state,
        lines: [
          ...state.lines,
          {
            ...action.line,
            qty: Math.min(action.line.qty, action.line.stock ?? MAX_QTY),
            status: 'ok',
          },
        ],
      };
    }

    case 'SET_QTY': {
      const target = state.lines.find((l) => l.key === action.key);
      if (!target) return state;
      /* A rental restored from localStorage carries no stock figure until the
         catalog is consulted, and falling back to MAX_QTY let the stepper run to
         99 on a two-in-stock item in that window. Held at what it was restored
         with instead, until reconciliation supplies a real ceiling.

         Keyed on TYPE, not on `stock === undefined`: menu items and trays are
         cooked to order and have no shelf at all, so an undefined stock there
         means "no ceiling" rather than "not looked up yet", and treating the two
         the same would freeze a tray at its restored quantity forever. */
      const awaitingStock = target.type === 'Rental' && target.status === 'unverified';
      const ceiling = target.stock ?? (awaitingStock ? Math.max(1, target.qty) : MAX_QTY);
      const qty = Math.max(0, Math.min(Math.floor(action.qty), ceiling));
      if (qty === 0) return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
      return { ...state, lines: state.lines.map((l) => (l.key === action.key ? { ...l, qty } : l)) };
    }

    case 'REMOVE':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };

    case 'CLEAR':
      return { ...state, lines: [], plans: [] };

    case 'ADD_PLAN':
      return { ...state, plans: [...state.plans, action.plan] };

    case 'REMOVE_PLAN':
      return { ...state, plans: state.plans.filter((p) => p.key !== action.key) };

    case 'UPDATE_PLAN':
      return {
        ...state,
        plans: state.plans.map((p) =>
          p.key === action.key
            ? /* Just priced in the editor, so it is as fresh as a check. */
              { ...p, ...action.plan, status: 'ok', problems: undefined, headerProblem: undefined, totalWhenAdded: undefined }
            : p,
        ),
      };

    /* Both results are matched on the recipe object as well as the key: a plan
       edited while its check was in flight has a new recipe, and the old answer
       must not land on it. */
    case 'PLAN_CHECKED':
      return {
        ...state,
        plans: state.plans.map((p) =>
          p.key === action.key && p.recipe === action.recipe ? applyPlanCheck(p, action.quote) : p,
        ),
      };

    case 'PLAN_CHECK_FAILED':
      return {
        ...state,
        plans: state.plans.map((p) =>
          p.key === action.key && p.recipe === action.recipe ? { ...p, status: 'unchecked' } : p,
        ),
      };

    case 'RECHECK_PLANS':
      return {
        ...state,
        plans: state.plans.map((p) =>
          (action.keys ? action.keys.includes(p.key) : p.status === 'unchecked' || p.status === 'stale')
            ? { ...p, status: 'unverified' }
            : p,
        ),
      };

    case 'CLEAR_TYPES':
      return { ...state, lines: state.lines.filter((l) => !action.types.includes(l.type)) };

    case 'RECONCILE': {
      const live = new Map(action.rows.map((r) => [r.id, r]));
      return {
        ...state,
        lines: state.lines.map((l) => {
          if (l.type !== action.itemType) return l;
          const row = live.get(l.id);
          if (!row) return { ...l, status: 'unavailable' as const };

          /* Only call it a reprice if the line had already been verified once.
             An 'unverified' line's snapshot is a cache, not a quote the user
             was shown, so flagging it would cry wolf on every cold load. */
          const moved = l.status !== 'unverified' && row.price !== l.snap.price;

          /* Clamp to what is actually on the shelf. The catalog is the authority
             on stock, and it can fall while a cart sits in localStorage — someone
             else books the last six chairs. Carrying the old quantity through
             meant the row rendered "Only 2 available" while still showing 5 and
             billing for 5, and the rejection only surfaced at confirm time where
             the backend re-validates. */
          const ceiling = row.stock ?? MAX_QTY;
          const qty = Math.min(l.qty, ceiling);
          const cut = qty < l.qty;

          return {
            ...l,
            qty,
            /* The live figure wins. Showing the old one would mean quoting a
               total the booking endpoint is going to reject. */
            snap: {
              name: row.name,
              price: row.price,
              image: row.image,
              meta: row.meta ?? l.snap.meta,
            },
            priceWhenAdded: moved ? l.snap.price : undefined,
            /* A cut outranks a reprice in the status: both are worth telling the
               customer, but losing three of their chairs is the one that changes
               what they are about to book. The price move still shows, because
               priceWhenAdded is set independently of the status. */
            status: cut
              ? ('reduced' as const)
              : moved
                ? ('repriced' as const)
                : ('ok' as const),
            stock: row.stock,
          };
        }),
      };
    }

    default:
      return state;
  }
}

/* ── context ────────────────────────────────────────────────────────────── */

export interface CartContextValue {
  lines: CartLine[];
  /** Total pieces across every line — what the navbar badge shows. */
  pieces: number;
  /** Σ price × qty over lines that are still purchasable. */
  subtotal: number;
  /** True while any line is unavailable or any plan is stale — checkout must not proceed. */
  hasBlockingIssue: boolean;
  restored: boolean;
  /** Changes whenever the cart is (re)loaded from storage. See CartState.revision. */
  revision: number;

  addItem: (input: {
    type: CartItemType;
    id: string;
    qty?: number;
    name: string;
    price: number;
    image: string | null;
    meta?: string;
    stock?: number;
  }) => void;
  setQty: (key: CartKey, qty: number) => void;
  removeItem: (key: CartKey) => void;
  clear: () => void;
  /** Empty just the food lines, or just the rentals — used after a partial checkout. */
  clearTypes: (types: CartItemType[]) => void;
  /** Hand the cart a freshly fetched catalog so it can re-price and flag delisted lines. */
  reconcile: (itemType: CartItemType, rows: ReconcileRow[]) => void;
  qtyOf: (type: CartItemType, id: string) => number;

  /** Planned bookings waiting to be checked out. */
  plans: CartPlan[];
  /** Σ of each plan's quoted total, as shown when it went in. */
  plansTotal: number;
  /** Put a priced plan in the cart. Returns its key. */
  addPlan: (plan: CartPlanInput) => string;
  removePlan: (key: string) => void;
  /** Replace a plan with an edited, freshly priced version of it. */
  updatePlan: (key: string, plan: CartPlanInput) => void;
  /** Fold a re-check's quote into the plan it was made for (see usePlanRecheck). */
  markPlanChecked: (key: string, recipe: MaterializeRequest, quote: QuoteResponse) => void;
  markPlanCheckFailed: (key: string, recipe: MaterializeRequest) => void;
  /** Queue plans for another check: the given keys, or every stale/unchecked plan. */
  recheckPlans: (keys?: string[]) => void;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { lines: [], plans: [], restored: false, revision: 0 });

  /* Restore once, after mount. Doing this in useReducer's initialiser would run
     it during render, which React 19 may invoke more than once. */
  useEffect(() => {
    dispatch({ type: 'RESTORE', lines: readStored(), plans: readStoredPlans() });
  }, []);

  /* Persist on every change, but not before the restore has landed — otherwise
     the initial empty state overwrites the saved cart on first paint. */
  useEffect(() => {
    if (!state.restored) return;
    writeStored(state.lines);
  }, [state.lines, state.restored]);

  useEffect(() => {
    if (!state.restored) return;
    writeStoredPlans(state.plans);
  }, [state.plans, state.restored]);

  /* Another tab changed the cart. Without this, two open tabs quietly diverge
     and whichever is closed last wins. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== PLANS_KEY) return;
      dispatch({ type: 'RESTORE', lines: readStored(), plans: readStoredPlans() });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const addItem = useCallback<CartContextValue['addItem']>((input) => {
    dispatch({
      type: 'ADD',
      line: {
        key: cartKeyOf(input.type, input.id),
        type: input.type,
        id: input.id,
        qty: Math.max(1, Math.floor(input.qty ?? 1)),
        snap: { name: input.name, price: input.price, image: input.image, meta: input.meta },
        priceWhenAdded: undefined,
        stock: input.stock,
      },
    });
  }, []);

  const setQty = useCallback((key: CartKey, qty: number) => dispatch({ type: 'SET_QTY', key, qty }), []);
  const removeItem = useCallback((key: CartKey) => dispatch({ type: 'REMOVE', key }), []);
  const clear = useCallback(() => {
    dropAllPlanImages();
    dispatch({ type: 'CLEAR' });
  }, []);
  const clearTypes = useCallback((types: CartItemType[]) => dispatch({ type: 'CLEAR_TYPES', types }), []);
  const reconcile = useCallback(
    (itemType: CartItemType, rows: ReconcileRow[]) => dispatch({ type: 'RECONCILE', itemType, rows }),
    [],
  );

  const addPlan = useCallback((plan: CartPlanInput) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `plan:${id}`;
    dispatch({ type: 'ADD_PLAN', plan: { ...plan, key, addedAt: new Date().toISOString(), status: 'ok' } });
    return key;
  }, []);
  const removePlan = useCallback((key: string) => {
    dropPlanImages(key);
    dispatch({ type: 'REMOVE_PLAN', key });
  }, []);
  const updatePlan = useCallback(
    (key: string, plan: CartPlanInput) => dispatch({ type: 'UPDATE_PLAN', key, plan }),
    [],
  );
  const markPlanChecked = useCallback(
    (key: string, recipe: MaterializeRequest, quote: QuoteResponse) =>
      dispatch({ type: 'PLAN_CHECKED', key, recipe, quote }),
    [],
  );
  const markPlanCheckFailed = useCallback(
    (key: string, recipe: MaterializeRequest) => dispatch({ type: 'PLAN_CHECK_FAILED', key, recipe }),
    [],
  );
  const recheckPlans = useCallback((keys?: string[]) => dispatch({ type: 'RECHECK_PLANS', keys }), []);

  const qtyOf = useCallback(
    (type: CartItemType, id: string) => state.lines.find((l) => l.key === cartKeyOf(type, id))?.qty ?? 0,
    [state.lines],
  );

  const value = useMemo<CartContextValue>(() => {
    const purchasable = state.lines.filter((l) => l.status !== 'unavailable');
    return {
      lines: state.lines,
      pieces: state.lines.reduce((n, l) => n + l.qty, 0),
      subtotal: purchasable.reduce((sum, l) => sum + l.snap.price * l.qty, 0),
      hasBlockingIssue:
        state.lines.some((l) => l.status === 'unavailable') || state.plans.some((p) => p.status === 'stale'),
      plans: state.plans,
      plansTotal: state.plans.reduce((sum, p) => sum + p.snap.total, 0),
      restored: state.restored,
      revision: state.revision,
      addItem,
      setQty,
      removeItem,
      clear,
      clearTypes,
      reconcile,
      qtyOf,
      addPlan,
      removePlan,
      updatePlan,
      markPlanChecked,
      markPlanCheckFailed,
      recheckPlans,
    };
  }, [state.lines, state.plans, state.restored, state.revision, addItem, setQty, removeItem, clear, clearTypes, reconcile, qtyOf, addPlan, removePlan, updatePlan, markPlanChecked, markPlanCheckFailed, recheckPlans]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
