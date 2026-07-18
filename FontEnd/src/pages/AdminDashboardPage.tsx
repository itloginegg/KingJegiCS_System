import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

const ADMIN = { name: 'Chris Paul', role: 'Administrator' };

type ResStatus = 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';

type Reservation = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  eventType: string;
  eventDate: string;
  eventTime: string;
  guests: number;
  pkg?: string;
  notes?: string;
  status: ResStatus;
};

const INITIAL_RESERVATIONS: Reservation[] = [
  { id: 'RSV-1041', fullName: 'Santos Family', email: 'santos@example.com', phone: '0917 555 0141', eventType: 'Wedding', eventDate: '2026-08-08', eventTime: '17:00', guests: 150, pkg: 'Wedding Package', notes: 'Sage green & gold motif. Church ceremony ends 4 PM.', status: 'Pending' },
  { id: 'RSV-1038', fullName: 'Reyes Family', email: 'reyes@example.com', phone: '0917 555 0223', eventType: 'Debut', eventDate: '2026-08-08', eventTime: '18:30', guests: 100, pkg: 'Custom Package', status: 'Pending' },
  { id: 'RSV-1035', fullName: 'Cruz Corporation', email: 'events@cruzcorp.ph', phone: '0918 555 0987', eventType: 'Corporate Dinner', eventDate: '2026-07-28', eventTime: '19:00', guests: 80, pkg: 'Custom Package', notes: 'Projector and two wireless mics required.', status: 'Confirmed' },
  { id: 'RSV-1029', fullName: 'Bautista Family', email: 'bautista@example.com', phone: '0919 555 0456', eventType: 'Wedding', eventDate: '2026-09-12', eventTime: '16:00', guests: 180, pkg: 'Wedding Package', status: 'Confirmed' },
  { id: 'RSV-1022', fullName: 'Dela Cruz', email: 'delacruz@example.com', phone: '0916 555 0678', eventType: 'Birthday', eventDate: '2026-07-20', eventTime: '14:00', guests: 60, pkg: 'Birthday Package', status: 'Cancelled' },
  { id: 'RSV-1010', fullName: 'Mendoza Family', email: 'mendoza@example.com', phone: '0915 555 0332', eventType: 'Family Reunion', eventDate: '2026-06-14', eventTime: '12:00', guests: 45, status: 'Completed' },
];

type OrderStatus = 'pending_dp' | 'dp_paid' | 'fully_paid' | 'cancelled';

type Order = {
  id: string;
  customerName: string;
  email: string;
  eventType: string;
  eventDate: string;
  createdAt: string;
  status: OrderStatus;
  overdue?: boolean;
  note?: string;
  items: { id: number; name: string; qty: number; price: number }[];
};

const INITIAL_ORDERS: Order[] = [
  {
    id: 'ORD-3301', customerName: 'Santos Family', email: 'santos@example.com', eventType: 'Wedding', eventDate: '2026-09-12', createdAt: '2026-07-02', status: 'pending_dp', overdue: true,
    items: [
      { id: 1, name: 'Wedding Package', qty: 1, price: 80000 },
      { id: 2, name: 'Lechon de Leche (per head)', qty: 150, price: 350 },
      { id: 3, name: 'Sound System Package', qty: 1, price: 1800 },
    ],
  },
  {
    id: 'ORD-3287', customerName: 'Garcia Inc', email: 'admin@garcia.ph', eventType: 'Annual Gala', eventDate: '2026-07-28', createdAt: '2026-07-08', status: 'dp_paid', note: 'Waiting for final headcount before balance invoice.',
    items: [
      { id: 1, name: 'Custom Package', qty: 1, price: 90000 },
      { id: 2, name: 'Party Lights Set', qty: 2, price: 400 },
      { id: 3, name: 'Projector & Screen', qty: 1, price: 900 },
    ],
  },
  {
    id: 'ORD-3255', customerName: 'Lim Family', email: 'lim@example.com', eventType: 'Birthday', eventDate: '2026-06-20', createdAt: '2026-05-30', status: 'fully_paid',
    items: [
      { id: 1, name: 'Birthday Package', qty: 1, price: 65000 },
      { id: 2, name: 'Fairy Light Strand (10m)', qty: 4, price: 60 },
    ],
  },
  {
    id: 'ORD-3210', customerName: 'Mendoza Family', email: 'mendoza@example.com', eventType: 'Family Reunion', eventDate: '2026-06-14', createdAt: '2026-05-28', status: 'fully_paid',
    items: [
      { id: 1, name: 'Handaan Tray Set', qty: 2, price: 3999 },
      { id: 2, name: 'Tiffany Chairs', qty: 100, price: 35 },
    ],
  },
  {
    id: 'ORD-3198', customerName: 'Tan Family', email: 'tan@example.com', eventType: 'Debut', eventDate: '2026-05-30', createdAt: '2026-04-20', status: 'cancelled', note: 'Client moved abroad.',
    items: [{ id: 1, name: 'Custom Package', qty: 1, price: 82000 }],
  },
];

type Pkg = { id: number; name: string; price: string; unit: string; description: string; highlight: boolean; active: boolean };

