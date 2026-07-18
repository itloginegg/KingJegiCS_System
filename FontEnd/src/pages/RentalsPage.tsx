import { useMemo, useState } from 'react';
import { Navbar } from '../components/landing/Navbar';
import { ChatWidget } from '../components/landing/ChatWidget';

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

type RentalCategory = { id: string; label: string; icon: string };

type RentalItem = {
  id: number;
  name: string;
  category: string;
  pricePerDay: number;
  stock: number;
  description: string;
};

const CATEGORIES: RentalCategory[] = [
  { id: 'seating', label: 'Seating', icon: '🪑' },
  { id: 'tables', label: 'Tables', icon: '🎪' },
  { id: 'linens', label: 'Linens', icon: '🧵' },
  { id: 'tableware', label: 'Tableware', icon: '🍽️' },
  { id: 'decor', label: 'Décor', icon: '✨' },
  { id: 'sound', label: 'Sound & Lights', icon: '🎤' },
];

const RENTALS: RentalItem[] = [
  { id: 1, name: 'Tiffany Chairs', category: 'seating', pricePerDay: 35, stock: 300, description: 'Elegant clear-back chairs for weddings and formal receptions.' },
  { id: 2, name: 'Monoblock Chairs', category: 'seating', pricePerDay: 12, stock: 500, description: 'Sturdy all-purpose seating, with optional covers and sashes.' },
  { id: 3, name: 'Kiddie Chairs', category: 'seating', pricePerDay: 10, stock: 120, description: 'Colorful child-sized chairs for birthday parties and play corners.' },
  { id: 4, name: 'Lounge Sofa Set', category: 'seating', pricePerDay: 950, stock: 6, description: 'A plush 3-piece lounge set for VIP corners and photo areas.' },

  { id: 5, name: 'Round Table (10-seater)', category: 'tables', pricePerDay: 120, stock: 60, description: 'Classic banquet rounds — the backbone of any reception layout.' },
  { id: 6, name: 'Long Banquet Table', category: 'tables', pricePerDay: 100, stock: 40, description: 'Rectangular tables for buffets, head tables, and family-style dining.' },
  { id: 7, name: 'Cocktail Table', category: 'tables', pricePerDay: 90, stock: 25, description: 'Standing-height tables for mingling areas and welcome drinks.' },
  { id: 8, name: 'Kids Party Table', category: 'tables', pricePerDay: 80, stock: 20, description: 'Low tables sized for little guests, pairs with our kiddie chairs.' },

  { id: 9, name: 'Round Table Cloth', category: 'linens', pricePerDay: 25, stock: 80, description: 'Floor-length cloths in white, ivory, and custom theme colors.' },
  { id: 10, name: 'Chair Cover with Sash', category: 'linens', pricePerDay: 15, stock: 300, description: 'Fitted spandex covers with satin sashes in your motif.' },
  { id: 11, name: 'Table Runner', category: 'linens', pricePerDay: 12, stock: 100, description: 'Accent runners in satin, lace, or burlap to layer your tablescape.' },
  { id: 12, name: 'Table Skirting', category: 'linens', pricePerDay: 30, stock: 0, description: 'Pleated skirting for buffet, cake, and registration tables.' },

  { id: 13, name: 'Dinner Plate Set', category: 'tableware', pricePerDay: 8, stock: 500, description: 'Porcelain dinner plates, quoted per setting.' },
  { id: 14, name: 'Goblet Glasses', category: 'tableware', pricePerDay: 6, stock: 400, description: 'Classic stemmed goblets for water, juice, or wine service.' },
  { id: 15, name: 'Cutlery Set', category: 'tableware', pricePerDay: 6, stock: 500, description: 'Stainless spoon-and-fork settings, polished before every event.' },
  { id: 16, name: 'Chafing Dish', category: 'tableware', pricePerDay: 150, stock: 30, description: 'Full-size stainless chafers that keep the buffet hot for hours.' },

  { id: 17, name: 'Balloon Arch Frame', category: 'decor', pricePerDay: 450, stock: 8, description: 'Freestanding arch frame — styling and balloons quoted separately.' },
  { id: 18, name: 'Fairy Light Strand (10m)', category: 'decor', pricePerDay: 60, stock: 40, description: 'Warm-white string lights for ceilings, backdrops, and trees.' },
  { id: 19, name: 'Flower Centerpiece', category: 'decor', pricePerDay: 85, stock: 50, description: 'Artificial floral arrangements that photograph like fresh blooms.' },
  { id: 20, name: 'Red Carpet (10m)', category: 'decor', pricePerDay: 350, stock: 5, description: 'A grand entrance runner for debuts, premieres, and weddings.' },

  { id: 21, name: 'Sound System Package', category: 'sound', pricePerDay: 1800, stock: 6, description: 'Two speakers, mixer, and cabling — covers up to 200 guests.' },
  { id: 22, name: 'Wireless Microphone', category: 'sound', pricePerDay: 250, stock: 12, description: 'Handheld wireless mics for hosts, toasts, and videoke sessions.' },
  { id: 23, name: 'Party Lights Set', category: 'sound', pricePerDay: 400, stock: 15, description: 'Moving-head and wash lights to turn any hall into a dance floor.' },
  { id: 24, name: 'Projector & Screen', category: 'sound', pricePerDay: 900, stock: 4, description: 'HD projector with tripod screen for AVPs and same-day edits.' },
];

