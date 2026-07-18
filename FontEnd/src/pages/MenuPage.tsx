import { useEffect, useMemo, useState } from 'react';
import { Navbar } from '../components/landing/Navbar';
import { ChatWidget } from '../components/landing/ChatWidget';

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

type MenuCategory = { id: string; label: string };

type Dish = {
  id: number;
  name: string;
  category: string;
  price: number;
  description: string;
  image?: string;
  popular?: boolean;
};

const CATEGORIES: MenuCategory[] = [
  { id: 'chicken', label: 'Chicken' },
  { id: 'beef', label: 'Beef' },
  { id: 'pork', label: 'Pork' },
  { id: 'seafood', label: 'Seafood' },
  { id: 'vegetables', label: 'Vegetables' },
  { id: 'desserts', label: 'Desserts' },
];

const DISHES: Dish[] = [
  {
    id: 1, name: 'Chicken Adobo', category: 'chicken', price: 180, popular: true,
    description: 'The classic — chicken braised low and slow in soy, vinegar, garlic, and bay leaf until fall-off-the-bone tender.',
  },
  {
    id: 2, name: 'Chicken Inasal', category: 'chicken', price: 195,
    description: 'Bacolod-style grilled chicken marinated in calamansi, lemongrass, and annatto, basted over live coals.',
  },
  {
    id: 3, name: 'Crispy Fried Chicken', category: 'chicken', price: 170,
    image: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?auto=format&fit=crop&w=800&q=80',
    description: 'Buttermilk-brined and double-fried for shatter-crisp skin with a juicy center. A guaranteed crowd favorite.',
  },
  {
    id: 4, name: 'Chicken Curry', category: 'chicken', price: 185,
    description: 'Coconut-milk curry with potatoes, carrots, and bell peppers — mild, creamy, and family-friendly.',
  },
  {
    id: 5, name: 'Beef Caldereta', category: 'beef', price: 250, popular: true,
    description: 'Rich tomato and liver-sauce stew with tender beef chunks, olives, and a slow-simmered depth of flavor.',
  },
  {
    id: 6, name: 'Bistek Tagalog', category: 'beef', price: 240,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    description: 'Thin-sliced beef braised in soy and calamansi, crowned with sweet caramelized onion rings.',
  },
  {
    id: 7, name: 'Kare-Kare', category: 'beef', price: 260,
    description: 'Oxtail and vegetables in a velvety peanut sauce, served with house-made bagoong on the side.',
  },
  {
    id: 8, name: 'Beef Mechado', category: 'beef', price: 245,
    description: 'Larded beef braised in tomato sauce with a hint of citrus — an heirloom fiesta staple.',
  },
  {
    id: 9, name: 'Lechon Belly', category: 'pork', price: 320, popular: true,
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=80',
    description: 'Heritage-breed pork belly rolled with lemongrass and garlic, slow-roasted six hours to glass-crisp skin.',
  },
  {
    id: 10, name: 'Pork Sisig', category: 'pork', price: 210,
    description: 'Sizzling chopped pork with onion, chili, and calamansi — smoky, tangy, and made for sharing.',
  },
  {
    id: 11, name: 'Crispy Pata', category: 'pork', price: 380,
    description: 'Whole pork knuckle deep-fried to a crackling finish, with our soy-vinegar dip.',
  },
  {
    id: 12, name: 'Pork BBQ Skewers', category: 'pork', price: 150,
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=800&q=80',
    description: 'Sweet-savory glazed skewers grilled to order — the street-party classic, catering-sized.',
  },
  {
    id: 13, name: 'Garlic Butter Shrimp', category: 'seafood', price: 290, popular: true,
    description: 'Plump shrimp tossed in toasted garlic butter with a whisper of chili and calamansi.',
  },
  {
    id: 14, name: 'Sweet & Sour Lapu-Lapu', category: 'seafood', price: 230,
    description: 'Golden-fried grouper fillets glazed with pineapple sweet-and-sour sauce and crisp vegetables.',
  },
  {
    id: 15, name: 'Grilled Bangus', category: 'seafood', price: 220,
    description: 'Boneless milkfish stuffed with tomatoes and onions, grilled in banana leaf.',
  },
  {
    id: 16, name: 'Pinakbet', category: 'vegetables', price: 140,
    description: 'Ilocano vegetable medley — squash, okra, eggplant, and string beans in savory bagoong.',
  },
  {
    id: 17, name: 'Chopsuey', category: 'vegetables', price: 150,
    description: 'Crisp stir-fried vegetables in a light garlic sauce. Bright, colorful, and endlessly refillable.',
  },
  {
    id: 18, name: 'Lumpiang Sariwa', category: 'vegetables', price: 130,
    description: 'Fresh vegetable rolls in soft crepe wrappers, draped with sweet garlic-peanut sauce.',
  },
  {
    id: 19, name: 'Leche Flan', category: 'desserts', price: 120, popular: true,
    description: 'Silk-smooth caramel custard made with a dozen yolks per llanera. The non-negotiable finale.',
  },
  {
    id: 20, name: 'Buko Pandan', category: 'desserts', price: 110,
    description: 'Young coconut and pandan jelly folded into sweet cream — chilled, light, and fragrant.',
  },
  {
    id: 21, name: 'Halo-Halo Bar', category: 'desserts', price: 145,
    description: 'A build-your-own station: shaved ice, sweet beans, jellies, ube halaya, and leche flan on top.',
  },
  {
    id: 22, name: 'Ube Halaya', category: 'desserts', price: 125,
    description: 'Slow-stirred purple yam jam with coconut milk and butter — deep violet, deeply nostalgic.',
  },
];

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]));

