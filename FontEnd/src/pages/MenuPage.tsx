import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from '../components/landing/Navbar';
import { AmbientCanvas } from '../components/landing/AmbientCanvas';
import { useAuth } from '../hooks/useAuth';
import { readSession } from '../lib/tokenStorage';
import { fetchMenuItems, fetchMenuTrays, getFullImageUrl } from '../api/menuAdminApi';
import { createBooking, addMenuItem, addMenuTray, submitBooking, BookingApiError } from '../api/bookingApi';
import { SiteFooter } from '../components/landing/SiteFooter';

/** Stock backdrop for the menu hero until a real asset is dropped in. */
const MENU_HERO_MEDIA =
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=2000&q=80';

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Real catalog → build a Food-Delivery cart → create + submit the booking.
   Prices shown are catalog unit prices; the authoritative total is computed
   by the backend when the booking is created (golden rule).
───────────────────────────────────────────────────────────────────────── */

type ProductType = 'MenuItem' | 'MenuTray';

type Product = {
  id: string;                 // real GUID
  type: ProductType;
  name: string;
  category: string;           // itemCategory (lowercased) or 'trays'
  price: number;
  description: string;
  serves: number;
  image?: string | null;
  /* Both come straight off AdminMenuItem and were previously dropped in the map.
     Trays carry neither — AdminMenuTray has no courseCategory and no dietaryTags —
     so a tray gets '' and [], and the sidebar filters treat that as "unclassified"
     rather than silently excluding every tray. */
  courseCategory: string;
  dietaryTags: string[];
};

type CartLine = { id: string; type: ProductType; name: string; price: number; qty: number };

/** Stable ordering for the category pills; only categories that actually have items show. */
const CATEGORY_ORDER = ['chicken', 'beef', 'pork', 'seafood', 'pasta', 'vegetable', 'others', 'trays'];

/**
 * CourseCategory from Models/Menuitem.cs, in enum order — the sidebar's CATEGORY list.
 * Only courses actually present in the loaded data are rendered, with live counts.
 */
const COURSE_ORDER = ['Appetizer', 'Soup', 'Main', 'Side', 'Dessert', 'Beverage'];

/**
 * Sort options.
 *
 * The reference's "Most Popular" is not offered: nothing on Menuitem records
 * popularity, and fetchBestSeller ranks exactly one dish over a fortnight — not a
 * per-dish order. Every option here sorts on a field that exists.
 */
type SortKey = 'name' | 'price-asc' | 'price-desc' | 'serves-desc';
const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name (A–Z)',
  'price-asc': 'Price (low to high)',
  'price-desc': 'Price (high to low)',
  'serves-desc': 'Serves (most first)',
};
const catLabel = (c: string) => (c === 'trays' ? 'Trays' : c.charAt(0).toUpperCase() + c.slice(1));
const cartKey = (p: { id: string; type: ProductType }) => `${p.type}:${p.id}`;

/* ─────────────────────────────────────────────────────────────────────────
   Small pieces
───────────────────────────────────────────────────────────────────────── */

function ProductImage({ product, className }: { product: Product; className: string }) {
  return product.image ? (
    <div className={className} style={{ backgroundImage: `url('${product.image}')` }} />
  ) : (
    <div className={`${className} mnu-letter`} aria-hidden="true">
      {product.name.charAt(0).toUpperCase()}
    </div>
  );
}