const CATEGORY_META = new Map(CATEGORIES.map((c) => [c.id, c]));

const LOW_STOCK_AT = 10;
const MAX_DAYS = 14;

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

export function RentalsPage() {
  const [category, setCategory] = useState<'all' | string>('all');
  const [days, setDays] = useState(1);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [plan, setPlan] = useState<Record<number, number>>({});
  const [flashId, setFlashId] = useState<number | null>(null);

  const qtyOf = (id: number) => quantities[id] ?? 1;
  const bumpQty = (item: RentalItem, delta: number) =>
    setQuantities((prev) => ({
      ...prev,
      [item.id]: Math.min(item.stock, Math.max(1, (prev[item.id] ?? 1) + delta)),
    }));

  const visible = useMemo(
    () => (category === 'all' ? RENTALS : RENTALS.filter((r) => r.category === category)),
    [category],
  );

  const countFor = (id: 'all' | string) =>
    id === 'all' ? RENTALS.length : RENTALS.filter((r) => r.category === id).length;

  /* estimate (display-only — no backend) */
  const planPieces = useMemo(() => Object.values(plan).reduce((a, b) => a + b, 0), [plan]);
  const planPerDay = useMemo(
    () =>
      Object.entries(plan).reduce((sum, [id, qty]) => {
        const item = RENTALS.find((r) => r.id === Number(id));
        return sum + (item ? item.pricePerDay * qty : 0);
      }, 0),
    [plan],
  );

  const addToPlan = (item: RentalItem) => {
    setPlan((prev) => {
      const next = Math.min(item.stock, (prev[item.id] ?? 0) + qtyOf(item.id));
      return { ...prev, [item.id]: next };
    });
    setFlashId(item.id);
    window.setTimeout(() => setFlashId((prev) => (prev === item.id ? null : prev)), 1500);
  };

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

        /* ── filter row: chips + duration ── */
        .rnt-filters {
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; flex-wrap: wrap;
          margin-bottom: 2.75rem;
        }
        .rnt-chips { display: flex; gap: 0.45rem; flex-wrap: wrap; }
        .rnt-chip {
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-muted);
          font-family: var(--font-body); font-size: 0.62rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          padding: 0.55rem 1.05rem;
          border-radius: var(--r-full);
          cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; gap: 0.5rem;
          transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s;
        }
        .rnt-chip:hover { color: var(--primary); border-color: var(--border-accent); transform: translateY(-1px); }
        .rnt-chip.active {
          background: var(--primary);
          border-color: var(--primary);
          color: var(--primary-text);
        }
        .rnt-chip .count {
          font-size: 0.55rem; letter-spacing: 0.04em;
          background: var(--bg-subtle); color: var(--text-dim);
          border-radius: var(--r-full); padding: 0.08rem 0.45rem;
        }
        .rnt-chip.active .count { background: rgba(255,255,255,0.2); color: var(--primary-text); }

        .rnt-days {
          display: flex; align-items: center; gap: 0.65rem;
          border: 1px solid var(--border-accent);
          background: var(--surface);
          border-radius: var(--r-full);
          padding: 0.4rem 0.5rem 0.4rem 1.1rem;
        }
        .rnt-days .label {
          font-family: var(--font-body); font-size: 0.56rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim); white-space: nowrap;
        }
        .rnt-days button {
          border: none; cursor: pointer;
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--primary-muted); color: var(--primary);
          font-size: 0.9rem; font-weight: 600; line-height: 1;
          transition: background 0.18s, color 0.18s;
        }
        .rnt-days button:hover { background: var(--primary); color: var(--primary-text); }
        .rnt-days .value {
          font-family: var(--font-display); font-size: 1rem; font-weight: 600;
          color: var(--text-primary); min-width: 3.6rem; text-align: center;
        }

        /* ── product grid ── */
        .rnt-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 1.25rem;
        }

        .rnt-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          overflow: hidden;
          display: flex; flex-direction: column;
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s, opacity 0.25s;
        }
        .rnt-card:hover {
          border-color: var(--border-accent);
          box-shadow: var(--shadow-md);
          transform: translateY(-3px);
        }
        .rnt-card.sold-out { opacity: 0.72; }
        .rnt-card.sold-out:hover { transform: none; box-shadow: none; border-color: var(--border); }

        .rnt-tile {
          position: relative;
          aspect-ratio: 5 / 3;
          display: flex; align-items: center; justify-content: center;
          background:
            radial-gradient(circle at 30% 30%, var(--primary-muted), transparent 65%),
            var(--bg-subtle);
          flex-shrink: 0;
        }
        .rnt-tile .icon {
          font-size: 2.6rem; line-height: 1;
          filter: saturate(0.85);
          transition: transform 0.4s ease;
          user-select: none;
        }
        .rnt-card:hover .rnt-tile .icon { transform: scale(1.12); }

        .rnt-stock {
          position: absolute; top: 0.6rem; right: 0.6rem;
          font-family: var(--font-body); font-size: 0.5rem;
          letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600;
          padding: 0.22rem 0.6rem;
          border-radius: var(--r-full);
          border: 1px solid var(--border-accent);
          background: var(--primary-muted);
          color: var(--primary);
        }
        .rnt-stock.low {
          background: var(--accent-muted);
          border-color: var(--border-accent);
          color: var(--accent);
        }
        .rnt-stock.none {
          background: var(--danger-muted);
          border-color: color-mix(in srgb, var(--danger) 35%, transparent);
          color: var(--danger);
        }

        .rnt-body {
          padding: 1rem 1.1rem 1.1rem;
          display: flex; flex-direction: column; flex: 1; gap: 0.35rem;
        }
        .rnt-cat {
          font-family: var(--font-body); font-size: 0.5rem;
          letter-spacing: 0.24em; text-transform: uppercase; font-weight: 500;
          color: var(--primary);
        }
        .rnt-name {
          font-family: var(--font-display);
          font-size: 1.15rem; font-weight: 500; line-height: 1.2;
          color: var(--text-primary);
        }
        .rnt-desc {
          font-family: var(--font-body);
          font-size: 0.74rem; font-weight: 300; line-height: 1.55;
          color: var(--text-muted);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          flex: 1;
        }
        .rnt-price {
          font-family: var(--font-display);
          font-size: 1.2rem; font-weight: 600; line-height: 1;
          color: var(--primary);
          margin-top: 0.2rem;
        }
        .rnt-price small {
          font-family: var(--font-body); font-size: 0.55rem; font-weight: 400;
          letter-spacing: 0.08em; color: var(--text-dim);
        }

        .rnt-foot {
          border-top: 1px solid var(--border);
          margin-top: 0.65rem; padding-top: 0.75rem;
          display: flex; align-items: center; gap: 0.5rem;
        }
        .rnt-qty {
          display: flex; align-items: center;
          border: 1px solid var(--border);
          border-radius: var(--r-full);
          background: var(--bg-subtle);
          overflow: hidden; flex-shrink: 0;
        }
        .rnt-qty button {
          border: none; background: transparent; cursor: pointer;
          width: 25px; height: 25px; line-height: 1;
          color: var(--primary); font-size: 0.85rem; font-weight: 600;
          transition: background 0.15s;
        }
        .rnt-qty button:hover { background: var(--primary-muted); }
        .rnt-qty span {
          min-width: 24px; text-align: center;
          font-family: var(--font-body); font-size: 0.7rem; font-weight: 500;
          color: var(--text-primary);
        }

        .rnt-add {
          flex: 1;
          border: 1px solid var(--border-accent);
          background: var(--primary-muted);
          color: var(--primary);
          font-family: var(--font-body); font-size: 0.54rem;
          letter-spacing: 0.14em; text-transform: uppercase; font-weight: 500;
          padding: 0.5rem 0.4rem;
          border-radius: var(--r-full);
          cursor: pointer; white-space: nowrap;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .rnt-add:hover, .rnt-add.flash {
          background: var(--primary);
          border-color: var(--primary);
          color: var(--primary-text);
        }
        .rnt-add:disabled {
          background: var(--bg-subtle);
          border-color: var(--border);
          color: var(--text-dim);
          cursor: not-allowed;
        }

        /* ── empty state ── */
        .rnt-empty {
          background: var(--surface);
          border: 1px dashed var(--border-strong);
          border-radius: var(--r-xl);
          padding: 3.5rem 2rem;
          text-align: center;
        }

        /* ── floating estimate bar ── */
        @keyframes estIn {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to   { transform: translate(-50%, 0); opacity: 1; }
        }
        .rnt-estimate {
          position: fixed; bottom: 1.5rem; left: 50%;
          transform: translateX(-50%);
          z-index: 80;
          display: flex; align-items: center; gap: 1rem;
          background: var(--surface);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          padding: 0.6rem 0.7rem 0.6rem 1.4rem;
          box-shadow: var(--shadow-lg);
          animation: estIn 0.3s ease both;
          max-width: calc(100vw - 8rem);
        }
        .rnt-estimate-clear {
          border: none; background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.58rem;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--text-dim);
          transition: color 0.2s; white-space: nowrap;
        }
        .rnt-estimate-clear:hover { color: var(--danger); }
        .rnt-estimate-cta {
          background: var(--primary); color: var(--primary-text);
          font-family: var(--font-body); font-size: 0.6rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          border-radius: var(--r-full);
          padding: 0.65rem 1.25rem;
          text-decoration: none; white-space: nowrap;
          transition: background 0.2s;
        }
        .rnt-estimate-cta:hover { background: var(--primary-hover); }

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

      <Navbar activePage="rentals" />

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
                Equipment for Hire
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
              Everything but the{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Venue</em>
            </h1>

            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '1rem',
                color: 'var(--text-muted)', lineHeight: 1.75,
                maxWidth: 540, margin: '0 auto', fontWeight: 300,
              }}
            >
              Tables, chairs, linens, sound, and styling — rented per day,
              delivered, set up, and picked up by our own crew.
            </p>
          </div>
        </section>

        {/* ═══════════════════════ RENTALS GRID ═══════════════════════ */}
        <section style={{ background: 'var(--bg-subtle)', padding: '3.5rem 0 6rem' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem' }}>

            {/* ── filters + rental duration ── */}
            <div className="rnt-filters">
              <div className="rnt-chips" role="tablist" aria-label="Rental categories">
                <button
                  type="button"
                  className={`rnt-chip${category === 'all' ? ' active' : ''}`}
                  onClick={() => setCategory('all')}
                >
                  All<span className="count">{countFor('all')}</span>
                </button>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`rnt-chip${category === c.id ? ' active' : ''}`}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.label}
                    <span className="count">{countFor(c.id)}</span>
                  </button>
                ))}
              </div>

              <div className="rnt-days">
                <span className="label">Rental duration</span>
                <button type="button" aria-label="Fewer days" onClick={() => setDays((d) => Math.max(1, d - 1))}>
                  −
                </button>
                <span className="value" aria-live="polite">
                  {days} {days === 1 ? 'day' : 'days'}
                </span>
                <button type="button" aria-label="More days" onClick={() => setDays((d) => Math.min(MAX_DAYS, d + 1))}>
                  +
                </button>
              </div>
            </div>

            {/* ── grid ── */}
            {visible.length === 0 ? (
              <div className="rnt-empty fade-up">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  Nothing in this category yet
                </p>
                <button type="button" className="btn-outline" onClick={() => setCategory('all')}>
                  View All Items
                </button>
              </div>
            ) : (
              <div className="rnt-grid">
                {visible.map((item, i) => {
                  const soldOut = item.stock <= 0;
                  const lowStock = !soldOut && item.stock < LOW_STOCK_AT;
                  const meta = CATEGORY_META.get(item.category);
                  return (
                    <article
                      key={item.id}
                      className={`rnt-card fade-up${soldOut ? ' sold-out' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}
                    >
                      <div className="rnt-tile">
                        <span className="icon" aria-hidden="true">{meta?.icon}</span>
                        <span className={`rnt-stock${soldOut ? ' none' : lowStock ? ' low' : ''}`}>
                          {soldOut ? 'Out of stock' : lowStock ? `Only ${item.stock} left` : `${item.stock} in stock`}
                        </span>
                      </div>

                      <div className="rnt-body">
                        <span className="rnt-cat">{meta?.label}</span>
                        <h3 className="rnt-name">{item.name}</h3>
                        <p className="rnt-desc">{item.description}</p>
                        <p className="rnt-price">
                          {fmtPHP(item.pricePerDay)} <small>/ day</small>
                        </p>

                        <div className="rnt-foot">
                          {soldOut ? (
                            <button type="button" className="rnt-add" disabled>
                              Out of Stock
                            </button>
                          ) : (
                            <>
                              <div className="rnt-qty" onClick={(e) => e.stopPropagation()}>
                                <button type="button" aria-label={`Decrease quantity for ${item.name}`} onClick={() => bumpQty(item, -1)}>
                                  −
                                </button>
                                <span aria-live="polite">{qtyOf(item.id)}</span>
                                <button type="button" aria-label={`Increase quantity for ${item.name}`} onClick={() => bumpQty(item, 1)}>
                                  +
                                </button>
                              </div>
                              <button
                                type="button"
                                className={`rnt-add${flashId === item.id ? ' flash' : ''}`}
                                onClick={() => addToPlan(item)}
                              >
                                {flashId === item.id ? 'Added ✓' : '+ Add'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════ COMPLETE SETUP CTA ═══════════════════════ */}
        <section style={{ ...sectionPad, background: 'var(--bg)', paddingTop: '5rem', paddingBottom: '5rem' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '1rem' }}>
              Need a complete setup?
            </p>
            <h3
              style={{
                fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem, 3vw, 2.5rem)',
                fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: '0.85rem',
              }}
            >
              Let us handle the{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>entire event</em>
            </h3>
            <p
              style={{
                fontFamily: 'var(--font-body)', fontSize: '0.92rem',
                color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300,
                maxWidth: 540, margin: '0 auto 2rem',
              }}
            >
              Skip picking individual items — bundle rentals with catering and
              service staff, and we'll deliver, set up, and break down everything.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/packages" className="btn-primary">View Packages</a>
              <a href="/menus" className="btn-outline">Browse the Menu</a>
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

      {/* ═══════════════════════ FLOATING ESTIMATE BAR ═══════════════════════ */}
      {planPieces > 0 && (
        <div className="rnt-estimate" role="status" aria-label="Rental estimate summary">
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{planPieces}</strong>
            {' '}item{planPieces === 1 ? '' : 's'} ·{' '}
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
              {fmtPHP(planPerDay * days)}
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.62rem' }}>
              {' '}for {days} {days === 1 ? 'day' : 'days'}
            </span>
          </p>
          <button type="button" className="rnt-estimate-clear" onClick={() => setPlan({})}>
            Clear
          </button>
          <a href="/#availability" className="rnt-estimate-cta">
            Request Quote →
          </a>
        </div>
      )}

      <ChatWidget />
    </>
  );
}