const INITIAL_PACKAGES: Pkg[] = [
  { id: 1, name: 'Birthday Package', price: '₱65,000', unit: 'up to 100 pax', description: 'Themed styling, buffet, sound, and crew.', highlight: false, active: true },
  { id: 2, name: 'Wedding Package', price: '₱80,000', unit: 'up to 150 pax', description: 'Signature floral styling and full coordination.', highlight: true, active: true },
  { id: 3, name: 'Custom Package', price: 'Custom', unit: 'tailored quote', description: 'Built from scratch around the client brief.', highlight: false, active: true },
  { id: 4, name: 'Starter Package', price: '₱38,000', unit: 'up to 50 pax', description: 'Compact setup for intimate gatherings.', highlight: false, active: false },
];

type TestiStatus = 'pending' | 'approved' | 'rejected';

type Testimonial = { id: number; name: string; rating: number; body: string; submittedAt: string; status: TestiStatus };

const INITIAL_TESTIMONIALS: Testimonial[] = [
  { id: 1, name: 'Maria Santos', rating: 5, body: 'King Jegi made our wedding feast unforgettable. Guests are still talking about the lechon months later!', submittedAt: '2026-07-10', status: 'pending' },
  { id: 2, name: 'Jerome dela Cruz', rating: 5, body: 'Professional from quotation to cleanup. The buffet setup looked stunning and everything was served on time.', submittedAt: '2026-07-05', status: 'approved' },
  { id: 3, name: 'Ana Reyes', rating: 4, body: "Farm-fresh talaga ang lasa! The team handled everything so I could actually enjoy my daughter's party.", submittedAt: '2026-06-28', status: 'approved' },
  { id: 4, name: 'Marco Lim', rating: 3, body: 'Food was great but the crew arrived a little later than promised. Still recommended overall.', submittedAt: '2026-06-20', status: 'rejected' },
];

const REVENUE_BY_MONTH = [
  { month: 'Feb', value: 42000 },
  { month: 'Mar', value: 68000 },
  { month: 'Apr', value: 55000 },
  { month: 'May', value: 91000 },
  { month: 'Jun', value: 76898 },
  { month: 'Jul', value: 63000 },
];

/* ─────────────────────────────────────────────────────────────────────────
   Status maps & helpers
───────────────────────────────────────────────────────────────────────── */

const RES_STATUS: Record<ResStatus, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--accent)' },
  Confirmed: { label: 'Confirmed', color: 'var(--primary)' },
  Completed: { label: 'Completed', color: '#4a90d9' },
  Cancelled: { label: 'Cancelled', color: 'var(--danger)' },
};

const ORDER_STATUS: Record<OrderStatus, { label: string; color: string }> = {
  pending_dp: { label: 'Pending DP', color: 'var(--accent)' },
  dp_paid: { label: '50% DP Paid', color: '#4a90d9' },
  fully_paid: { label: 'Fully Paid', color: 'var(--primary)' },
  cancelled: { label: 'Cancelled', color: 'var(--danger)' },
};

const TESTI_STATUS: Record<TestiStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--accent)' },
  approved: { label: 'Approved', color: 'var(--primary)' },
  rejected: { label: 'Rejected', color: 'var(--danger)' },
};