/* ─────────────────────────────────────────────────────────────────────────
   Small pieces
───────────────────────────────────────────────────────────────────────── */

function DishImage({ dish, className }: { dish: Dish; className: string }) {
  return dish.image ? (
    <div className={className} style={{ backgroundImage: `url('${dish.image}')` }} />
  ) : (
    <div className={`${className} mnu-letter`} aria-hidden="true">
      {dish.name.charAt(0).toUpperCase()}
    </div>
  );
}

function QtyStepper({
  value,
  onDelta,
  label,
}: {
  value: number;
  /* delta-based so rapid clicks can't act on a stale value */
  onDelta: (delta: number) => void;
  label: string;
}) {
  return (
    <div className="mnu-qty" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Decrease quantity for ${label}`} onClick={() => onDelta(-1)}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`Increase quantity for ${label}`} onClick={() => onDelta(1)}>
        +
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

export function MenuPage() {
  const [category, setCategory] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Dish | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [plan, setPlan] = useState<Record<number, number>>({});
  const [flashId, setFlashId] = useState<number | null>(null);

  const qtyOf = (id: number) => quantities[id] ?? 1;
  const bumpQty = (id: number, delta: number) =>
    setQuantities((prev) => ({ ...prev, [id]: Math.max(1, (prev[id] ?? 1) + delta) }));

  /* filtered grid contents */
  const visibleDishes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DISHES.filter(
      (d) =>
        (category === 'all' || d.category === category) &&
        (q === '' || d.name.toLowerCase().includes(q)),
    );
  }, [category, query]);

  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of DISHES) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, []);

  /* plan totals (display-only — no backend) */
  const planItems = useMemo(() => Object.values(plan).reduce((a, b) => a + b, 0), [plan]);
  const planTotal = useMemo(
    () =>
      Object.entries(plan).reduce((sum, [id, qty]) => {
        const dish = DISHES.find((d) => d.id === Number(id));
        return sum + (dish ? dish.price * qty : 0);
      }, 0),
    [plan],
  );

  const addToPlan = (dish: Dish) => {
    setPlan((prev) => ({ ...prev, [dish.id]: (prev[dish.id] ?? 0) + qtyOf(dish.id) }));
    setFlashId(dish.id);
    window.setTimeout(() => setFlashId((prev) => (prev === dish.id ? null : prev)), 1500);
  };

  /* Escape closes the detail drawer */
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const sectionPad: React.CSSProperties = { padding: '6rem 0', position: 'relative' };

  return (
    <>
      <style>{`
        /* ── blobs ── */
        .blob {
          position: absolute; border-radius: 50%;
          filter: blur(80px); opacity: 0.18; pointer-events: none;
          animation: blobDrift 18s ease-in-out infinite alternate;
        }
        .blob-primary      { background: var(--primary); }
        .blob-accent       { background: var(--accent); }
        .blob-primary-soft { background: var(--primary); opacity: 0.10; }
        .blob-accent-soft  { background: var(--accent);  opacity: 0.10; }
        @keyframes blobDrift {
          0%   { transform: translate(0px, 0px) scale(1); }
          50%  { transform: translate(30px, -20px) scale(1.08); }
          100% { transform: translate(-20px, 15px) scale(0.95); }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.7s ease both; }

        /* ── sticky filter toolbar ── */
        .mnu-toolbar {
          position: sticky; top: 0; z-index: 30;
          background: color-mix(in srgb, var(--bg) 82%, transparent);
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
          border-bottom: 1px solid var(--border);
        }
        .mnu-toolbar-inner {
          max-width: 1200px; margin: 0 auto;
          padding: 0.9rem 2.5rem;
          display: flex; align-items: center; gap: 1rem;
          flex-wrap: wrap;
        }
        .mnu-pills {
          display: flex; align-items: center; gap: 0.4rem;
          overflow-x: auto; flex: 1 1 auto;
          scrollbar-width: none;
          padding: 2px;
        }
        .mnu-pills::-webkit-scrollbar { display: none; }
        .mnu-pill {
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-muted);
          font-family: var(--font-body); font-size: 0.62rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          padding: 0.5rem 1rem;
          border-radius: var(--r-full);
          cursor: pointer; white-space: nowrap;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .mnu-pill:hover { color: var(--primary); border-color: var(--border-accent); }
        .mnu-pill.active {
          background: var(--primary);
          border-color: var(--primary);
          color: var(--primary-text);
        }
        .mnu-pill .count { opacity: 0.6; margin-left: 0.35rem; }

        .mnu-search {
          flex: 0 1 240px; min-width: 170px;
          display: flex; align-items: center; gap: 0.5rem;
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: var(--r-full);
          padding: 0.5rem 1rem;
          transition: border-color 0.2s;
        }
        .mnu-search:focus-within { border-color: var(--primary); }
        .mnu-search svg { flex-shrink: 0; color: var(--text-dim); }
        .mnu-search input {
          border: none; background: transparent; outline: none;
          width: 100%;
          font-family: var(--font-body); font-size: 0.78rem; font-weight: 300;
          color: var(--text-primary);
        }
        .mnu-search input::placeholder { color: var(--text-dim); }

        /* ── dish grid ── */
        .mnu-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1.5rem;
        }

        .mnu-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          overflow: hidden;
          display: flex; flex-direction: column;
          cursor: pointer;
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s;
        }
        .mnu-card:hover {
          border-color: var(--border-accent);
          box-shadow: var(--shadow-md);
          transform: translateY(-3px);
        }
        .mnu-card.selected {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px var(--primary-muted), var(--shadow-md);
        }

        .mnu-photo {
          position: relative;
          aspect-ratio: 4 / 3;
          background-size: cover; background-position: center;
          background-color: var(--bg-subtle);
          transition: transform 0.6s ease;
        }
        .mnu-photo-wrap { overflow: hidden; position: relative; flex-shrink: 0; }
        .mnu-card:hover .mnu-photo { transform: scale(1.05); }
        .mnu-letter {
          display: flex; align-items: center; justify-content: center;
          background:
            radial-gradient(circle at 30% 30%, var(--primary-muted), transparent 60%),
            var(--bg-subtle);
          font-family: var(--font-display);
          font-size: 3.5rem; font-weight: 600;
          color: var(--primary);
        }
        .mnu-popular {
          position: absolute; top: 0.7rem; left: 0.7rem; z-index: 2;
          background: var(--accent);
          color: #fff;
          font-family: var(--font-body); font-size: 0.5rem;
          letter-spacing: 0.2em; text-transform: uppercase; font-weight: 600;
          padding: 0.28rem 0.65rem;
          border-radius: var(--r-full);
          box-shadow: var(--shadow-gold);
        }

        .mnu-card-body {
          padding: 1.15rem 1.25rem 1.25rem;
          display: flex; flex-direction: column; flex: 1; gap: 0.45rem;
        }
        .mnu-cat-chip {
          align-self: flex-start;
          font-family: var(--font-body); font-size: 0.52rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--primary);
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          padding: 0.2rem 0.6rem;
        }
        .mnu-dish-name {
          font-family: var(--font-display);
          font-size: 1.25rem; font-weight: 500; line-height: 1.2;
          color: var(--text-primary);
        }
        .mnu-dish-desc {
          font-family: var(--font-body);
          font-size: 0.78rem; font-weight: 300; line-height: 1.6;
          color: var(--text-muted);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          flex: 1;
        }

        .mnu-card-foot {
          border-top: 1px solid var(--border);
          margin-top: 0.55rem; padding-top: 0.8rem;
          display: flex; align-items: center; gap: 0.55rem;
        }
        .mnu-price {
          font-family: var(--font-display);
          font-size: 1.15rem; font-weight: 600; line-height: 1;
          color: var(--primary);
          margin-right: auto;
        }
        .mnu-price small {
          font-family: var(--font-body); font-size: 0.55rem; font-weight: 400;
          letter-spacing: 0.08em; color: var(--text-dim);
        }

        .mnu-qty {
          display: flex; align-items: center;
          border: 1px solid var(--border);
          border-radius: var(--r-full);
          background: var(--bg-subtle);
          overflow: hidden;
        }
        .mnu-qty button {
          border: none; background: transparent; cursor: pointer;
          width: 26px; height: 26px; line-height: 1;
          color: var(--primary); font-size: 0.9rem; font-weight: 600;
          transition: background 0.15s;
        }
        .mnu-qty button:hover { background: var(--primary-muted); }
        .mnu-qty span {
          min-width: 24px; text-align: center;
          font-family: var(--font-body); font-size: 0.72rem; font-weight: 500;
          color: var(--text-primary);
        }

        .mnu-add {
          border: 1px solid var(--border-accent);
          background: var(--primary-muted);
          color: var(--primary);
          font-family: var(--font-body); font-size: 0.56rem;
          letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500;
          padding: 0.5rem 0.9rem;
          border-radius: var(--r-full);
          cursor: pointer; white-space: nowrap;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .mnu-add:hover, .mnu-add.flash {
          background: var(--primary);
          border-color: var(--primary);
          color: var(--primary-text);
        }

        /* ── empty state ── */
        .mnu-empty {
          background: var(--surface);
          border: 1px dashed var(--border-strong);
          border-radius: var(--r-xl);
          padding: 3.5rem 2rem;
          text-align: center;
        }

        /* ── detail drawer ── */
        @keyframes drawerIn {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        @keyframes sheetIn {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .mnu-backdrop {
          position: fixed; inset: 0; z-index: 90;
          background: rgba(20, 14, 8, 0.45);
          backdrop-filter: blur(3px);
          display: none;
        }
        .mnu-drawer {
          position: fixed; top: 0; right: 0; z-index: 95;
          height: 100vh; width: 340px; max-width: 92vw;
          background: var(--surface);
          border-left: 1px solid var(--border-accent);
          box-shadow: -8px 0 48px rgba(0, 0, 0, 0.16);
          padding: 5.5rem 1.75rem 1.75rem;
          overflow-y: auto;
          display: flex; flex-direction: column; gap: 0.9rem;
          animation: drawerIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @media (max-width: 900px) {
          .mnu-backdrop { display: block; }
          .mnu-drawer {
            top: auto; bottom: 0; right: 0; left: 0;
            width: 100%; max-width: none; height: auto; max-height: 78vh;
            border-left: none;
            border-top: 1px solid var(--border-accent);
            border-radius: var(--r-xl) var(--r-xl) 0 0;
            padding: 1.5rem 1.5rem 2rem;
            animation: sheetIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
          }
        }
        .mnu-drawer-photo {
          aspect-ratio: 4 / 3; width: 100%;
          border-radius: var(--r-lg);
          background-size: cover; background-position: center;
          background-color: var(--bg-subtle);
          border: 1px solid var(--border);
          overflow: hidden; flex-shrink: 0;
        }
        .mnu-drawer-photo.mnu-letter { font-size: 3rem; }
        .mnu-drawer-close {
          position: absolute; top: 5rem; right: 1.25rem;
          width: 32px; height: 32px; border-radius: 50%;
          border: 1px solid var(--border);
          background: var(--bg-subtle); color: var(--text-muted);
          cursor: pointer; font-size: 0.85rem;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s, color 0.2s;
        }
        @media (max-width: 900px) { .mnu-drawer-close { top: 1rem; } }
        .mnu-drawer-close:hover { background: var(--primary-muted); color: var(--primary); }

        /* ── floating plan bar ── */
        @keyframes planIn {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to   { transform: translate(-50%, 0); opacity: 1; }
        }
        .mnu-plan {
          position: fixed; bottom: 1.5rem; left: 50%;
          transform: translateX(-50%);
          z-index: 80;
          display: flex; align-items: center; gap: 1rem;
          background: var(--surface);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          padding: 0.6rem 0.7rem 0.6rem 1.4rem;
          box-shadow: var(--shadow-lg);
          animation: planIn 0.3s ease both;
          max-width: calc(100vw - 8rem);
        }
        .mnu-plan-clear {
          border: none; background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.58rem;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--text-dim);
          transition: color 0.2s;
          white-space: nowrap;
        }
        .mnu-plan-clear:hover { color: var(--danger); }
        .mnu-plan-cta {
          background: var(--primary); color: var(--primary-text);
          font-family: var(--font-body); font-size: 0.6rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          border-radius: var(--r-full);
          padding: 0.65rem 1.25rem;
          text-decoration: none; white-space: nowrap;
          transition: background 0.2s;
        }
        .mnu-plan-cta:hover { background: var(--primary-hover); }

        /* ── shared buttons ── */
        .btn-primary {
          background: var(--primary); color: var(--primary-text); border: none;
          padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.68rem;
          font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.25s, transform 0.2s, box-shadow 0.2s;
          text-decoration: none; display: inline-block; text-align: center;
        }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: var(--shadow-green); }
        .btn-outline {
          background: transparent; color: var(--primary);
          border: 1px solid var(--border-accent);
          padding: 0.9rem 1.5rem; font-family: var(--font-body); font-size: 0.68rem;
          font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase;
          cursor: pointer; border-radius: var(--r-full);
          transition: background 0.25s, border-color 0.25s, transform 0.2s;
          text-decoration: none; display: inline-block; text-align: center;
        }
        .btn-outline:hover { background: var(--primary-muted); border-color: var(--primary); transform: translateY(-2px); }
      `}</style>

      <Navbar activePage="menus" />

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>

        {/* ═══════════════════════ HERO ═══════════════════════ */}
        <section
          style={{
            ...sectionPad,
            paddingTop: 'calc(6rem + 80px)',
            paddingBottom: '4rem',
            overflow: 'hidden',
          }}
        >
          <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
          <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />

          <div
            className="fade-up"
            style={{ maxWidth: 800, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}
          >
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                background: 'var(--accent-muted)', border: '1px solid var(--border-accent)',
                padding: '0.35rem 1rem', marginBottom: '1.5rem',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
              <span
                style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.58rem',
                  letterSpacing: '0.3em', textTransform: 'uppercase',
                  color: 'var(--primary)', fontWeight: 500,
                }}
              >
                From Our Kitchen
              </span>
            </div>

            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)',
                fontWeight: 400, lineHeight: 1.08,
                color: 'var(--text-primary)',
                marginBottom: '1.5rem',
              }}
            >
              A Menu for{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Every Table</em>
            </h1>

            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '1rem',
                color: 'var(--text-muted)', lineHeight: 1.75,
                maxWidth: 520, margin: '0 auto', fontWeight: 300,
              }}
            >
              Browse our full spread of Filipino favorites — filter by category,
              pick your dishes, and sketch out the perfect plate for your event.
            </p>
          </div>
        </section>

        {/* ═══════════════════════ FILTER TOOLBAR ═══════════════════════ */}
        <div className="mnu-toolbar">
          <div className="mnu-toolbar-inner">
            <div className="mnu-pills" role="tablist" aria-label="Dish categories">
              <button
                type="button"
                className={`mnu-pill${category === 'all' ? ' active' : ''}`}
                onClick={() => setCategory('all')}
              >
                All<span className="count">{DISHES.length}</span>
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`mnu-pill${category === c.id ? ' active' : ''}`}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                  <span className="count">{countByCategory.get(c.id) ?? 0}</span>
                </button>
              ))}
            </div>

            <label className="mnu-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                placeholder="Search dishes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search dishes"
              />
            </label>
          </div>
        </div>

        {/* ═══════════════════════ DISH GRID ═══════════════════════ */}
        <section style={{ background: 'var(--bg-subtle)', padding: '3.5rem 0 6rem' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>
            {visibleDishes.length === 0 ? (
              <div className="mnu-empty fade-up">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  No dishes match your search
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 300, marginBottom: '1.5rem' }}>
                  Try a different keyword, or browse another category.
                </p>
                <button type="button" className="btn-outline" onClick={() => { setQuery(''); setCategory('all'); }}>
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="mnu-grid">
                {visibleDishes.map((dish, i) => {
                  const isSelected = selected?.id === dish.id;
                  return (
                    <article
                      key={dish.id}
                      className={`mnu-card fade-up${isSelected ? ' selected' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}
                      onClick={() => setSelected(isSelected ? null : dish)}
                    >
                      <div className="mnu-photo-wrap">
                        {dish.popular && <span className="mnu-popular">Popular</span>}
                        <DishImage dish={dish} className="mnu-photo" />
                      </div>

                      <div className="mnu-card-body">
                        <span className="mnu-cat-chip">{CATEGORY_LABEL.get(dish.category)}</span>
                        <h3 className="mnu-dish-name">{dish.name}</h3>
                        <p className="mnu-dish-desc">{dish.description}</p>

                        <div className="mnu-card-foot">
                          <p className="mnu-price">
                            {fmtPHP(dish.price)} <small>/ serving</small>
                          </p>
                          <QtyStepper value={qtyOf(dish.id)} onDelta={(d) => bumpQty(dish.id, d)} label={dish.name} />
                          <button
                            type="button"
                            className={`mnu-add${flashId === dish.id ? ' flash' : ''}`}
                            onClick={(e) => { e.stopPropagation(); addToPlan(dish); }}
                          >
                            {flashId === dish.id ? 'Added ✓' : '+ Add'}
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
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '1rem' }}>
              Can't decide?
            </p>
            <h3
              style={{
                fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem, 3vw, 2.5rem)',
                fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: '0.85rem',
              }}
            >
              Let us craft a{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>custom menu</em>{' '}
              for your event
            </h3>
            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '0.92rem',
                color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300,
                maxWidth: 540, margin: '0 auto 2rem',
              }}
            >
              Tell us about your guests, dietary needs, and event style — we'll
              build a menu that fits your celebration and your budget.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/#availability" className="btn-primary">Request a Custom Menu</a>
              <a href="/packages" className="btn-outline">See Our Packages</a>
            </div>
          </div>
        </section>

        {/* ═══════════════════════ FINAL CTA BAND ═══════════════════════ */}
        <section style={{ ...sectionPad, paddingTop: '4rem', paddingBottom: '4rem', background: 'var(--primary)', overflow: 'hidden' }}>
          <div className="blob blob-primary-soft" style={{ width: 500, height: 500, top: '-150px', right: '-100px' }} />
          <div className="blob blob-accent-soft" style={{ width: 350, height: 350, bottom: '-80px', left: '-60px', animationDelay: '8s' }} />

          <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(255,255,255,0.15)', padding: '0.35rem 1rem', marginBottom: '1rem',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
                Ready to Book?
              </span>
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4.5vw, 3rem)', fontWeight: 400, color: '#fff', lineHeight: 1.1, marginBottom: '0.5rem' }}>
              Reserve Your Date{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Today</em>
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, fontWeight: 300, marginBottom: '1.5rem' }}>
              No payment required to reserve. We'll confirm your booking within 24 hours.
            </p>
            <a
              href="/#availability"
              style={{
                background: '#fff', color: 'var(--primary)',
                padding: '1.1rem 2.75rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem',
                fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase',
                textDecoration: 'none', borderRadius: 'var(--r-full)',
                transition: 'transform 0.2s, box-shadow 0.2s', display: 'inline-block',
              }}
            >
              Book Your Event
            </a>
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
            <button type="button" className="mnu-drawer-close" onClick={() => setSelected(null)} aria-label="Close details">
              ✕
            </button>

            <DishImage dish={selected} className="mnu-drawer-photo" />

            <span className="mnu-cat-chip">{CATEGORY_LABEL.get(selected.category)}</span>

            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.15 }}>
              {selected.name}
            </h3>

            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300 }}>
              {selected.description}
            </p>

            <div
              style={{
                display: 'flex', alignItems: 'baseline', gap: '0.5rem',
                borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                padding: '0.8rem 0',
              }}
            >
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
                Price
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--primary)', marginLeft: 'auto', lineHeight: 1 }}>
                {fmtPHP(selected.price)}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--text-dim)' }}>/ serving</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <QtyStepper value={qtyOf(selected.id)} onDelta={(d) => bumpQty(selected.id, d)} label={selected.name} />
              <button
                type="button"
                className={`mnu-add${flashId === selected.id ? ' flash' : ''}`}
                style={{ flex: 1, padding: '0.7rem 0.9rem' }}
                onClick={() => addToPlan(selected)}
              >
                {flashId === selected.id ? 'Added to plan ✓' : 'Add to Menu Plan'}
              </button>
            </div>

            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--text-dim)', lineHeight: 1.6, fontWeight: 300, marginTop: 'auto' }}>
              Planning is free — your selections help us draft a quotation.
              Final menus are confirmed with our coordinators.
            </p>
          </aside>
        </>
      )}

      {/* ═══════════════════════ FLOATING PLAN BAR ═══════════════════════ */}
      {planItems > 0 && (
        <div className="mnu-plan" role="status" aria-label="Menu plan summary">
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{planItems}</strong>
            {' '}serving{planItems === 1 ? '' : 's'} ·{' '}
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
              {fmtPHP(planTotal)}
            </span>
          </p>
          <button type="button" className="mnu-plan-clear" onClick={() => setPlan({})}>
            Clear
          </button>
          <a href="/#availability" className="mnu-plan-cta">
            Request Quote →
          </a>
        </div>
      )}

      <ChatWidget />
    </>
  );
}
