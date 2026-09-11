import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

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
  | { type: 'RESTORE'; lines: CartLine[] }
  | { type: 'ADD'; line: Omit<CartLine, 'status'> }
  | { type: 'SET_QTY'; key: CartKey; qty: number }
  | { type: 'REMOVE'; key: CartKey }
  | { type: 'CLEAR' }
  | { type: 'CLEAR_TYPES'; types: CartItemType[] }
  | { type: 'RECONCILE'; itemType: CartItemType; rows: ReconcileRow[] };

const STORAGE_KEY = 'kingjegi.cart.v1';
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

/* ── reducer ────────────────────────────────────────────────────────────── */

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'RESTORE':
      return { lines: action.lines, restored: true, revision: state.revision + 1 };

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
      return { ...state, lines: [] };

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
  /** True while any line is unavailable — checkout must not proceed. */
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
}

export const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { lines: [], restored: false, revision: 0 });

  /* Restore once, after mount. Doing this in useReducer's initialiser would run
     it during render, which React 19 may invoke more than once. */
  useEffect(() => {
    dispatch({ type: 'RESTORE', lines: readStored() });
  }, []);

  /* Persist on every change, but not before the restore has landed — otherwise
     the initial empty state overwrites the saved cart on first paint. */
  useEffect(() => {
    if (!state.restored) return;
    writeStored(state.lines);
  }, [state.lines, state.restored]);

  /* Another tab changed the cart. Without this, two open tabs quietly diverge
     and whichever is closed last wins. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      dispatch({ type: 'RESTORE', lines: readStored() });
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
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);
  const clearTypes = useCallback((types: CartItemType[]) => dispatch({ type: 'CLEAR_TYPES', types }), []);
  const reconcile = useCallback(
    (itemType: CartItemType, rows: ReconcileRow[]) => dispatch({ type: 'RECONCILE', itemType, rows }),
    [],
  );

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
      hasBlockingIssue: state.lines.some((l) => l.status === 'unavailable'),
      restored: state.restored,
      revision: state.revision,
      addItem,
      setQty,
      removeItem,
      clear,
      clearTypes,
      reconcile,
      qtyOf,
    };
  }, [state.lines, state.restored, state.revision, addItem, setQty, removeItem, clear, clearTypes, reconcile, qtyOf]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