const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`;
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

const orderTotal = (o: Order) => o.items.reduce((s, i) => s + i.price * i.qty, 0);

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)', fontSize: '0.55rem',
        letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500,
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        padding: '0.28rem 0.68rem', borderRadius: 'var(--r-full)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function FieldLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)', fontSize: '0.52rem',
        letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500,
        color: 'var(--text-dim)', display: 'block', marginBottom: '0.4rem',
      }}
    >
      {text}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

type Tab = 'overview' | 'bookings' | 'payments' | 'packages' | 'testimonials' | 'placeholder';

const PLACEHOLDER_ITEMS = ['Menus & Dishes', 'Rentals', 'Announcements', 'Chat Support', 'Audit Log'];

export function AdminDashboardPage() {
  const { theme, toggleTheme } = useTheme();

  const [tab, setTab] = useState<Tab>('overview');
  const [placeholderName, setPlaceholderName] = useState(PLACEHOLDER_ITEMS[0]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [reservations, setReservations] = useState(INITIAL_RESERVATIONS);
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [packages, setPackages] = useState(INITIAL_PACKAGES);
  const [testimonials, setTestimonials] = useState(INITIAL_TESTIMONIALS);

  /* bookings tab state */
  const [resFilter, setResFilter] = useState<'all' | ResStatus>('all');
  const [resSearch, setResSearch] = useState('');
  const [cancelResId, setCancelResId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  /* payments tab state */
  const [orderFilter, setOrderFilter] = useState<'all' | OrderStatus>('all');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [noteOrderId, setNoteOrderId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  /* packages tab state */
  const [editPkgId, setEditPkgId] = useState<number | null>(null);
  const [editPkg, setEditPkg] = useState<Partial<Pkg>>({});

  /* testimonials tab state */
  const [testiFilter, setTestiFilter] = useState<'all' | TestiStatus>('pending');

  /* calendar state */
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  /* ── derived metrics ── */
  const totalRevenue = orders.filter((o) => o.status === 'fully_paid').reduce((s, o) => s + orderTotal(o), 0);
  const pendingPayOrders = orders.filter((o) => o.status === 'pending_dp' || o.status === 'dp_paid');
  const pendingPayTotal = pendingPayOrders.reduce((s, o) => {
    const total = orderTotal(o);
    return s + (o.status === 'dp_paid' ? total * 0.5 : total);
  }, 0);
  const pendingRes = reservations.filter((r) => r.status === 'Pending');
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const upcomingCount = reservations.filter((r) => {
    if (r.status !== 'Pending' && r.status !== 'Confirmed') return false;
    const d = new Date(r.eventDate);
    return d >= now && d <= in30;
  }).length;
  const pendingTesti = testimonials.filter((t) => t.status === 'pending').length;

  /* dates with ≥2 active reservations flag as conflicts */
  const conflictDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reservations) {
      if (r.status === 'Pending' || r.status === 'Confirmed') {
        counts.set(r.eventDate, (counts.get(r.eventDate) ?? 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, c]) => c >= 2).map(([d]) => d));
  }, [reservations]);

  const filteredRes = useMemo(() => {
    const q = resSearch.trim().toLowerCase();
    return reservations
      .filter((r) => resFilter === 'all' || r.status === resFilter)
      .filter(
        (r) =>
          q === '' ||
          r.fullName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.eventType.toLowerCase().includes(q),
      )
      .sort((a, b) => +new Date(a.eventDate) - +new Date(b.eventDate));
  }, [reservations, resFilter, resSearch]);

  const filteredOrders = orders.filter((o) => orderFilter === 'all' || o.status === orderFilter);

  const filteredTesti = testimonials.filter((t) => testiFilter === 'all' || t.status === testiFilter);

  /* ── local mutations ── */
  const setResStatus = (id: string, status: ResStatus) =>
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));

  const cancelReservation = (id: string) => {
    setResStatus(id, 'Cancelled');
    setCancelResId(null);
    setCancelReason('');
  };

  const advanceOrder = (o: Order) => {
    const next: Partial<Record<OrderStatus, OrderStatus>> = { pending_dp: 'dp_paid', dp_paid: 'fully_paid' };
    const to = next[o.status];
    if (!to) return;
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: to, overdue: false } : x)));
  };

  const cancelOrder = (id: string) =>
    setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'cancelled' as const } : x)));

  const saveNote = (id: string) => {
    setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, note: noteText.trim() || undefined } : x)));
    setNoteOrderId(null);
    setNoteText('');
  };

  const togglePkg = (id: number) =>
    setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));

  const savePkg = (id: number) => {
    setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, ...editPkg } : p)));
    setEditPkgId(null);
  };

  const setTestiStatus = (id: number, status: TestiStatus) =>
    setTestimonials((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));

  const openTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };

  /* calendar cells */
  const calYear = calMonth.getFullYear();
  const calMo = calMonth.getMonth();
  const daysInMonth = new Date(calYear, calMo + 1, 0).getDate();
  const startDay = new Date(calYear, calMo, 1).getDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const calCells: (number | null)[] = [
    ...Array.from({ length: startDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const maxRevenue = Math.max(...REVENUE_BY_MONTH.map((m) => m.value));

  const NAV: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: '▦' },
    { id: 'bookings', label: 'Bookings', icon: '🗓', badge: pendingRes.length },
    { id: 'payments', label: 'Payments', icon: '₱', badge: pendingPayOrders.length },
    { id: 'packages', label: 'Packages', icon: '📦' },
    { id: 'testimonials', label: 'Testimonials', icon: '★', badge: pendingTesti },
  ];

  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.45s ease both; }

        .adm-shell { min-height: 100vh; background: var(--bg-subtle); transition: background 0.4s; }
        .adm-main { margin-left: 250px; min-height: 100vh; display: flex; flex-direction: column; }

        /* ── sidebar ── */
        .adm-sidebar {
          position: fixed; top: 0; left: 0; z-index: 60;
          width: 250px; height: 100vh;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex; flex-direction: column;
          transition: transform 0.3s ease;
        }
        .adm-brand {
          padding: 1.5rem 1.4rem 1.2rem;
          border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 0.65rem;
        }
        .adm-brand-mark {
          width: 34px; height: 34px; flex-shrink: 0;
          border-radius: var(--r-lg);
          background: var(--accent-muted);
          border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 1.05rem; font-weight: 600;
          color: var(--accent);
        }
        .adm-nav { flex: 1; padding: 1rem 0.8rem; display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; }
        .adm-nav-caption {
          padding: 0.4rem 0.9rem 0.3rem;
          font-family: var(--font-body); font-size: 0.5rem;
          letter-spacing: 0.3em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-nav-item {
          display: flex; align-items: center; gap: 0.7rem;
          width: 100%; text-align: left;
          padding: 0.66rem 0.9rem;
          border: 1px solid transparent; border-radius: var(--r-lg);
          background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.68rem;
          letter-spacing: 0.1em; text-transform: uppercase; font-weight: 500;
          color: var(--text-muted); text-decoration: none;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-nav-item:hover:not(.active) { background: var(--bg-subtle); color: var(--text-primary); }
        .adm-nav-item.active {
          background: var(--primary-muted);
          border-color: var(--border-accent);
          color: var(--primary);
        }
        .adm-nav-icon {
          width: 27px; height: 27px; flex-shrink: 0;
          border-radius: var(--r-sm);
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.78rem;
        }
        .adm-nav-item.active .adm-nav-icon { background: var(--primary-muted); border-color: var(--border-accent); }
        .adm-badge {
          margin-left: auto;
          background: var(--accent-muted); color: var(--accent);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          font-size: 0.54rem; font-weight: 600; letter-spacing: 0.04em;
          padding: 0.08rem 0.45rem; min-width: 18px; text-align: center;
        }
        .adm-sidebar-foot { padding: 0.9rem 0.8rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.45rem; }
        .adm-foot-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          padding: 0.58rem;
          border: 1px solid var(--border); border-radius: var(--r-full);
          background: transparent; cursor: pointer;
          font-family: var(--font-body); font-size: 0.58rem;
          letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500;
          color: var(--text-muted); text-decoration: none;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-foot-btn:hover { color: var(--primary); border-color: var(--border-accent); background: var(--primary-muted); }
        .adm-foot-btn.danger:hover { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: var(--danger-muted); }

        .adm-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(20, 14, 8, 0.45); display: none; }

        /* ── topbar ── */
        .adm-topbar {
          position: sticky; top: 0; z-index: 40;
          display: flex; align-items: center; gap: 0.9rem;
          padding: 0.85rem 2rem;
          background: color-mix(in srgb, var(--bg-subtle) 84%, transparent);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .adm-iconbtn {
          width: 34px; height: 34px; flex-shrink: 0;
          border-radius: var(--r-full);
          border: 1px solid var(--border);
          background: var(--surface); color: var(--text-secondary);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: color 0.2s, border-color 0.2s;
        }
        .adm-iconbtn:hover { color: var(--primary); border-color: var(--border-accent); }
        .adm-burger { display: none; }
        .adm-avatar {
          width: 32px; height: 32px; flex-shrink: 0;
          border-radius: 50%;
          background: var(--accent-muted);
          border: 1px solid var(--border-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 0.8rem; font-weight: 600;
          color: var(--accent);
        }

        /* ── cards & shared pieces ── */
        .adm-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .adm-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-md); }

        .adm-title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 500; color: var(--text-primary); }

        .adm-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.1rem; }
        @media (max-width: 1200px) { .adm-metrics { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 620px)  { .adm-metrics { grid-template-columns: 1fr; } }
        .adm-metric { padding: 1.25rem 1.4rem; }
        .adm-metric .head { display: flex; align-items: center; gap: 0.55rem; margin-bottom: 0.8rem; }
        .adm-metric .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .adm-metric .lbl {
          font-family: var(--font-body); font-size: 0.55rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-metric .num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 600; line-height: 1; color: var(--text-primary); }
        .adm-metric .sub { font-family: var(--font-body); font-size: 0.66rem; font-weight: 300; color: var(--text-muted); margin-top: 0.35rem; }

        /* pills */
        .adm-pill {
          font-family: var(--font-body); font-size: 0.6rem;
          letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500;
          padding: 0.45rem 0.95rem; border-radius: var(--r-full);
          background: var(--surface); color: var(--text-muted);
          border: 1px solid var(--border);
          cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; gap: 0.45rem;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .adm-pill:hover { border-color: var(--border-accent); color: var(--text-primary); }
        .adm-pill.active { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
        .adm-pill .count {
          font-size: 0.54rem; letter-spacing: 0.04em;
          background: var(--bg-subtle); color: var(--text-dim);
          border-radius: var(--r-full); padding: 0.05rem 0.42rem; min-width: 17px; text-align: center;
        }
        .adm-pill.active .count { background: rgba(255,255,255,0.22); color: var(--primary-text); }

        /* buttons */
        .adm-btn {
          font-family: var(--font-body); font-size: 0.6rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          padding: 0.55rem 1.05rem; border-radius: var(--r-full);
          border: 1px solid transparent; cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; gap: 0.4rem;
          transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s;
        }
        .adm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .adm-btn.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
        .adm-btn.primary:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
        .adm-btn.success { background: var(--primary-muted); color: var(--primary); border-color: var(--border-accent); }
        .adm-btn.success:hover:not(:disabled) { background: var(--primary); color: var(--primary-text); }
        .adm-btn.outline { background: transparent; color: var(--text-muted); border-color: var(--border); }
        .adm-btn.outline:hover:not(:disabled) { color: var(--primary); border-color: var(--border-accent); background: var(--primary-muted); }
        .adm-btn.danger { background: var(--danger-muted); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
        .adm-btn.danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
        .adm-btn.info { background: color-mix(in srgb, #4a90d9 12%, transparent); color: #4a90d9; border-color: color-mix(in srgb, #4a90d9 30%, transparent); }
        .adm-btn.info:hover:not(:disabled) { background: #4a90d9; color: #fff; }

        /* inputs */
        .adm-input {
          background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--r-full);
          padding: 0.6rem 1.05rem;
          font-family: var(--font-body); font-size: 0.8rem; font-weight: 300;
          color: var(--text-primary); outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .adm-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
        .adm-input.square { border-radius: var(--r-lg); background: var(--bg-subtle); width: 100%; }
        select.adm-input { cursor: pointer; font-weight: 400; }

        /* chart */
        .adm-chart { display: flex; align-items: flex-end; gap: 0.9rem; height: 160px; padding-top: 0.5rem; }
        .adm-chart .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.45rem; height: 100%; justify-content: flex-end; }
        .adm-chart .bar {
          width: 100%; max-width: 46px;
          border-radius: var(--r-sm) var(--r-sm) 0 0;
          background: linear-gradient(180deg, var(--primary), color-mix(in srgb, var(--primary) 55%, transparent));
          transition: height 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .adm-chart .val { font-family: var(--font-body); font-size: 0.56rem; font-weight: 500; color: var(--text-muted); }
        .adm-chart .mon { font-family: var(--font-body); font-size: 0.56rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-dim); }

        /* calendar */
        .adm-cal-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.9rem 1.2rem;
          border-bottom: 1px solid var(--border);
          background: var(--bg-subtle);
          border-radius: var(--r-xl) var(--r-xl) 0 0;
        }
        .adm-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; padding: 0.5rem; }
        .adm-cal-dow {
          text-align: center; padding: 0.45rem 0;
          font-family: var(--font-body); font-size: 0.52rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .adm-cal-cell { min-height: 62px; padding: 0.35rem 0.4rem; border-radius: var(--r-sm); }
        .adm-cal-cell .d { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); margin-bottom: 0.2rem; }
        .adm-cal-ev {
          display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-family: var(--font-body); font-size: 0.5rem; font-weight: 500;
          padding: 0.08rem 0.3rem; border-radius: 3px; margin-bottom: 1px;
        }

        /* rows */
        .adm-row { border-bottom: 1px solid var(--border); }
        .adm-row:last-child { border-bottom: none; }

        /* responsive */
        @media (max-width: 900px) {
          .adm-main { margin-left: 0; }
          .adm-sidebar { transform: translateX(-100%); }
          .adm-sidebar.open { transform: translateX(0); box-shadow: var(--shadow-lg); }
          .adm-scrim.open { display: block; }
          .adm-burger { display: flex; }
          .adm-topbar { padding: 0.8rem 1.25rem; }
          .adm-content { padding: 1.5rem 1.25rem 4rem !important; }
          .adm-overview-cols { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="adm-shell">

        {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
        <div className={`adm-scrim${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
        <aside className={`adm-sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="adm-brand">
            <div className="adm-brand-mark">K</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                King Jegi
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
                Admin Panel
              </div>
            </div>
          </div>

          <nav className="adm-nav" aria-label="Admin navigation">
            <span className="adm-nav-caption">Operations</span>
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`adm-nav-item${tab === item.id ? ' active' : ''}`}
                onClick={() => openTab(item.id)}
              >
                <span className="adm-nav-icon">{item.icon}</span>
                {item.label}
                {item.badge != null && item.badge > 0 && <span className="adm-badge">{item.badge}</span>}
              </button>
            ))}

            <span className="adm-nav-caption" style={{ marginTop: '0.9rem' }}>Management</span>
            {PLACEHOLDER_ITEMS.map((name) => (
              <button
                key={name}
                type="button"
                className={`adm-nav-item${tab === 'placeholder' && placeholderName === name ? ' active' : ''}`}
                onClick={() => { setPlaceholderName(name); openTab('placeholder'); }}
              >
                <span className="adm-nav-icon">◌</span>
                {name}
              </button>
            ))}
          </nav>

          <div className="adm-sidebar-foot">
            <button type="button" className="adm-foot-btn" onClick={toggleTheme}>
              {theme === 'dark' ? '☀ Light Mode' : '☾ Dark Mode'}
            </button>
            <Link to="/login" className="adm-foot-btn danger">⎋ Logout</Link>
          </div>
        </aside>

        {/* ═══════════════════════ MAIN ═══════════════════════ */}
        <div className="adm-main">

          {/* topbar */}
          <div className="adm-topbar">
            <button type="button" className="adm-iconbtn adm-burger" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--text-dim)' }}>
              {tab === 'placeholder' ? placeholderName : NAV.find((n) => n.id === tab)?.label}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }} className="adm-hide-sm">
              {ADMIN.name} · {ADMIN.role}
            </span>
            <div className="adm-avatar" title={ADMIN.name}>{ADMIN.name.charAt(0)}</div>
          </div>

          {/* content */}
          <div className="adm-content" style={{ padding: '2rem 2.25rem 4rem', flex: 1, maxWidth: 1240, width: '100%', margin: '0 auto' }}>

            {/* ══════════ OVERVIEW ══════════ */}
            {tab === 'overview' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
                <div>
                  <h1 className="adm-title" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.1rem)' }}>
                    Good day,{' '}
                    <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{ADMIN.name.split(' ')[0]}</em>
                  </h1>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    Here's the business at a glance.
                  </p>
                </div>

                {/* metrics */}
                <div className="adm-metrics">
                  {[
                    { label: 'Total Revenue', value: fmt(totalRevenue), sub: 'from fully paid orders', color: 'var(--primary)' },
                    { label: 'Pending Payments', value: String(pendingPayOrders.length), sub: `${fmt(pendingPayTotal)} outstanding`, color: 'var(--accent)' },
                    { label: 'Upcoming Events', value: String(upcomingCount), sub: 'within the next 30 days', color: '#4a90d9' },
                    { label: 'Pending Reservations', value: String(pendingRes.length), sub: 'awaiting your review', color: 'var(--accent)' },
                  ].map((m) => (
                    <div key={m.label} className="adm-card adm-metric">
                      <div className="head">
                        <span className="dot" style={{ background: m.color }} />
                        <span className="lbl">{m.label}</span>
                      </div>
                      <div className="num" style={{ color: m.color === 'var(--primary)' ? 'var(--primary)' : 'var(--text-primary)' }}>{m.value}</div>
                      <div className="sub">{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* chart + calendar */}
                <div className="adm-overview-cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 5fr) minmax(340px, 7fr)', gap: '1.4rem', alignItems: 'start' }}>

                  {/* revenue chart */}
                  <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                    <FieldLabel text="Last 6 Months" />
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 1.1rem' }}>
                      Revenue Trend
                    </h3>
                    <div className="adm-chart">
                      {REVENUE_BY_MONTH.map((m) => (
                        <div key={m.month} className="col">
                          <span className="val">₱{Math.round(m.value / 1000)}k</span>
                          <div className="bar" style={{ height: `${Math.round((m.value / maxRevenue) * 100)}%` }} />
                          <span className="mon">{m.month}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* event calendar */}
                  <div className="adm-card" style={{ overflow: 'hidden' }}>
                    <div className="adm-cal-head">
                      <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Previous month" onClick={() => setCalMonth(new Date(calYear, calMo - 1, 1))}>
                        ‹
                      </button>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {calMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                      </span>
                      <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Next month" onClick={() => setCalMonth(new Date(calYear, calMo + 1, 1))}>
                        ›
                      </button>
                    </div>
                    <div className="adm-cal-grid" style={{ paddingBottom: 0 }}>
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="adm-cal-dow">{d}</div>)}
                    </div>
                    <div className="adm-cal-grid" style={{ paddingTop: 0 }}>
                      {calCells.map((day, i) => {
                        if (day === null) return <div key={`e${i}`} />;
                        const dateStr = `${calYear}-${pad(calMo + 1)}-${pad(day)}`;
                        const dayEvents = reservations.filter(
                          (r) => r.eventDate === dateStr && (r.status === 'Pending' || r.status === 'Confirmed'),
                        );
                        const conflict = conflictDates.has(dateStr);
                        const isToday = dateStr === todayISO;
                        return (
                          <div
                            key={dateStr}
                            className="adm-cal-cell"
                            style={{
                              background: conflict ? 'var(--accent-muted)' : isToday ? 'var(--primary-muted)' : 'transparent',
                              outline: isToday ? '1px solid var(--primary)' : 'none',
                            }}
                          >
                            <div className="d" style={{ color: isToday ? 'var(--primary)' : undefined }}>{day}</div>
                            {dayEvents.slice(0, 2).map((ev) => {
                              const c = RES_STATUS[ev.status].color;
                              return (
                                <span key={ev.id} className="adm-cal-ev" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
                                  {ev.fullName}
                                </span>
                              );
                            })}
                            {conflict && (
                              <span className="adm-cal-ev" style={{ color: 'var(--accent)', fontWeight: 600 }}>⚠ conflict</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* pending queue */}
                <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                    <div>
                      <FieldLabel text="Needs Attention" />
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                        Pending Reservations
                      </h3>
                    </div>
                    <button type="button" className="adm-btn outline" onClick={() => openTab('bookings')}>Review All →</button>
                  </div>
                  {pendingRes.length === 0 ? (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1rem 0' }}>
                      All caught up — nothing pending.
                    </p>
                  ) : (
                    pendingRes.map((r) => (
                      <div key={r.id} className="adm-row" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem 0', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>{r.fullName}</div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                            {r.eventType} · {fmtDate(r.eventDate)} · {r.guests} guests
                          </div>
                        </div>
                        {conflictDates.has(r.eventDate) && <StatusBadge label="⚠ Date conflict" color="var(--accent)" />}
                        <button type="button" className="adm-btn success" onClick={() => setResStatus(r.id, 'Confirmed')}>Confirm</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ══════════ BOOKINGS ══════════ */}
            {tab === 'bookings' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <h2 className="adm-title">Bookings</h2>
                  <input
                    className="adm-input"
                    type="search"
                    placeholder="Search name, email, or event…"
                    value={resSearch}
                    onChange={(e) => setResSearch(e.target.value)}
                    style={{ flex: '0 1 300px' }}
                    aria-label="Search bookings"
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['all', 'Pending', 'Confirmed', 'Completed', 'Cancelled'] as const).map((k) => {
                    const count = k === 'all' ? reservations.length : reservations.filter((r) => r.status === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${resFilter === k ? ' active' : ''}`} onClick={() => setResFilter(k)}>
                        {k === 'all' ? 'All' : k}
                        <span className="count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {filteredRes.length === 0 ? (
                  <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    No bookings match the current view.
                  </div>
                ) : (
                  filteredRes.map((r) => {
                    const st = RES_STATUS[r.status];
                    const cancelling = cancelResId === r.id;
                    return (
                      <div key={r.id} className="adm-card" style={{ padding: '1.35rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 240 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                              {r.fullName}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.3rem 1.4rem', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                              <span>Event: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.eventType}</strong></span>
                              <span>Date: <strong style={{ color: 'var(--primary)', fontWeight: 500 }}>{fmtDate(r.eventDate)} · {r.eventTime}</strong></span>
                              <span>Guests: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.guests}</strong></span>
                              <span>Email: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.email}</strong></span>
                              <span>Phone: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.phone}</strong></span>
                              {r.pkg && <span>Package: <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.pkg}</strong></span>}
                            </div>
                            {r.notes && (
                              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.65rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', padding: '0.5rem 0.8rem', borderLeft: '2px solid var(--border-accent)' }}>
                                {r.notes}
                              </p>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.45rem' }}>
                            {conflictDates.has(r.eventDate) && (r.status === 'Pending' || r.status === 'Confirmed') && (
                              <StatusBadge label="⚠ Date conflict" color="var(--accent)" />
                            )}
                            <StatusBadge label={st.label} color={st.color} />
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                          {r.status === 'Pending' && (
                            <button type="button" className="adm-btn success" onClick={() => setResStatus(r.id, 'Confirmed')}>Confirm</button>
                          )}
                          {r.status === 'Confirmed' && (
                            <button type="button" className="adm-btn info" onClick={() => setResStatus(r.id, 'Completed')}>Mark Completed</button>
                          )}
                          {(r.status === 'Pending' || r.status === 'Confirmed') && !cancelling && (
                            <button type="button" className="adm-btn danger" onClick={() => { setCancelResId(r.id); setCancelReason(''); }}>Cancel</button>
                          )}
                        </div>

                        {cancelling && (
                          <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <FieldLabel text="Reason for cancellation" />
                              <input className="adm-input square" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Required" />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button type="button" className="adm-btn danger" disabled={!cancelReason.trim()} onClick={() => cancelReservation(r.id)}>
                                Confirm Cancel
                              </button>
                              <button type="button" className="adm-btn outline" onClick={() => setCancelResId(null)}>Back</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ══════════ PAYMENTS ══════════ */}
            {tab === 'payments' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <h2 className="adm-title">Payments</h2>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['all', 'pending_dp', 'dp_paid', 'fully_paid', 'cancelled'] as const).map((k) => {
                    const count = k === 'all' ? orders.length : orders.filter((o) => o.status === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${orderFilter === k ? ' active' : ''}`} onClick={() => setOrderFilter(k)}>
                        {k === 'all' ? 'All Orders' : ORDER_STATUS[k].label}
                        <span className="count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    No orders match this filter.
                  </div>
                ) : (
                  filteredOrders.map((o) => {
                    const st = ORDER_STATUS[o.status];
                    const total = orderTotal(o);
                    const open = expandedOrder === o.id;
                    const noting = noteOrderId === o.id;
                    return (
                      <div key={o.id} className="adm-card" style={{ overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedOrder(open ? null : o.id)}
                          aria-expanded={open}
                          style={{
                            all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%',
                            padding: '1.3rem 1.5rem',
                            display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                              {o.customerName}
                            </div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                              #{o.id} · {o.eventType} · event {fmtDate(o.eventDate)} · ordered {fmtDate(o.createdAt)}
                            </div>
                            {o.note && (
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontStyle: 'italic', color: 'var(--text-muted)', marginTop: '0.4rem', background: 'var(--accent-muted)', padding: '0.35rem 0.7rem', borderRadius: 'var(--r-lg)', borderLeft: '2px solid var(--accent)', display: 'inline-block' }}>
                                Note: {o.note}
                              </div>
                            )}
                          </div>
                          {o.overdue && o.status !== 'cancelled' && <StatusBadge label="⚠ Overdue" color="var(--danger)" />}
                          <StatusBadge label={st.label} color={st.color} />
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(total)}</span>
                          <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>▼</span>
                        </button>

                        {open && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '1.15rem 1.5rem', background: 'var(--bg-subtle)' }}>
                            {o.items.map((it) => (
                              <div key={it.id} className="adm-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>
                                <span style={{ color: 'var(--text-muted)', fontWeight: 300 }}>{it.name} × {it.qty}</span>
                                <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{fmt(it.price * it.qty)}</span>
                              </div>
                            ))}
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                              {o.status === 'pending_dp' && (
                                <button type="button" className="adm-btn info" onClick={() => advanceOrder(o)}>Mark 50% DP Received</button>
                              )}
                              {o.status === 'dp_paid' && (
                                <button type="button" className="adm-btn success" onClick={() => advanceOrder(o)}>Mark Fully Paid</button>
                              )}
                              {o.status !== 'cancelled' && o.status !== 'fully_paid' && (
                                <button type="button" className="adm-btn danger" onClick={() => cancelOrder(o.id)}>Cancel Order</button>
                              )}
                              <button type="button" className="adm-btn outline" onClick={() => { setNoteOrderId(o.id); setNoteText(o.note ?? ''); }}>
                                {o.note ? 'Edit Note' : 'Add Note'}
                              </button>
                            </div>
                            {noting && (
                              <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  <FieldLabel text="Admin note" />
                                  <input className="adm-input square" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button type="button" className="adm-btn primary" onClick={() => saveNote(o.id)}>Save</button>
                                  <button type="button" className="adm-btn outline" onClick={() => setNoteOrderId(null)}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ══════════ PACKAGES ══════════ */}
            {tab === 'packages' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <h2 className="adm-title">Manage Packages</h2>
                <div className="adm-card" style={{ overflow: 'hidden' }}>
                  {packages.map((p) => (
                    <div key={p.id} className="adm-row">
                      {editPkgId === p.id ? (
                        <div style={{ padding: '1.15rem 1.5rem', background: 'var(--bg-subtle)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem', marginBottom: '0.8rem' }}>
                            <div><FieldLabel text="Name" /><input className="adm-input square" value={editPkg.name ?? ''} onChange={(e) => setEditPkg((x) => ({ ...x, name: e.target.value }))} /></div>
                            <div><FieldLabel text="Price" /><input className="adm-input square" value={editPkg.price ?? ''} onChange={(e) => setEditPkg((x) => ({ ...x, price: e.target.value }))} /></div>
                            <div><FieldLabel text="Unit" /><input className="adm-input square" value={editPkg.unit ?? ''} onChange={(e) => setEditPkg((x) => ({ ...x, unit: e.target.value }))} /></div>
                          </div>
                          <div style={{ marginBottom: '0.8rem' }}>
                            <FieldLabel text="Description" />
                            <input className="adm-input square" value={editPkg.description ?? ''} onChange={(e) => setEditPkg((x) => ({ ...x, description: e.target.value }))} />
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="button" className="adm-btn primary" onClick={() => savePkg(p.id)}>Save</button>
                            <button type="button" className="adm-btn outline" onClick={() => setEditPkgId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '1.1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', opacity: p.active ? 1 : 0.55 }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                              {p.name}
                              {p.highlight && (
                                <span style={{ marginLeft: '0.55rem', fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-muted)', border: '1px solid var(--border-accent)', padding: '0.14rem 0.5rem', borderRadius: 'var(--r-full)', fontWeight: 500, verticalAlign: 'middle' }}>
                                  Best Value
                                </span>
                              )}
                            </div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.15rem' }}>{p.description}</div>
                          </div>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>{p.price}</span>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-muted)' }}>{p.unit}</span>
                          <StatusBadge label={p.active ? 'Active' : 'Inactive'} color={p.active ? 'var(--primary)' : 'var(--danger)'} />
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button type="button" className="adm-btn outline" onClick={() => { setEditPkgId(p.id); setEditPkg({ name: p.name, price: p.price, unit: p.unit, description: p.description }); }}>
                              Edit
                            </button>
                            <button type="button" className={`adm-btn ${p.active ? 'danger' : 'success'}`} onClick={() => togglePkg(p.id)}>
                              {p.active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══════════ TESTIMONIALS ══════════ */}
            {tab === 'testimonials' && (
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <h2 className="adm-title">Testimonial Moderation</h2>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                    {pendingTesti} pending review
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {(['pending', 'approved', 'rejected', 'all'] as const).map((k) => {
                    const count = k === 'all' ? testimonials.length : testimonials.filter((t) => t.status === k).length;
                    return (
                      <button key={k} type="button" className={`adm-pill${testiFilter === k ? ' active' : ''}`} onClick={() => setTestiFilter(k)}>
                        {k === 'all' ? 'All' : TESTI_STATUS[k].label}
                        <span className="count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {filteredTesti.length === 0 ? (
                  <div className="adm-card" style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    No testimonials in this view.
                  </div>
                ) : (
                  filteredTesti.map((t) => {
                    const st = TESTI_STATUS[t.status];
                    return (
                      <div key={t.id} className="adm-card" style={{ padding: '1.3rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                          <div
                            style={{
                              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                              background: 'var(--primary-muted)', border: '1px solid var(--border-accent)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)',
                            }}
                          >
                            {t.name.charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{t.name}</span>
                              <span style={{ color: 'var(--accent)', fontSize: '0.8rem' }}>
                                {'★'.repeat(t.rating)}
                                <span style={{ color: 'var(--border-strong)' }}>{'★'.repeat(5 - t.rating)}</span>
                              </span>
                            </div>
                            <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 0.4rem' }}>
                              "{t.body}"
                            </p>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                              Submitted {fmtDate(t.submittedAt)}
                            </span>
                          </div>
                          <StatusBadge label={st.label} color={st.color} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                          {t.status !== 'approved' && (
                            <button type="button" className="adm-btn success" onClick={() => setTestiStatus(t.id, 'approved')}>
                              ✓ Approve — publish to landing page
                            </button>
                          )}
                          {t.status !== 'rejected' && (
                            <button type="button" className="adm-btn danger" onClick={() => setTestiStatus(t.id, 'rejected')}>
                              ✕ {t.status === 'approved' ? 'Remove from landing page' : 'Reject'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ══════════ PLACEHOLDER ══════════ */}
            {tab === 'placeholder' && (
              <div className="fade-up">
                <h2 className="adm-title" style={{ marginBottom: '1.2rem' }}>{placeholderName}</h2>
                <div className="adm-card" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.8rem', color: 'var(--text-dim)', marginBottom: '0.8rem' }}>◌</div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
                    {placeholderName} management arrives when the backend is wired up.
                  </p>
                </div>
              </div>
            )}
          </div>

          <footer style={{ borderTop: '1px solid var(--border)', padding: '1.75rem 2rem', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              © {new Date().getFullYear()} King Jegi Events &amp; Catering · Admin Panel
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