function QtyStepper({ value, onDelta, label }: { value: number; onDelta: (delta: number) => void; label: string }) {
  return (
    <div className="mnu-qty" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Decrease quantity for ${label}`} onClick={() => onDelta(-1)}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`Increase quantity for ${label}`} onClick={() => onDelta(1)}>+</button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

export function MenuPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [category, setCategory] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');

  /* Sidebar filters. These COMPOSE with `category` and `query` rather than replacing
     them — the pill row and the search box keep working exactly as before. */
  const [courses, setCourses] = useState<string[]>([]);
  const [diets, setDiets] = useState<string[]>([]);
  /** null until the catalog loads and the real min/max are known. */
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const [sort, setSort] = useState<SortKey>('name');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [flashKey, setFlashKey] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* checkout */
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  const loadCatalog = async () => {
    setLoading(true);
    setLoadError(null);
    const token = readSession()?.token ?? '';   // catalog GETs are anonymous (item 1)
    try {
      const [items, trays] = await Promise.all([fetchMenuItems(token), fetchMenuTrays(token)]);
      const itemProducts: Product[] = items
        // Package-only dishes (no standalone price) can't be booked à la carte.
        .filter((i) => i.isActive && i.pricePerTray != null)
        .map((i) => ({
          id: i.id, type: 'MenuItem', name: i.itemName, category: i.itemCategory.toLowerCase(),
          price: i.pricePerTray as number, description: i.description, serves: i.servesPerTray,
          image: getFullImageUrl(i.imageUrl),
          courseCategory: i.courseCategory, dietaryTags: i.dietaryTags ?? [],
        }));
      const trayProducts: Product[] = trays
        .filter((t) => t.isActive)
        .map((t) => ({
          id: t.id, type: 'MenuTray', name: t.trayName, category: 'trays', price: t.pricePerTray,
          description: `A party tray of ${t.dishes.map((d) => d.itemName).join(', ')} — serves ${t.servesMin}–${t.servesMax}.`,
          serves: t.servesMin,
          courseCategory: '', dietaryTags: [],
        }));
      setProducts([...itemProducts, ...trayProducts]);
    } catch {
      setLoadError('Unable to load the menu. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, []);

  /**
   * Arriving from PackagePage's "Select Party Tray": add that tray to the cart and
   * show the trays view.
   *
   * Waits on `products`, since the tray can only be added once the catalog has
   * loaded — hence the dependency rather than a bare mount effect. The router state
   * is cleared immediately afterwards so a refresh or a Back-then-Forward doesn't
   * silently add the same tray again.
   */
  useEffect(() => {
    const incoming = location.state as { addTrayId?: string; scrollTo?: string } | null;
    if (!incoming?.addTrayId || products.length === 0) return;

    const tray = products.find((p) => p.type === 'MenuTray' && p.id === incoming.addTrayId);
    if (tray) {
      addToCart(tray);
      setCategory('trays');
    }

    if (incoming.scrollTo === 'trays') {
      // After paint, so the filtered grid exists before we scroll to it.
      window.requestAnimationFrame(() => {
        document.querySelector('.mnu-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, location.state]);

  const qtyOf = (key: string) => quantities[key] ?? 1;
  const bumpQty = (key: string, delta: number) =>
    setQuantities((prev) => ({ ...prev, [key]: Math.max(1, (prev[key] ?? 1) + delta) }));

  /* Price slider bounds, from the real catalog. Floored/ceiled to whole pesos so the
     thumbs land on round numbers instead of 1,487.53. */
  const priceBounds = useMemo<[number, number]>(() => {
    if (products.length === 0) return [0, 0];
    const prices = products.map((p) => p.price);
    return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))];
  }, [products]);

  /* Seed the range once the catalog arrives, and re-clamp if the catalog reloads
     into a narrower spread — otherwise a stale thumb could sit outside the track. */
  useEffect(() => {
    if (products.length === 0) return;
    setPriceRange((prev) => {
      const [lo, hi] = prev ?? priceBounds;
      return [
        Math.max(priceBounds[0], Math.min(lo, priceBounds[1])),
        Math.min(priceBounds[1], Math.max(hi, priceBounds[0])),
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceBounds]);

  /** Courses present in the data, with counts. Never a hardcoded list. */
  const courseOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) if (p.courseCategory) m.set(p.courseCategory, (m.get(p.courseCategory) ?? 0) + 1);
    return COURSE_ORDER.filter((c) => m.has(c)).map((c) => ({ value: c, count: m.get(c)! }));
  }, [products]);

  /** Dietary tags actually present, with counts — derived, not enumerated. */
  const dietOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) for (const t of p.dietaryTags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const [lo, hi] = priceRange ?? priceBounds;
    const rows = products.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (q !== '' && !p.name.toLowerCase().includes(q)) return false;
      // A tray has no course/tag, so it drops out only when such a filter is active.
      if (courses.length > 0 && !courses.includes(p.courseCategory)) return false;
      if (diets.length > 0 && !diets.some((d) => p.dietaryTags.includes(d))) return false;
      if (priceRange && (p.price < lo || p.price > hi)) return false;
      return true;
    });
    const sorted = [...rows];
    if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    else if (sort === 'serves-desc') sorted.sort((a, b) => b.serves - a.serves);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [products, category, query, courses, diets, priceRange, priceBounds, sort]);

  /**
   * The "Popular right now" row.
   *
   * NOT a popularity ranking — nothing records that. It is the five best-value
   * trays/dishes by serves-per-peso, which is a real computation over real fields.
   * Labelled accordingly in the UI so it doesn't imply sales data.
   */
  const trending = useMemo(
    () => [...products]
      .filter((p) => p.price > 0)
      .sort((a, b) => b.serves / b.price - a.serves / a.price)
      .slice(0, 5),
    [products],
  );

  const filtersActive =
    courses.length > 0 || diets.length > 0
    || (priceRange !== null && (priceRange[0] !== priceBounds[0] || priceRange[1] !== priceBounds[1]));

  const clearFilters = () => {
    setCourses([]);
    setDiets([]);
    setPriceRange(priceBounds);
  };

  const toggleIn = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const categories = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [products]);

  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return m;
  }, [products]);

  const cartLines = useMemo(() => Object.values(cart), [cart]);
  const cartCount = useMemo(() => cartLines.reduce((a, l) => a + l.qty, 0), [cartLines]);
  const cartTotal = useMemo(() => cartLines.reduce((a, l) => a + l.price * l.qty, 0), [cartLines]);

  const addToCart = (p: Product) => {
    const key = cartKey(p);
    const add = qtyOf(key);
    setCart((prev) => ({
      ...prev,
      [key]: { id: p.id, type: p.type, name: p.name, price: p.price, qty: (prev[key]?.qty ?? 0) + add },
    }));
    setFlashKey(key);
    window.setTimeout(() => setFlashKey((prev) => (prev === key ? null : prev)), 1500);
  };

  const placeOrder = async () => {
    const session = readSession();
    if (!session) { navigate('/login'); return; }   // creating a booking requires login
    if (cartLines.length === 0) { setCheckoutError('Your cart is empty.'); return; }
    if (!deliveryDate || !deliveryTime || !address.trim()) {
      setCheckoutError('Please provide a delivery date, time, and address.');
      return;
    }
    setPlacing(true);
    setCheckoutError('');
    try {
      const booking = await createBooking(session.token, {
        customerId: session.user.id,
        bookingType: 'FoodDelivery',
        eventDate: deliveryDate,
        startTime: `${deliveryTime}:00`,
        endDate: null, endTime: null, eventType: null,
        venueAddress: address.trim(),
        guestCount: null, menuPackageId: null,
        contactNumber: contact.trim() || null,
      });
      for (const line of cartLines) {
        if (line.type === 'MenuItem') await addMenuItem(session.token, booking.id, line.id, line.qty);
        else await addMenuTray(session.token, booking.id, line.id, line.qty);
      }
      await submitBooking(session.token, booking.id);
      setCart({});
      setCheckoutOpen(false);
      navigate('/dashboard');
    } catch (err) {
      setCheckoutError(err instanceof BookingApiError ? err.message : 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  /* ── detail drawer as a real dialog ──
     The card that opened it is remembered so focus can go back there on close;
     without that, dismissing the drawer drops focus to <body> and a keyboard user
     restarts from the top of the page. */
  const drawerRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openDetail = (product: Product, opener: HTMLElement) => {
    const alreadyOpen = selected !== null && cartKey(selected) === cartKey(product);
    if (alreadyOpen) { closeDetail(); return; }
    openerRef.current = opener;
    setSelected(product);
  };

  const closeDetail = () => {
    setSelected(null);
    openerRef.current?.focus();
    openerRef.current = null;
  };

  /* Move focus into the drawer when it opens. */
  useEffect(() => {
    if (!selected) return;
    drawerRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
  }, [selected]);

  /* Escape closes the detail drawer / checkout; Tab is trapped inside the drawer. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selected) closeDetail(); else setCheckoutOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !selected || !drawerRef.current) return;
      const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);


  return (
    <>
      <style>{`
        .blob { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.18; pointer-events: none; animation: blobDrift 18s ease-in-out infinite alternate; }
        .blob-primary { background: var(--primary); }
        .blob-accent { background: var(--accent); }
        .blob-primary-soft { background: var(--primary); opacity: 0.10; }
        .blob-accent-soft { background: var(--accent); opacity: 0.10; }
        @keyframes blobDrift { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-20px) scale(1.08); } 100% { transform: translate(-20px,15px) scale(0.95); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.7s ease both; }

        .mnu-toolbar { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%); border-bottom: 1px solid var(--border); }
        .mnu-toolbar-inner { max-width: 1200px; margin: 0 auto; padding: 0.9rem 2.5rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
        .mnu-pills { display: flex; align-items: center; gap: 0.4rem; overflow-x: auto; flex: 1 1 auto; scrollbar-width: none; padding: 2px; }
        .mnu-pills::-webkit-scrollbar { display: none; }
        /* Sentence case at 13/500, matching .ui-chip. The count rides in the
           numeric face so a two-digit tally doesn't shift the pill's label. */
        .mnu-pill { border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); font-family: var(--font-body); font-size: 0.8125rem; letter-spacing: 0; text-transform: none; font-weight: 500; padding: 0.5625rem 1rem; border-radius: var(--r-full); cursor: pointer; white-space: nowrap; transition: background 0.2s, color 0.2s, border-color 0.2s; }
        .mnu-pill:hover { color: var(--text-primary); border-color: var(--border-strong); }
        .mnu-pill.active { background: var(--primary); border-color: var(--primary); color: var(--primary-text); font-weight: 600; }
        .mnu-pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .mnu-pill .count { font-family: var(--font-numeric); font-variant-numeric: tabular-nums; font-size: 0.6875rem; opacity: 0.65; margin-left: 0.4rem; }
        .mnu-search { flex: 0 1 240px; min-width: 170px; display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--border); background: var(--surface); border-radius: var(--r-full); padding: 0.5rem 1rem; transition: border-color 0.2s; }
        .mnu-search:focus-within { border-color: var(--primary); }
        .mnu-search svg { flex-shrink: 0; color: var(--text-dim); }
        .mnu-search input { border: none; background: transparent; outline: none; width: 100%; font-family: var(--font-body); font-size: 0.78rem; font-weight: 300; color: var(--text-primary); }
        .mnu-search input::placeholder { color: var(--text-dim); }

        .mnu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1.5rem; }
        .mnu-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); overflow: hidden; display: flex; flex-direction: column; cursor: pointer; transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s; }
        .mnu-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-md); transform: translateY(-3px); }
        .mnu-card.selected { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted), var(--shadow-md); }
        .mnu-photo { position: relative; aspect-ratio: 4 / 3; background-size: cover; background-position: center; background-color: var(--bg-subtle); transition: transform 0.6s ease; }
        .mnu-photo-wrap { overflow: hidden; position: relative; flex-shrink: 0; }
        .mnu-card:hover .mnu-photo { transform: scale(1.05); }
        .mnu-letter { display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 30%, var(--primary-muted), transparent 60%), var(--bg-subtle); font-family: var(--font-display); font-size: 3.5rem; font-weight: 600; color: var(--primary); }
        .mnu-card-body { padding: 1.15rem 1.25rem 1.25rem; display: flex; flex-direction: column; flex: 1; gap: 0.45rem; }
        .mnu-cat-chip { align-self: flex-start; font-family: var(--font-body); font-size: 0.52rem; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500; color: var(--primary); background: var(--primary-muted); border: 1px solid var(--border-accent); border-radius: var(--r-full); padding: 0.2rem 0.6rem; }
        .mnu-dish-name { font-family: var(--font-display); font-size: 1.25rem; font-weight: 500; line-height: 1.2; color: var(--text-primary); }
        .mnu-dish-desc { font-family: var(--font-body); font-size: 0.78rem; font-weight: 300; line-height: 1.6; color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }
        .mnu-card-foot { border-top: 1px solid var(--border); margin-top: 0.55rem; padding-top: 0.8rem; display: flex; align-items: center; gap: 0.55rem; }
        .mnu-price { font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; line-height: 1; color: var(--primary); margin-right: auto; }
        .mnu-price small { font-family: var(--font-body); font-size: 0.55rem; font-weight: 400; letter-spacing: 0.08em; color: var(--text-dim); }
        .mnu-qty { display: flex; align-items: center; border: 1px solid var(--border); border-radius: var(--r-full); background: var(--bg-subtle); overflow: hidden; }
        .mnu-qty button { border: none; background: transparent; cursor: pointer; width: 26px; height: 26px; line-height: 1; color: var(--primary); font-size: 0.9rem; font-weight: 600; transition: background 0.15s; }
        .mnu-qty button:hover { background: var(--primary-muted); }
        .mnu-qty span { min-width: 24px; text-align: center; font-family: var(--font-body); font-size: 0.72rem; font-weight: 500; color: var(--text-primary); }
        .mnu-add { border: 1px solid var(--border-accent); background: var(--primary-muted); color: var(--primary); font-family: var(--font-body); font-size: 0.56rem; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500; padding: 0.5rem 0.9rem; border-radius: var(--r-full); cursor: pointer; white-space: nowrap; transition: background 0.2s, color 0.2s, border-color 0.2s; }
        .mnu-add:hover, .mnu-add.flash { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
        .mnu-empty { background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--r-xl); padding: 3.5rem 2rem; text-align: center; }

        @keyframes drawerIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes sheetIn { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .mnu-backdrop { position: fixed; inset: 0; z-index: 90; background: rgba(27, 16, 36, 0.32); backdrop-filter: blur(3px); display: none; }
        .mnu-drawer { position: fixed; top: 0; right: 0; z-index: 95; height: 100vh; width: 340px; max-width: 92vw; background: var(--surface); border-left: 1px solid var(--border-accent); box-shadow: -8px 0 48px rgba(0,0,0,0.16); padding: 5.5rem 1.75rem 1.75rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.9rem; animation: drawerIn 0.3s cubic-bezier(0.22,1,0.36,1) both; }
        @media (max-width: 900px) { .mnu-backdrop { display: block; } .mnu-drawer { top: auto; bottom: 0; right: 0; left: 0; width: 100%; max-width: none; height: auto; max-height: 78vh; border-left: none; border-top: 1px solid var(--border-accent); border-radius: var(--r-xl) var(--r-xl) 0 0; padding: 1.5rem 1.5rem 2rem; animation: sheetIn 0.3s cubic-bezier(0.22,1,0.36,1) both; } }
        .mnu-drawer-photo { aspect-ratio: 4 / 3; width: 100%; border-radius: var(--r-lg); background-size: cover; background-position: center; background-color: var(--bg-subtle); border: 1px solid var(--border); overflow: hidden; flex-shrink: 0; }
        .mnu-drawer-photo.mnu-letter { font-size: 3rem; }
        .mnu-drawer-close { position: absolute; top: 5rem; right: 1.25rem; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-subtle); color: var(--text-muted); cursor: pointer; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; transition: background 0.2s, color 0.2s; }
        @media (max-width: 900px) { .mnu-drawer-close { top: 1rem; } }
        .mnu-drawer-close:hover { background: var(--primary-muted); color: var(--primary); }

        @keyframes planIn { from { transform: translate(-50%, 20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .mnu-plan { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%); z-index: 80; display: flex; align-items: center; gap: 1rem; background: var(--surface); border: 1px solid var(--border-accent); border-radius: var(--r-full); padding: 0.6rem 0.7rem 0.6rem 1.4rem; box-shadow: var(--shadow-lg); animation: planIn 0.3s ease both; max-width: calc(100vw - 8rem); }
        .mnu-plan-clear { border: none; background: transparent; cursor: pointer; font-family: var(--font-body); font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim); transition: color 0.2s; white-space: nowrap; }
        .mnu-plan-clear:hover { color: var(--danger); }
        .mnu-plan-cta { background: var(--primary); color: var(--primary-text); font-family: var(--font-body); font-size: 0.6rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500; border: none; border-radius: var(--r-full); padding: 0.65rem 1.25rem; cursor: pointer; white-space: nowrap; transition: background 0.2s; }
        .mnu-plan-cta:hover { background: var(--primary-hover); }

        /* ── checkout modal ── */
        .mnu-co-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(27, 16, 36, 0.32); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
        .mnu-co-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); padding: 1.6rem 1.75rem; display: flex; flex-direction: column; gap: 1rem; }
        .mnu-co-label { font-family: var(--font-body); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 0.5rem; }
        .mnu-co-input { width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; padding: 0.8rem 0.875rem; font-family: var(--font-body); font-size: 0.875rem; color: var(--text-primary); outline: none; transition: border-color 0.2s; }
        .mnu-co-input:focus, .mnu-co-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
        .mnu-co-line { display: flex; justify-content: space-between; gap: 0.8rem; font-family: var(--font-body); font-size: 0.8rem; padding: 0.35rem 0; border-bottom: 1px solid var(--border); }

        .btn-primary { background: var(--primary); color: var(--primary-text); border: none; padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; cursor: pointer; border-radius: var(--r-full); transition: background 0.25s, transform 0.2s, box-shadow 0.2s; text-decoration: none; display: inline-block; text-align: center; }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: var(--shadow-green); }
        .btn-outline { background: transparent; color: var(--primary); border: 1px solid var(--border-accent); padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; cursor: pointer; border-radius: var(--r-full); transition: background 0.25s, border-color 0.25s, transform 0.2s; text-decoration: none; display: inline-block; text-align: center; }
        .btn-outline:hover { background: var(--primary-muted); border-color: var(--primary); transform: translateY(-2px); }

        /* ── hero search ──
           Reads the normal surface tokens now that the hero is on the blush ground
           rather than the band, and is flush left with the heading instead of
           centred under it. */
        .mnu-hero-search {
          display: flex; align-items: center; gap: 0.65rem; width: 100%; max-width: 620px;
          background: var(--surface); border: 1px solid var(--border-strong);
          border-radius: var(--r-full);
          padding: 0.35rem 0.35rem 0.35rem 1.15rem; margin: 0;
          transition: border-color 0.2s;
        }
        .mnu-hero-search:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
        .mnu-hero-search svg { flex-shrink: 0; color: var(--text-muted); }
        .mnu-hero-search input {
          flex: 1; min-width: 0; border: none; background: transparent; outline: none;
          font-family: var(--font-body); font-size: 0.9375rem; color: var(--text-primary);
        }
        .mnu-hero-search input::placeholder { color: var(--text-dim); }
        .mnu-hero-btn {
          flex-shrink: 0; border: none; cursor: pointer; border-radius: var(--r-full);
          background: var(--accent); color: var(--accent-text);
          font-family: var(--font-body); font-size: 0.8125rem; font-weight: 600;
          padding: 0.7rem 1.5rem;
          transition: background 0.2s;
        }
        .mnu-hero-btn:hover { background: var(--accent-hover); }

        /* ── split view ── */
        .mnu-split { display: grid; grid-template-columns: minmax(210px, 250px) minmax(0, 1fr); gap: 2.5rem; align-items: start; }
        @media (max-width: 900px) { .mnu-split { grid-template-columns: 1fr; gap: 1.25rem; } }

        .mnu-side-label {
          font-family: var(--font-body); font-size: 0.58rem; letter-spacing: 0.24em;
          text-transform: uppercase; font-weight: 600; color: var(--text-muted);
          margin: 0 0 0.75rem;
        }
        .mnu-check {
          display: flex; align-items: center; gap: 0.6rem; cursor: pointer;
          padding: 0.34rem 0; font-family: var(--font-body); font-size: 0.82rem; color: var(--text-secondary);
        }
        .mnu-check input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
        .mnu-check .count { margin-left: auto; font-size: 0.74rem; color: var(--text-dim); }
        .mnu-check:hover { color: var(--text-primary); }

        /* Dual-thumb range: two real <input type=range> stacked on one track, so both
           thumbs are keyboard-operable. Pointer events are off on the inputs and back
           on for the thumbs only, letting the lower thumb stay reachable. */
        .mnu-range { position: relative; height: 30px; margin-top: 0.35rem; }
        .mnu-range-track {
          position: absolute; top: 13px; left: 0; right: 0; height: 4px;
          border-radius: 999px; background: var(--border);
        }
        .mnu-range-fill { position: absolute; top: 13px; height: 4px; border-radius: 999px; background: var(--accent); }
        .mnu-range input[type="range"] {
          position: absolute; top: 0; left: 0; width: 100%; height: 30px; margin: 0;
          appearance: none; -webkit-appearance: none; background: transparent; pointer-events: none;
        }
        .mnu-range input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; pointer-events: auto; cursor: pointer;
          width: 16px; height: 16px; border-radius: 50%;
          background: var(--accent); border: 2px solid var(--surface); box-shadow: var(--shadow-md);
        }
        .mnu-range input[type="range"]::-moz-range-thumb {
          pointer-events: auto; cursor: pointer;
          width: 16px; height: 16px; border-radius: 50%;
          background: var(--accent); border: 2px solid var(--surface);
        }
        .mnu-range input[type="range"]:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--primary); outline-offset: 2px; }

        /* ── restyled product card ── */
        .mnu-card2 {
          background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-xl);
          overflow: hidden; display: flex; flex-direction: column; cursor: pointer;
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s;
        }
        .mnu-card2:hover { border-color: var(--border-accent); box-shadow: var(--shadow-md); transform: translateY(-3px); }
        .mnu-card2.selected { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted), var(--shadow-md); }
        .mnu-card2-badge {
          position: absolute; top: 0.7rem; left: 0.7rem; z-index: 2;
          background: var(--primary); color: var(--primary-text);
          font-family: var(--font-body); font-size: 0.58rem; font-weight: 600;
          letter-spacing: 0.08em; padding: 0.28rem 0.7rem; border-radius: var(--r-full);
        }
        .mnu-add2 {
          border: none; cursor: pointer; border-radius: var(--r-full);
          background: var(--primary); color: var(--primary-text);
          font-family: var(--font-body); font-size: 0.74rem; font-weight: 600;
          padding: 0.45rem 1rem; white-space: nowrap;
        }
        .mnu-add2:hover, .mnu-add2.flash { background: var(--primary-hover); }
        .mnu-add2:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

        /* list view — same card, laid on its side */
        .mnu-list .mnu-card2 { flex-direction: row; }
        .mnu-list .mnu-card2 .mnu-photo-wrap { width: 190px; flex-shrink: 0; }
        .mnu-list .mnu-card2 .mnu-photo { height: 100%; aspect-ratio: auto; }
        @media (max-width: 620px) { .mnu-list .mnu-card2 { flex-direction: column; } .mnu-list .mnu-card2 .mnu-photo-wrap { width: 100%; } }

        .mnu-iconbtn {
          width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--border); border-radius: var(--r-sm); cursor: pointer;
          background: var(--bg-card); color: var(--text-muted);
        }
        .mnu-iconbtn.active { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
        .mnu-iconbtn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
      `}</style>

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>

        {/* ═══════════════════════ HERO ═══════════════════════ */}
        {/* The dark band is gone from this page. It stays the rentals hero's device
            only — with both catalogs inverted, /menus and /rentals opened on the
            same near-black slab and read as one screen. The blush ground is the
            distinguishing move; the Navbar goes back to its normal tokens because
            it is no longer inside a band. */}
        <section style={{ background: 'var(--bg-subtle)', padding: 'calc(4rem + 80px) 0 4rem', position: 'relative', overflow: 'hidden' }}>
          {/* Background media placeholder, behind the copy. Swap the div for a
              <video muted playsInline loop autoPlay> when a real clip exists —
              the overlay above it works the same either way. */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
            <div
              style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url(${MENU_HERO_MEDIA})`,
                backgroundSize: 'cover', backgroundPosition: 'center',
              }}
            />
            {/* Derived from --bg-subtle, the ground this hero already had, rather
                than a black scrim: this band is LIGHT, and black over it would
                read as grey haze and drop the heading's contrast. Kept dense
                enough that --text-primary clears AA over any photograph. */}
            <div
              style={{
                position: 'absolute', inset: 0,
                background:
                  'linear-gradient(100deg, color-mix(in srgb, var(--bg-subtle) 95%, transparent) 0%, color-mix(in srgb, var(--bg-subtle) 86%, transparent) 55%, color-mix(in srgb, var(--bg-subtle) 70%, transparent) 100%)',
              }}
            />
          </div>

          <Navbar activePage="menus" cartCount={cartCount} onCartClick={() => { setCheckoutError(''); setCheckoutOpen(true); }} />
          <div className="fade-up" style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
            <p className="ui-kicker">Full menu</p>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.375rem, 5vw, 3.875rem)', fontWeight: 600, lineHeight: 0.98, letterSpacing: '-0.04em', color: 'var(--text-primary)', textWrap: 'balance', margin: '0 0 1rem' }}>
              Everything we cook,<br />in one place.
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.0625rem', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 560, marginBottom: '2rem' }}>
              {/* Count derived from the loaded catalog — never a fixed number. */}
              {loading
                ? 'Filipino dishes and party trays, by the tray — filter by category, course, diet or price.'
                : `${products.length} Filipino ${products.length === 1 ? 'dish' : 'dishes'} and party trays, by the tray — filter by category, course, diet or price.`}
            </p>

            {/* Wired to the SAME `query` state the toolbar search uses — no second
                search state. Submitting is a no-op because filtering is live. */}
            <form className="mnu-hero-search" onSubmit={(e) => e.preventDefault()} role="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="17" height="17" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dishes, trays or ingredients…"
                aria-label="Search the menu"
              />
              <button type="submit" className="mnu-hero-btn">Search</button>
            </form>
          </div>
        </section>

        {/* ── ambient ground ──
            Wraps only the content BELOW the hero: the hero keeps its own opaque
            ground and is deliberately outside this wrapper, so nothing here can
            paint over it. The sections inside go semi-transparent so the canvas
            reads through them. */}
        <div className="amb-host">
          <AmbientCanvas />

        {/* ═══════════════════════ QUICK NAV ═══════════════════════ */}
        <div className="mnu-toolbar">
          <div className="mnu-toolbar-inner">
            <div className="mnu-pills" role="tablist" aria-label="Dish categories">
              <button type="button" role="tab" aria-selected={category === 'all'} className={`mnu-pill${category === 'all' ? ' active' : ''}`} onClick={() => setCategory('all')}>
                All Dishes<span className="count">{products.length}</span>
              </button>
              {categories.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={category === c} className={`mnu-pill${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
                  {catLabel(c)}<span className="count">{countByCategory.get(c) ?? 0}</span>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {/* Every option sorts on a field that exists. "Most Popular" is absent
                  because nothing records popularity — see SORT_LABELS. */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  aria-label="Sort dishes"
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-primary)',
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-full)', padding: '0.4rem 0.7rem', cursor: 'pointer',
                  }}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>{SORT_LABELS[k]}</option>
                  ))}
                </select>
              </label>

              <button type="button" className={`mnu-iconbtn${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button type="button" className={`mnu-iconbtn${view === 'grid' ? ' active' : ''}`} onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ═══════════════════════ BEST VALUE ROW ═══════════════════════ */}
        {!loading && !loadError && trending.length > 0 && (
          <section className="amb-over" style={{ padding: '3rem 0 1rem' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.28em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.4rem' }}>
                Best Seller this week
              </p>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '1.5rem' }}>
                Most Picked Dishes
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.25rem' }}>
                {trending.map((p) => (
                  <article key={cartKey(p)} className="mnu-card2" onClick={() => setSelected(p)}>
                    <div className="mnu-photo-wrap" style={{ position: 'relative' }}>
                      <ProductImage product={p} className="mnu-photo" />
                    </div>
                    <div style={{ padding: '0.9rem 1rem 1rem' }}>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', lineHeight: 1.25 }}>
                        {p.name}
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent)' }}>
                          {fmtPHP(p.price)}
                        </span>
                        {/* servesPerTray, not a rating — Menuitem has no rating field. */}
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Serves {p.serves}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════════════ FILTERS + GRID ═══════════════════════ */}
        <section className="amb-over" style={{ padding: '2.5rem 0 6rem' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
            <div className="mnu-split">

              {/* ── sidebar ──
                  Below 900px this collapses into a <details> accordion rather than a
                  drawer: the filters are short, and an accordion keeps them in the
                  document flow so the grid below stays reachable without a scrim. */}
              <details
                open={filtersOpen}
                onToggle={(e) => setFiltersOpen((e.currentTarget as HTMLDetailsElement).open)}
                className="mnu-filters"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '1.25rem' }}
              >
                <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-primary)', listStyle: 'none' }}>
                  Filters{filtersActive ? ' ·' : ''}
                  {filtersActive && <span style={{ color: 'var(--accent)' }}> active</span>}
                </summary>

                <div style={{ marginTop: '1.25rem' }}>
                  {courseOptions.length > 0 && (
                    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1.5rem' }}>
                      <legend className="mnu-side-label" style={{ padding: 0 }}>Category</legend>
                      {courseOptions.map((o) => (
                        <label key={o.value} className="mnu-check">
                          <input
                            type="checkbox"
                            checked={courses.includes(o.value)}
                            onChange={() => toggleIn(courses, setCourses, o.value)}
                          />
                          {o.value}
                          <span className="count">{o.count}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {priceRange && priceBounds[1] > priceBounds[0] && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <p className="mnu-side-label">Price range</p>
                      <div className="mnu-range">
                        <div className="mnu-range-track" />
                        <div
                          className="mnu-range-fill"
                          style={{
                            left: `${((priceRange[0] - priceBounds[0]) / (priceBounds[1] - priceBounds[0])) * 100}%`,
                            right: `${100 - ((priceRange[1] - priceBounds[0]) / (priceBounds[1] - priceBounds[0])) * 100}%`,
                          }}
                        />
                        {/* Two real inputs — both thumbs keyboard-operable. Each clamps
                            against the other so they can't cross. */}
                        <input
                          type="range"
                          min={priceBounds[0]}
                          max={priceBounds[1]}
                          value={priceRange[0]}
                          onChange={(e) => setPriceRange([Math.min(Number(e.target.value), priceRange[1]), priceRange[1]])}
                          aria-label="Minimum price"
                        />
                        <input
                          type="range"
                          min={priceBounds[0]}
                          max={priceBounds[1]}
                          value={priceRange[1]}
                          onChange={(e) => setPriceRange([priceRange[0], Math.max(Number(e.target.value), priceRange[0])])}
                          aria-label="Maximum price"
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        <span>{fmtPHP(priceRange[0])}</span>
                        <span>{fmtPHP(priceRange[1])}</span>
                      </div>
                    </div>
                  )}

                  {dietOptions.length > 0 && (
                    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1.5rem' }}>
                      <legend className="mnu-side-label" style={{ padding: 0 }}>Dietary</legend>
                      {dietOptions.map((o) => (
                        <label key={o.value} className="mnu-check">
                          <input
                            type="checkbox"
                            checked={diets.includes(o.value)}
                            onChange={() => toggleIn(diets, setDiets, o.value)}
                          />
                          {o.value}
                          <span className="count">{o.count}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={!filtersActive}
                    style={{
                      width: '100%', cursor: filtersActive ? 'pointer' : 'not-allowed',
                      background: 'transparent', color: 'var(--text-primary)',
                      border: '1px solid var(--border)', borderRadius: 'var(--r-full)',
                      padding: '0.6rem', fontFamily: 'var(--font-body)', fontSize: '0.75rem',
                      opacity: filtersActive ? 1 : 0.5,
                    }}
                  >
                    Clear Filters
                  </button>
                </div>
              </details>

              {/* ── grid ── */}
              <div>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-dim)', fontFamily: 'var(--font-body)' }}>Loading the menu…</div>
                ) : loadError ? (
                  <div className="mnu-empty fade-up">
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.6rem' }}>{loadError}</p>
                    <button type="button" className="btn-outline" onClick={() => void loadCatalog()}>Try Again</button>
                  </div>
                ) : visibleProducts.length === 0 ? (
                  <div className="mnu-empty fade-up">
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.6rem' }}>No dishes match those filters.</p>
                    <button type="button" className="btn-outline" onClick={() => { setQuery(''); setCategory('all'); clearFilters(); }}>Reset Filters</button>
                  </div>
                ) : (
                  <>
                    {/* Real count from the array. fetchMenuItems returns the whole
                        catalog in one call, so there is nothing to paginate. */}
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                      Showing {visibleProducts.length} of {products.length} dishes
                    </p>

                    <div
                      className={view === 'list' ? 'mnu-list' : ''}
                      style={
                        view === 'list'
                          ? { display: 'flex', flexDirection: 'column', gap: '1rem' }
                          : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.5rem' }
                      }
                    >
                      {visibleProducts.map((product, i) => {
                        const key = cartKey(product);
                        const isSelected = selected ? cartKey(selected) === key : false;
                        return (
                          <article
                            key={key}
                            className={`mnu-card2 fade-up${isSelected ? ' selected' : ''}`}
                            style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}
                            onClick={(e) => openDetail(product, e.currentTarget as HTMLElement)}
                          >
                            <div className="mnu-photo-wrap" style={{ position: 'relative' }}>
                              <ProductImage product={product} className="mnu-photo" />
                              <span className="mnu-card2-badge">{catLabel(product.category)}</span>
                            </div>
                            <div className="mnu-card-body">
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.6rem' }}>
                                <h3 className="mnu-dish-name" style={{ margin: 0 }}>{product.name}</h3>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                                  {fmtPHP(product.price)}
                                </span>
                              </div>

                              {/* Meta row: only fields that exist. The reference's cook
                                  time and spice level have no backing column. */}
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
                                Serves {product.serves}
                                {product.courseCategory ? ` · ${product.courseCategory}` : ''}
                                {product.dietaryTags.length > 0 ? ` · ${product.dietaryTags.join(', ')}` : ''}
                              </p>

                              <p className="mnu-dish-desc">{product.description}</p>

                              <div className="mnu-card-foot">
                                <QtyStepper value={qtyOf(key)} onDelta={(d) => bumpQty(key, d)} label={product.name} />
                                <button
                                  type="button"
                                  className={`mnu-add2${flashKey === key ? ' flash' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                                >
                                  {flashKey === key ? 'Added ✓' : '+ Add'}
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
        </div>
      </main>

      {/* ═══════════════════════ DETAIL DRAWER ═══════════════════════ */}
      {selected && (
        <>
          <div className="mnu-backdrop" onClick={closeDetail} />
          <aside ref={drawerRef} className="mnu-drawer" role="dialog" aria-modal="true" aria-label={`${selected.name} details`}>
            <button type="button" className="mnu-drawer-close" onClick={closeDetail} aria-label="Close details">✕</button>
            <ProductImage product={selected} className="mnu-drawer-photo" />
            <span className="mnu-cat-chip">{catLabel(selected.category)}</span>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.15 }}>{selected.name}</h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300 }}>{selected.description}</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '0.8rem 0' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>Price</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--primary)', marginLeft: 'auto', lineHeight: 1 }}>{fmtPHP(selected.price)}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--text-dim)' }}>/ {selected.type === 'MenuTray' ? 'tray' : 'tray-serving'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <QtyStepper value={qtyOf(cartKey(selected))} onDelta={(d) => bumpQty(cartKey(selected), d)} label={selected.name} />
              <button type="button" className={`mnu-add${flashKey === cartKey(selected) ? ' flash' : ''}`} style={{ flex: 1, padding: '0.7rem 0.9rem' }} onClick={() => addToCart(selected)}>
                {flashKey === cartKey(selected) ? 'Added to cart ✓' : 'Add to Cart'}
              </button>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--text-dim)', lineHeight: 1.6, fontWeight: 300, marginTop: 'auto' }}>
              Delivery orders are confirmed by our coordinators. The final total is calculated at checkout.
            </p>
          </aside>
        </>
      )}

      {/* ═══════════════════════ FLOATING CART BAR ═══════════════════════ */}
      {cartCount > 0 && !checkoutOpen && (
        <div className="mnu-plan" role="status" aria-label="Delivery cart summary">
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{cartCount}</strong>
            {' '}item{cartCount === 1 ? '' : 's'} ·{' '}
            {/* Money in the numeric face, per the artboards' treatment of every
                total — the display face was setting a running figure that changes
                on each tap, so the digits shifted width as it counted. */}
            <span style={{ fontFamily: 'var(--font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.8125rem' }}>{fmtPHP(cartTotal)}</span>
          </p>
          <button type="button" className="mnu-plan-clear" onClick={() => setCart({})}>Clear</button>
          <button type="button" className="mnu-plan-cta" onClick={() => { setCheckoutError(''); setCheckoutOpen(true); }}>Checkout →</button>
        </div>
      )}

      {/* ═══════════════════════ CHECKOUT MODAL ═══════════════════════ */}
      {checkoutOpen && (
        <div className="mnu-co-overlay" onClick={() => !placing && setCheckoutOpen(false)}>
          <div className="mnu-co-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Delivery checkout">
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Delivery Details</h2>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                {cartCount} item{cartCount === 1 ? '' : 's'} · estimated {fmtPHP(cartTotal)} (final total confirmed on booking)
              </p>
            </div>

            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {cartLines.map((l) => (
                <div key={`${l.type}:${l.id}`} className="mnu-co-line">
                  <span style={{ color: 'var(--text-muted)' }}>{l.name} × {l.qty}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmtPHP(l.price * l.qty)}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
              <label><span className="mnu-co-label">Delivery date</span><input className="mnu-co-input" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} required /></label>
              <label><span className="mnu-co-label">Delivery time</span><input className="mnu-co-input" type="time" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} required /></label>
            </div>
            <label><span className="mnu-co-label">Delivery address</span><input className="mnu-co-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, Barangay, City" required /></label>
            <label><span className="mnu-co-label">Contact number (optional)</span><input className="mnu-co-input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="09xx xxx xxxx" /></label>

            {!user && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                You'll be asked to sign in to place your order — your cart stays put.
              </div>
            )}
            {checkoutError && <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{checkoutError}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.2rem' }}>
              <button type="button" className="btn-outline" style={{ padding: '0.7rem 1.2rem' }} onClick={() => setCheckoutOpen(false)} disabled={placing}>Cancel</button>
              <button type="button" className="btn-primary" style={{ padding: '0.7rem 1.4rem' }} onClick={() => void placeOrder()} disabled={placing}>
                {placing ? 'Placing…' : user ? 'Place Order' : 'Sign in to Order'}
              </button>
            </div>
          </div>
        </div>
      )}

                    <SiteFooter />

    </>
  );
}
