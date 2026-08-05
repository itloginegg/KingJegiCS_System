import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from '../components/landing/Navbar';
import { ChatWidget } from '../components/landing/ChatWidget';
import { useAuth } from '../hooks/useAuth';
import { readSession } from '../lib/tokenStorage';
import { fetchMenuItems, fetchMenuTrays, getFullImageUrl } from '../api/menuAdminApi';
import { createBooking, addMenuItem, addMenuTray, submitBooking, BookingApiError } from '../api/bookingApi';

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
};

type CartLine = { id: string; type: ProductType; name: string; price: number; qty: number };

/** Stable ordering for the category pills; only categories that actually have items show. */
const CATEGORY_ORDER = ['chicken', 'beef', 'pork', 'seafood', 'pasta', 'vegetable', 'others', 'trays'];
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
        }));
      const trayProducts: Product[] = trays
        .filter((t) => t.isActive)
        .map((t) => ({
          id: t.id, type: 'MenuTray', name: t.trayName, category: 'trays', price: t.pricePerTray,
          description: `A party tray of ${t.dishes.map((d) => d.itemName).join(', ')} — serves ${t.servesMin}–${t.servesMax}.`,
          serves: t.servesMin,
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

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => (category === 'all' || p.category === category) && (q === '' || p.name.toLowerCase().includes(q)),
    );
  }, [products, category, query]);

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

  /* Escape closes the detail drawer / checkout */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelected(null);
      setCheckoutOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sectionPad: React.CSSProperties = { padding: '6rem 0', position: 'relative' };

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
        .mnu-pill { border: 1px solid var(--border); background: transparent; color: var(--text-muted); font-family: var(--font-body); font-size: 0.62rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500; padding: 0.5rem 1rem; border-radius: var(--r-full); cursor: pointer; white-space: nowrap; transition: background 0.2s, color 0.2s, border-color 0.2s; }
        .mnu-pill:hover { color: var(--primary); border-color: var(--border-accent); }
        .mnu-pill.active { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
        .mnu-pill .count { opacity: 0.6; margin-left: 0.35rem; }
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
        .mnu-backdrop { position: fixed; inset: 0; z-index: 90; background: rgba(20, 14, 8, 0.45); backdrop-filter: blur(3px); display: none; }
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
        .mnu-co-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(20, 14, 8, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
        .mnu-co-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); padding: 1.6rem 1.75rem; display: flex; flex-direction: column; gap: 1rem; }
        .mnu-co-label { font-family: var(--font-body); font-size: 0.52rem; letter-spacing: 0.26em; text-transform: uppercase; font-weight: 500; color: var(--text-dim); display: block; margin-bottom: 0.4rem; }
        .mnu-co-input { width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 0.6rem 0.85rem; font-family: var(--font-body); font-size: 0.85rem; color: var(--text-primary); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
        .mnu-co-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
        .mnu-co-line { display: flex; justify-content: space-between; gap: 0.8rem; font-family: var(--font-body); font-size: 0.8rem; padding: 0.35rem 0; border-bottom: 1px solid var(--border); }

        .btn-primary { background: var(--primary); color: var(--primary-text); border: none; padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; cursor: pointer; border-radius: var(--r-full); transition: background 0.25s, transform 0.2s, box-shadow 0.2s; text-decoration: none; display: inline-block; text-align: center; }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: var(--shadow-green); }
        .btn-outline { background: transparent; color: var(--primary); border: 1px solid var(--border-accent); padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; cursor: pointer; border-radius: var(--r-full); transition: background 0.25s, border-color 0.25s, transform 0.2s; text-decoration: none; display: inline-block; text-align: center; }
        .btn-outline:hover { background: var(--primary-muted); border-color: var(--primary); transform: translateY(-2px); }
      `}</style>

      <Navbar activePage="menus" cartCount={cartCount} onCartClick={() => { setCheckoutError(''); setCheckoutOpen(true); }} />

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>

        {/* ═══════════════════════ HERO ═══════════════════════ */}
        <section style={{ ...sectionPad, paddingTop: 'calc(6rem + 80px)', paddingBottom: '4rem', overflow: 'hidden' }}>
          <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
          <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />

          <div className="fade-up" style={{ maxWidth: 800, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', background: 'var(--accent-muted)', border: '1px solid var(--border-accent)', padding: '0.35rem 1rem', marginBottom: '1.5rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 500 }}>
                From Our Kitchen
              </span>
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)', fontWeight: 400, lineHeight: 1.08, color: 'var(--text-primary)', marginBottom: '1.5rem' }}>
              A Menu for <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Every Table</em>
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1.75, maxWidth: 520, margin: '0 auto', fontWeight: 300 }}>
              Browse our full spread of Filipino favorites and party trays — filter by category,
              build your delivery cart, and check out in a few taps.
            </p>
          </div>
        </section>

        {/* ═══════════════════════ FILTER TOOLBAR ═══════════════════════ */}
        <div className="mnu-toolbar">
          <div className="mnu-toolbar-inner">
            <div className="mnu-pills" role="tablist" aria-label="Dish categories">
              <button type="button" className={`mnu-pill${category === 'all' ? ' active' : ''}`} onClick={() => setCategory('all')}>
                All<span className="count">{products.length}</span>
              </button>
              {categories.map((c) => (
                <button key={c} type="button" className={`mnu-pill${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
                  {catLabel(c)}<span className="count">{countByCategory.get(c) ?? 0}</span>
                </button>
              ))}
            </div>

            <label className="mnu-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input type="search" placeholder="Search dishes…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search dishes" />
            </label>
          </div>
        </div>

        {/* ═══════════════════════ DISH GRID ═══════════════════════ */}
        <section style={{ background: 'var(--bg-subtle)', padding: '3.5rem 0 6rem' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-dim)', fontFamily: 'var(--font-body)' }}>Loading menu…</div>
            ) : loadError ? (
              <div className="mnu-empty fade-up">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{loadError}</p>
                <button type="button" className="btn-outline" onClick={() => void loadCatalog()}>Try Again</button>
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="mnu-empty fade-up">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No dishes match your search</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 300, marginBottom: '1.5rem' }}>Try a different keyword, or browse another category.</p>
                <button type="button" className="btn-outline" onClick={() => { setQuery(''); setCategory('all'); }}>Reset Filters</button>
              </div>
            ) : (
              <div className="mnu-grid">
                {visibleProducts.map((product, i) => {
                  const key = cartKey(product);
                  const isSelected = selected ? cartKey(selected) === key : false;
                  return (
                    <article
                      key={key}
                      className={`mnu-card fade-up${isSelected ? ' selected' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}
                      onClick={() => setSelected(isSelected ? null : product)}
                    >
                      <div className="mnu-photo-wrap">
                        <ProductImage product={product} className="mnu-photo" />
                      </div>
                      <div className="mnu-card-body">
                        <span className="mnu-cat-chip">{catLabel(product.category)}</span>
                        <h3 className="mnu-dish-name">{product.name}</h3>
                        <p className="mnu-dish-desc">{product.description}</p>
                        <div className="mnu-card-foot">
                          <p className="mnu-price">
                            {fmtPHP(product.price)} <small>/ {product.type === 'MenuTray' ? 'tray' : 'tray-serving'}</small>
                          </p>
                          <QtyStepper value={qtyOf(key)} onDelta={(d) => bumpQty(key, d)} label={product.name} />
                          <button type="button" className={`mnu-add${flashKey === key ? ' flash' : ''}`} onClick={(e) => { e.stopPropagation(); addToCart(product); }}>
                            {flashKey === key ? 'Added ✓' : '+ Add'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════ CUSTOM MENU CTA ═══════════════════════ */}
        <section style={{ ...sectionPad, background: 'var(--bg)', paddingTop: '5rem', paddingBottom: '5rem' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '1rem' }}>Can't decide?</p>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem, 3vw, 2.5rem)', fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: '0.85rem' }}>
              Let us craft a <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>custom menu</em> for your event
            </h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300, maxWidth: 540, margin: '0 auto 2rem' }}>
              Planning a full event? Tell us about your guests and style — we'll build a menu and a quote that fit.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/book" className="btn-primary">Plan a Full Event</a>
              <a href="/packages" className="btn-outline">See Our Packages</a>
            </div>
          </div>
        </section>

        {/* ═══════════════════════ FOOTER ═══════════════════════ */}
        <footer style={{ background: 'var(--bg-subtle)', borderTop: '1px solid var(--border)', padding: '3rem 2.5rem', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            © {new Date().getFullYear()} King Jegi Party Need and Catering Services · Calamba, Laguna
          </p>
        </footer>
      </main>

      {/* ═══════════════════════ DETAIL DRAWER ═══════════════════════ */}
      {selected && (
        <>
          <div className="mnu-backdrop" onClick={() => setSelected(null)} />
          <aside className="mnu-drawer" role="dialog" aria-label={`${selected.name} details`}>
            <button type="button" className="mnu-drawer-close" onClick={() => setSelected(null)} aria-label="Close details">✕</button>
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
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>{fmtPHP(cartTotal)}</span>
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

      <ChatWidget />
    </>
  );
}
