import { useEffect, useMemo, useState } from 'react';
import { Navbar } from '../components/landing/Navbar';
import { ChatWidget } from '../components/landing/ChatWidget';

const fmtPHP = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */

type Service = 'event' | 'rentals' | 'menu';

const SERVICES: { id: Service; tag: string; title: string; description: string; icon: string }[] = [
  { id: 'event', tag: 'Full Service', title: 'Book an Event', description: 'Complete catering and coordination for weddings, debuts, birthdays, and corporate events.', icon: '✦' },
  { id: 'rentals', tag: 'Equipment', title: 'Rent Equipment', description: 'Tables, chairs, linens, sound, and styling — delivered, set up, and picked up by our crew.', icon: '🎪' },
  { id: 'menu', tag: 'Food Delivery', title: 'Order from the Menu', description: 'Dishes and party trays from our kitchen, delivered to your door for any gathering.', icon: '🍽️' },
];

const STEP_LABELS: Record<Service, string[]> = {
  event: ['Contact', 'Event', 'Package', 'Review'],
  rentals: ['Contact', 'Schedule', 'Items', 'Review'],
  menu: ['Contact', 'Delivery', 'Menu', 'Review'],
};

const CITIES = ['Calamba', 'Cabuyao', 'Los Baños', 'Santa Rosa'];
const EVENT_TYPES = ['Wedding', 'Birthday / Debut', 'Anniversary', 'Corporate', 'Other'];

/* Dates already reserved — picking one triggers the availability warning. */
const BOOKED_DATES = ['2026-07-25', '2026-08-08', '2026-08-15', '2026-09-12'];

type EventPackage = { id: string; name: string; base: number; included: number; perExtraGuest: number; blurb: string };

const EVENT_PACKAGES: EventPackage[] = [
  { id: 'wedding', name: 'Wedding Package', base: 80000, included: 150, perExtraGuest: 450, blurb: 'Floral styling, plated or buffet dining, full coordination.' },
  { id: 'birthday', name: 'Birthday Package', base: 65000, included: 100, perExtraGuest: 400, blurb: 'Themed styling, buffet, sound system, and dedicated crew.' },
  { id: 'custom', name: 'Custom Package', base: 20000, included: 0, perExtraGuest: 380, blurb: 'Built from scratch — base coordination fee plus per-guest catering.' },
];

const ADDONS: { id: string; name: string; price: number }[] = [
  { id: 'photo', name: 'Photography', price: 15000 },
  { id: 'sound', name: 'Sound System', price: 5000 },
  { id: 'mc', name: 'Host / MC', price: 8000 },
  { id: 'dessert', name: 'Dessert Bar', price: 12000 },
  { id: 'booth', name: 'Photo Booth', price: 10000 },
];

type RentalItem = { id: number; name: string; perDay: number; stock: number };

const RENTAL_ITEMS: RentalItem[] = [
  { id: 1, name: 'Tiffany Chairs', perDay: 35, stock: 300 },
  { id: 2, name: 'Round Table (10-seater)', perDay: 120, stock: 60 },
  { id: 3, name: 'Chafing Dish', perDay: 150, stock: 30 },
  { id: 4, name: 'Sound System Package', perDay: 1800, stock: 6 },
  { id: 5, name: 'Fairy Light Strand (10m)', perDay: 60, stock: 40 },
  { id: 6, name: 'Table Skirting', perDay: 30, stock: 0 },
];

type MenuItem = { id: number; name: string; category: string; price: number };

const MENU_ITEMS: MenuItem[] = [
  { id: 1, name: 'Chicken Adobo', category: 'Chicken', price: 180 },
  { id: 2, name: 'Chicken Inasal', category: 'Chicken', price: 195 },
  { id: 3, name: 'Beef Caldereta', category: 'Beef', price: 250 },
  { id: 4, name: 'Kare-Kare', category: 'Beef', price: 260 },
  { id: 5, name: 'Lechon Belly', category: 'Pork', price: 320 },
  { id: 6, name: 'Garlic Butter Shrimp', category: 'Seafood', price: 290 },
  { id: 7, name: 'Pinakbet', category: 'Vegetables', price: 140 },
  { id: 8, name: 'Leche Flan', category: 'Desserts', price: 120 },
];

type TrayItem = { id: number; name: string; price: number; contents: string };

const TRAY_ITEMS: TrayItem[] = [
  { id: 1, name: 'Fiesta Tray Set', price: 2499, contents: 'Pancit Bihon · Lumpiang Shanghai · Chicken Adobo · Puto' },
  { id: 2, name: 'Family Feast Set', price: 3299, contents: 'Beef Caldereta · Garlic Shrimp · Fresh Lumpia · Leche Flan' },
  { id: 3, name: 'Handaan Tray Set', price: 3999, contents: 'Lechon Belly · Pancit Canton · Buttered Vegetables · Buko Pandan' },
];

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash on Delivery', icon: '💵' },
  { id: 'gcash', label: 'GCash', icon: '📱' },
  { id: 'transfer', label: 'Online Transfer', icon: '💳' },
];

/* ─────────────────────────────────────────────────────────────────────────
   Small pieces
───────────────────────────────────────────────────────────────────────── */

function Field({ label, required, error, children, hint }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label className="bkg-label">
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>
      {children}
      {hint && !error && <p className="bkg-hint">{hint}</p>}
      {error && <p className="bkg-error">⚠ {error}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="bkg-section-title">{children}</h3>;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bkg-review-row">
      <span className="lbl">{label}</span>
      <span className="val">{value || '—'}</span>
    </div>
  );
}

function CheckMark({ on, round }: { on: boolean; round?: boolean }) {
  return (
    <span
      className="bkg-checkmark"
      style={{
        borderRadius: round ? '50%' : 'var(--r-sm)',
        borderColor: on ? 'var(--primary)' : 'var(--border-strong)',
        background: on ? 'var(--primary)' : 'transparent',
      }}
    >
      {on && (round
        ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary-text)' }} />
        : <span style={{ color: 'var(--primary-text)', fontSize: '0.7rem', fontWeight: 700, lineHeight: 1 }}>✓</span>
      )}
    </span>
  );
}

/* quantity stepper (delta-based, clamped by caller) */
function Qty({ value, onDelta, label }: { value: number; onDelta: (d: number) => void; label: string }) {
  return (
    <div className="bkg-qty" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Decrease quantity for ${label}`} onClick={() => onDelta(-1)}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`Increase quantity for ${label}`} onClick={() => onDelta(1)}>+</button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

export function BookingPage() {
  const [service, setService] = useState<Service | null>(null);
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* shared contact fields */
  const [contact, setContact] = useState({ name: '', email: '', phone: '', street: '', city: '', zip: '' });

  /* event fields */
  const [event, setEvent] = useState({ type: '', date: '', time: '', guests: '', theme: '', colors: '' });
  const [pkgId, setPkgId] = useState('');
  const [addons, setAddons] = useState<string[]>([]);

  /* rentals fields */
  const [schedule, setSchedule] = useState({ deliveryDate: '', deliveryTime: '', pickupDate: '', pickupTime: '' });
  const [rentalSel, setRentalSel] = useState<Record<number, number>>({});

  /* menu fields */
  const [dishSel, setDishSel] = useState<Record<number, number>>({});
  const [traySel, setTraySel] = useState<Record<number, number>>({});
  const [payment, setPayment] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const steps = service ? STEP_LABELS[service] : [];

  /* Escape closes the terms modal */
  useEffect(() => {
    if (!termsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTermsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [termsOpen]);

  /* ── availability (static) ── */
  const dateBooked = event.date !== '' && BOOKED_DATES.includes(event.date);
  const suggestedDates = useMemo(() => {
    if (!dateBooked) return [];
    const out: string[] = [];
    const d = new Date(event.date + 'T00:00:00');
    while (out.length < 3) {
      d.setDate(d.getDate() + 1);
      const iso = d.toISOString().split('T')[0];
      if (!BOOKED_DATES.includes(iso)) out.push(iso);
    }
    return out;
  }, [dateBooked, event.date]);

  /* ── derived pricing ── */
  const pkg = EVENT_PACKAGES.find((p) => p.id === pkgId);
  const guestCount = parseInt(event.guests, 10) || 0;
  const extraGuests = pkg ? Math.max(0, guestCount - pkg.included) : 0;
  const addonRows = ADDONS.filter((a) => addons.includes(a.id));
  const eventTotal = pkg ? pkg.base + extraGuests * pkg.perExtraGuest + addonRows.reduce((s, a) => s + a.price, 0) : 0;

  const rentalDays = useMemo(() => {
    if (!schedule.deliveryDate || !schedule.pickupDate) return 1;
    const diff = Math.round((+new Date(schedule.pickupDate) - +new Date(schedule.deliveryDate)) / 86400000);
    return Math.max(1, diff);
  }, [schedule.deliveryDate, schedule.pickupDate]);

  const rentalRows = RENTAL_ITEMS.filter((r) => rentalSel[r.id] != null)
    .map((r) => ({ ...r, qty: rentalSel[r.id], sub: r.perDay * rentalSel[r.id] * rentalDays }));
  const rentalTotal = rentalRows.reduce((s, r) => s + r.sub, 0);

  const dishRows = MENU_ITEMS.filter((m) => dishSel[m.id] != null).map((m) => ({ ...m, qty: dishSel[m.id], sub: m.price * dishSel[m.id] }));
  const trayRows = TRAY_ITEMS.filter((t) => traySel[t.id] != null).map((t) => ({ ...t, qty: traySel[t.id], sub: t.price * traySel[t.id] }));
  const menuTotal = dishRows.reduce((s, r) => s + r.sub, 0) + trayRows.reduce((s, r) => s + r.sub, 0);

  const grandTotal = service === 'event' ? eventTotal : service === 'rentals' ? rentalTotal : menuTotal;

  /* ── selection helpers ── */
  const toggleIn = (set: React.Dispatch<React.SetStateAction<Record<number, number>>>) => (id: number) => {
    set((prev) => {
      const next = { ...prev };
      if (next[id] != null) delete next[id];
      else next[id] = 1;
      return next;
    });
    setErrors((p) => ({ ...p, items: '' }));
  };
  const bumpIn = (set: React.Dispatch<React.SetStateAction<Record<number, number>>>, cap?: (id: number) => number) =>
    (id: number, d: number) =>
      set((prev) => {
        if (prev[id] == null) return prev;
        const max = cap ? cap(id) : Infinity;
        return { ...prev, [id]: Math.min(max, Math.max(1, prev[id] + d)) };
      });

  const toggleRental = toggleIn(setRentalSel);
  const bumpRental = bumpIn(setRentalSel, (id) => RENTAL_ITEMS.find((r) => r.id === id)?.stock ?? 1);
  const toggleDish = toggleIn(setDishSel);
  const bumpDish = bumpIn(setDishSel);
  const toggleTray = toggleIn(setTraySel);
  const bumpTray = bumpIn(setTraySel);

  /* ── validation ── */
  const validate = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!contact.name.trim()) e.name = 'Please enter your full name.';
      if (!contact.email.trim()) e.email = 'Please enter your email address.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) e.email = 'That email address doesn’t look right.';
      if (!contact.phone.trim()) e.phone = 'Please enter your phone number.';
    }
    if (s === 2 && service === 'event') {
      if (!event.type) e.type = 'Please choose an event type.';
      if (!event.date) e.date = 'Please pick your event date.';
      else if (dateBooked) e.date = 'That date is already reserved — pick another.';
      if (!event.guests.trim() || guestCount < 1) e.guests = 'How many guests are you expecting?';
    }
    if (s === 2 && (service === 'rentals' || service === 'menu')) {
      if (!schedule.deliveryDate) e.deliveryDate = 'Please pick a delivery date.';
      if (service === 'rentals') {
        if (!schedule.pickupDate) e.pickupDate = 'Please pick a pick-up date.';
        else if (schedule.deliveryDate && schedule.pickupDate < schedule.deliveryDate)
          e.pickupDate = 'Pick-up must be on or after delivery.';
      }
    }
    if (s === 3 && service === 'event') {
      if (!pkgId) e.pkg = 'Please choose a package.';
    }
    if (s === 3 && service === 'rentals' && rentalRows.length === 0) e.items = 'Select at least one rental item.';
    if (s === 3 && service === 'menu') {
      if (dishRows.length + trayRows.length === 0) e.items = 'Select at least one dish or tray.';
      if (!payment) e.payment = 'Please choose a payment method.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validate(step)) return;
    setStep((s) => Math.min(s + 1, 4));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const back = () => {
    if (step === 1) { setService(null); return; }
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const jumpTo = (s: number) => {
    if (s < step) { setStep(s); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };
  const pickService = (s: Service) => {
    setService(s);
    setStep(1);
    setErrors({});
    setSubmitted(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const confirm = () => {
    setTermsOpen(false);
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const contactField = (key: keyof typeof contact) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setContact((p) => ({ ...p, [key]: e.target.value }));
      if (e.target.value.trim()) setErrors((p) => ({ ...p, [key]: '' }));
    };

  const sectionPad: React.CSSProperties = { padding: '6rem 0', position: 'relative' };

  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .fade-up { animation: fadeUp 0.45s ease both; }

        .blob {
          position: absolute; border-radius: 50%;
          filter: blur(80px); opacity: 0.18; pointer-events: none;
        }
        .blob-primary { background: var(--primary); }
        .blob-accent  { background: var(--accent); }

        /* ── cards ── */
        .bkg-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
        }

        /* ── service selector ── */
        .bkg-services {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem;
        }
        @media (max-width: 760px) { .bkg-services { grid-template-columns: 1fr; } }
        .bkg-service {
          text-align: left; cursor: pointer;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          padding: 1.75rem 1.6rem;
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s;
        }
        .bkg-service:hover {
          border-color: var(--border-accent);
          box-shadow: var(--shadow-md);
          transform: translateY(-3px);
        }
        .bkg-service .tag {
          display: inline-block;
          font-family: var(--font-body); font-size: 0.52rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--primary);
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          padding: 0.22rem 0.65rem;
          margin-bottom: 0.9rem;
        }

        /* ── progress ── */
        .bkg-progress {
          display: flex; position: relative;
          padding: 1.4rem 1.75rem 1.1rem;
          margin-bottom: 1.25rem;
        }
        .bkg-progress .track, .bkg-progress .fill {
          position: absolute; top: calc(1.4rem + 17px); left: 12%; height: 2px; border-radius: 1px;
        }
        .bkg-progress .track { right: 12%; background: var(--border); }
        .bkg-progress .fill { background: var(--primary); transition: width 0.4s ease; }
        .bkg-progress .stop {
          position: relative; z-index: 1; flex: 1;
          display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
          background: transparent; border: none; padding: 0; cursor: default;
        }
        .bkg-progress .stop.clickable { cursor: pointer; }
        .bkg-progress .dot {
          width: 34px; height: 34px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-body); font-size: 0.78rem; font-weight: 600;
          border: 2px solid var(--border-strong);
          background: var(--surface); color: var(--text-dim);
          transition: background 0.3s, border-color 0.3s, color 0.3s, box-shadow 0.3s;
        }
        .bkg-progress .stop.done .dot, .bkg-progress .stop.active .dot {
          background: var(--primary); border-color: var(--primary); color: var(--primary-text);
        }
        .bkg-progress .stop.active .dot { box-shadow: 0 0 0 5px var(--primary-muted); }
        .bkg-progress .stop span {
          font-family: var(--font-body); font-size: 0.58rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim);
        }
        .bkg-progress .stop.active span { color: var(--primary); font-weight: 600; }
        .bkg-progress .stop.done span { color: var(--text-muted); }
        @media (max-width: 560px) { .bkg-progress .stop span { display: none; } }

        /* ── form pieces ── */
        .bkg-form { padding: 2.25rem 2.25rem 2rem; }
        @media (max-width: 640px) { .bkg-form { padding: 1.5rem 1.25rem; } }
        .bkg-two { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; }
        @media (max-width: 640px) { .bkg-two { grid-template-columns: 1fr; } }
        .bkg-label {
          font-family: var(--font-body); font-size: 0.56rem;
          letter-spacing: 0.22em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim); display: block; margin-bottom: 0.45rem;
        }
        .bkg-input {
          width: 100%;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          padding: 0.8rem 1rem;
          font-family: var(--font-body); font-size: 0.86rem; font-weight: 300;
          color: var(--text-primary); outline: none;
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        }
        .bkg-input:focus { border-color: var(--primary); background: var(--surface); box-shadow: 0 0 0 3px var(--primary-muted); }
        .bkg-input.invalid { border-color: var(--danger); background: var(--danger-muted); }
        select.bkg-input { cursor: pointer; font-weight: 400; }
        .bkg-hint { font-family: var(--font-body); font-size: 0.66rem; font-weight: 300; color: var(--text-dim); margin-top: 0.35rem; }
        .bkg-error { font-family: var(--font-body); font-size: 0.7rem; color: var(--danger); margin-top: 0.4rem; }

        .bkg-section-title {
          font-family: var(--font-display); font-size: 1.1rem; font-weight: 600;
          color: var(--primary); letter-spacing: 0.02em;
          margin: 0 0 1rem; padding-bottom: 0.6rem;
          border-bottom: 1px solid var(--border);
        }

        .bkg-step-head h2 {
          font-family: var(--font-display); font-size: clamp(1.5rem, 3vw, 1.9rem);
          font-weight: 500; color: var(--text-primary); margin: 0 0 0.3rem;
        }
        .bkg-step-head p {
          font-family: var(--font-body); font-size: 0.82rem; font-weight: 300;
          color: var(--text-muted); margin: 0 0 1.75rem;
        }

        /* ── selectable rows ── */
        .bkg-row {
          display: flex; align-items: center; gap: 0.8rem;
          border: 1px solid var(--border);
          background: var(--bg-subtle);
          border-radius: var(--r-lg);
          padding: 0.85rem 1rem;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .bkg-row:hover { border-color: var(--border-accent); }
        .bkg-row.on { border-color: var(--primary); background: var(--primary-muted); }
        .bkg-row.off { opacity: 0.55; cursor: not-allowed; }
        .bkg-row .ttl { font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; color: var(--text-primary); }
        .bkg-row.on .ttl { color: var(--primary); }
        .bkg-row .sub { font-family: var(--font-body); font-size: 0.7rem; font-weight: 300; color: var(--text-muted); margin-top: 0.12rem; }

        .bkg-checkmark {
          width: 20px; height: 20px; flex-shrink: 0;
          border: 2px solid;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s, border-color 0.2s;
        }

        .bkg-qty {
          display: flex; align-items: center; flex-shrink: 0;
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          background: var(--surface);
          overflow: hidden;
        }
        .bkg-qty button {
          border: none; background: transparent; cursor: pointer;
          width: 26px; height: 26px; line-height: 1;
          color: var(--primary); font-size: 0.9rem; font-weight: 600;
          transition: background 0.15s;
        }
        .bkg-qty button:hover { background: var(--primary-muted); }
        .bkg-qty span {
          min-width: 26px; text-align: center;
          font-family: var(--font-body); font-size: 0.74rem; font-weight: 500;
          color: var(--text-primary);
        }

        /* ── summary / estimate ── */
        .bkg-summary {
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-xl);
          padding: 1.15rem 1.3rem;
        }
        .bkg-summary .cap {
          font-family: var(--font-body); font-size: 0.56rem;
          letter-spacing: 0.24em; text-transform: uppercase; font-weight: 600;
          color: var(--primary); margin-bottom: 0.7rem;
        }
        .bkg-summary .line {
          display: flex; justify-content: space-between; gap: 1rem;
          font-family: var(--font-body); font-size: 0.8rem;
          color: var(--text-muted); font-weight: 300;
          padding: 0.28rem 0;
        }
        .bkg-summary .line strong { color: var(--text-primary); font-weight: 500; }
        .bkg-summary .total {
          display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
          border-top: 2px solid var(--primary);
          margin-top: 0.6rem; padding-top: 0.7rem;
        }
        .bkg-summary .total .l { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; color: var(--text-primary); }
        .bkg-summary .total .v { font-family: var(--font-display); font-size: 1.45rem; font-weight: 700; color: var(--primary); }

        .bkg-review-row {
          display: flex; justify-content: space-between; gap: 1rem;
          padding: 0.6rem 0; border-bottom: 1px solid var(--border); flex-wrap: wrap;
        }
        .bkg-review-row .lbl {
          font-family: var(--font-body); font-size: 0.62rem;
          letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500;
          color: var(--text-dim); flex-shrink: 0;
        }
        .bkg-review-row .val {
          font-family: var(--font-body); font-size: 0.84rem; font-weight: 500;
          color: var(--text-primary); text-align: right; word-break: break-word; max-width: 65%;
        }

        /* ── availability notice ── */
        .bkg-notice {
          border-radius: var(--r-lg);
          padding: 0.9rem 1.05rem; margin-top: 0.8rem;
          font-family: var(--font-body); font-size: 0.76rem; line-height: 1.55;
        }
        .bkg-notice.ok {
          background: var(--primary-muted);
          border: 1px solid var(--border-accent);
          color: var(--primary);
        }
        .bkg-notice.bad {
          background: var(--danger-muted);
          border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
          color: var(--danger);
        }
        .bkg-chip {
          font-family: var(--font-body); font-size: 0.68rem; font-weight: 500;
          color: var(--primary);
          background: var(--surface);
          border: 1px solid var(--border-accent);
          border-radius: var(--r-full);
          padding: 0.32rem 0.8rem; cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .bkg-chip:hover { background: var(--primary); color: var(--primary-text); }

        /* ── nav buttons ── */
        .bkg-nav {
          display: flex; gap: 0.8rem;
          margin-top: 2rem; padding-top: 1.5rem;
          border-top: 1px solid var(--border);
        }
        @media (max-width: 560px) { .bkg-nav { flex-direction: column-reverse; } }
        .bkg-btn {
          flex: 1;
          font-family: var(--font-body); font-size: 0.66rem;
          letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500;
          padding: 0.85rem 1.4rem; border-radius: var(--r-full);
          border: 1px solid transparent; cursor: pointer; text-align: center;
          transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s;
        }
        .bkg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .bkg-btn.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
        .bkg-btn.primary:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); box-shadow: var(--shadow-green); }
        .bkg-btn.ghost { background: transparent; color: var(--text-muted); border-color: var(--border); }
        .bkg-btn.ghost:hover { color: var(--primary); border-color: var(--border-accent); }

        /* ── modal ── */
        .bkg-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(20, 14, 8, 0.55);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          padding: 1.5rem; animation: fadeUp 0.2s ease both;
        }
        .bkg-modal {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--r-xl); width: 100%; max-width: 560px; max-height: 88vh;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: var(--shadow-lg);
          animation: scaleIn 0.25s ease both;
        }
      `}</style>

      <Navbar activePage="quotation" />

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>

        {/* ═══════════════════════ HERO ═══════════════════════ */}
        <section style={{ ...sectionPad, paddingTop: 'calc(6rem + 80px)', paddingBottom: '3rem', overflow: 'hidden' }}>
          <div className="blob blob-primary" style={{ width: 480, height: 480, top: '-120px', left: '-140px' }} />
          <div className="blob blob-accent" style={{ width: 380, height: 380, bottom: '-80px', right: '5%' }} />

          <div className="fade-up" style={{ maxWidth: 760, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                background: 'var(--accent-muted)', border: '1px solid var(--border-accent)',
                padding: '0.35rem 1rem', marginBottom: '1.5rem',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 500 }}>
                {service === null ? 'Reserve Your Date' : SERVICES.find((s) => s.id === service)?.title}
              </span>
            </div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2.6rem, 5.5vw, 4.2rem)',
                fontWeight: 400, lineHeight: 1.08,
                color: 'var(--text-primary)', marginBottom: '1.25rem',
              }}
            >
              Book{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Now</em>
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto' }}>
              {service === null
                ? 'Pick a service to get started. No payment is needed to reserve — we confirm every booking within 24 hours.'
                : 'Four quick steps. Your details stay on this page until you confirm.'}
            </p>
          </div>
        </section>

        {/* ═══════════════════════ WIZARD ═══════════════════════ */}
        <section style={{ padding: '0 0 6rem' }}>
          <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 1.5rem' }}>

            {/* ── service selector ── */}
            {service === null && (
              <div className="fade-up bkg-services">
                {SERVICES.map((s) => (
                  <button key={s.id} type="button" className="bkg-service" onClick={() => pickService(s.id)}>
                    <span className="tag">{s.tag}</span>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.6rem' }}>{s.icon}</div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 0.45rem' }}>
                      {s.title}
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 1.1rem' }}>
                      {s.description}
                    </p>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--primary)' }}>
                      Start →
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* ── success ── */}
            {service !== null && submitted && (
              <div className="fade-up bkg-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
                <div
                  style={{
                    width: 68, height: 68, borderRadius: '50%',
                    background: 'var(--primary-muted)', border: '1px solid var(--border-accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 1.4rem', fontSize: '1.7rem', color: 'var(--primary)',
                  }}
                >
                  ✓
                </div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.6rem' }}>
                  Booking <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>received!</em>
                </h2>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.88rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.7, maxWidth: 420, margin: '0 auto 1.9rem' }}>
                  Thank you, {contact.name.split(' ')[0] || 'friend'} — our team will reach out within 24 hours
                  to confirm the details{grandTotal > 0 ? ` for your ${fmtPHP(grandTotal)} ${service === 'event' ? 'event estimate' : 'order'}` : ''}.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="/" className="bkg-btn primary" style={{ flex: '0 0 auto', textDecoration: 'none' }}>Back to Home</a>
                  <button type="button" className="bkg-btn ghost" style={{ flex: '0 0 auto' }} onClick={() => { setService(null); setSubmitted(false); }}>
                    Make Another Booking
                  </button>
                </div>
              </div>
            )}

            {/* ── wizard ── */}
            {service !== null && !submitted && (
              <div className="fade-up">
                {/* progress */}
                <div className="bkg-card bkg-progress">
                  <div className="track" />
                  <div className="fill" style={{ width: `${((step - 1) / 3) * 76}%` }} />
                  {steps.map((label, i) => {
                    const n = i + 1;
                    const state = n < step ? 'done' : n === step ? 'active' : '';
                    return (
                      <button
                        key={label}
                        type="button"
                        className={`stop ${state}${n < step ? ' clickable' : ''}`}
                        onClick={() => jumpTo(n)}
                      >
                        <span className="dot">{n < step ? '✓' : n}</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="bkg-card bkg-form">

                  {/* ════ STEP 1 — CONTACT (shared) ════ */}
                  {step === 1 && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>Contact <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>details</em></h2>
                        <p>Tell us how to reach you about this booking.</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                        <Field label="Full Name" required error={errors.name}>
                          <input className={`bkg-input${errors.name ? ' invalid' : ''}`} value={contact.name} onChange={contactField('name')} placeholder="Your full name" />
                        </Field>
                        <div className="bkg-two">
                          <Field label="Email Address" required error={errors.email}>
                            <input className={`bkg-input${errors.email ? ' invalid' : ''}`} type="email" value={contact.email} onChange={contactField('email')} placeholder="you@email.com" />
                          </Field>
                          <Field label="Phone Number" required error={errors.phone}>
                            <input className={`bkg-input${errors.phone ? ' invalid' : ''}`} value={contact.phone} onChange={contactField('phone')} placeholder="+63 9XX XXX XXXX" />
                          </Field>
                        </div>

                        <div
                          role="note"
                          style={{
                            display: 'flex', gap: '0.7rem', alignItems: 'flex-start',
                            background: 'var(--accent-muted)',
                            border: '1px solid var(--border-accent)',
                            borderLeft: '3px solid var(--accent)',
                            borderRadius: 'var(--r-lg)',
                            padding: '0.85rem 1rem',
                          }}
                        >
                          <span aria-hidden="true">📍</span>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 300, lineHeight: 1.6, color: 'var(--text-muted)', margin: 0 }}>
                            <strong style={{ color: 'var(--accent)', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.64rem' }}>Service area</strong>{' '}
                            — we currently serve <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Calamba, Cabuyao, and nearby Laguna towns</strong>.
                            Outside the area? Email us before booking.
                          </p>
                        </div>

                        <SectionTitle>Venue / Delivery Address</SectionTitle>
                        <Field label="Street Address">
                          <input className="bkg-input" value={contact.street} onChange={contactField('street')} placeholder="123 Rizal Street" />
                        </Field>
                        <div className="bkg-two">
                          <Field label="City">
                            <select className="bkg-input" value={contact.city} onChange={contactField('city')}>
                              <option value="">Select city…</option>
                              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </Field>
                          <Field label="Zip Code">
                            <input className="bkg-input" value={contact.zip} onChange={contactField('zip')} placeholder="4027" />
                          </Field>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ════ STEP 2 — EVENT DETAILS ════ */}
                  {step === 2 && service === 'event' && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>Event <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>details</em></h2>
                        <p>Tell us about the celebration you're planning.</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                        <div className="bkg-two">
                          <Field label="Event Type" required error={errors.type}>
                            <select
                              className={`bkg-input${errors.type ? ' invalid' : ''}`}
                              value={event.type}
                              onChange={(e) => { setEvent((p) => ({ ...p, type: e.target.value })); setErrors((p) => ({ ...p, type: '' })); }}
                            >
                              <option value="">Select…</option>
                              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </Field>
                          <Field label="Expected Guests" required error={errors.guests}>
                            <input
                              className={`bkg-input${errors.guests ? ' invalid' : ''}`}
                              type="number" min={1} value={event.guests}
                              onChange={(e) => { setEvent((p) => ({ ...p, guests: e.target.value })); setErrors((p) => ({ ...p, guests: '' })); }}
                              placeholder="e.g. 150"
                            />
                          </Field>
                        </div>
                        <div className="bkg-two">
                          <div>
                            <Field label="Event Date" required error={errors.date}>
                              <input
                                className={`bkg-input${errors.date || dateBooked ? ' invalid' : ''}`}
                                type="date" min={today} value={event.date}
                                onChange={(e) => { setEvent((p) => ({ ...p, date: e.target.value })); setErrors((p) => ({ ...p, date: '' })); }}
                              />
                            </Field>
                            {event.date && !dateBooked && (
                              <div className="bkg-notice ok">✓ {fmtLong(event.date)} is available.</div>
                            )}
                            {dateBooked && (
                              <div className="bkg-notice bad">
                                ⛔ That date is already reserved.
                                <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                  {suggestedDates.map((d) => (
                                    <button key={d} type="button" className="bkg-chip" onClick={() => setEvent((p) => ({ ...p, date: d }))}>
                                      {fmtShort(d)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <Field label="Event Time" hint="Optional — we'll finalize with you.">
                            <input className="bkg-input" type="time" value={event.time} onChange={(e) => setEvent((p) => ({ ...p, time: e.target.value }))} />
                          </Field>
                        </div>
                        <div className="bkg-two">
                          <Field label="Theme">
                            <input className="bkg-input" value={event.theme} onChange={(e) => setEvent((p) => ({ ...p, theme: e.target.value }))} placeholder="e.g. Rustic Garden" />
                          </Field>
                          <Field label="Color Scheme">
                            <input className="bkg-input" value={event.colors} onChange={(e) => setEvent((p) => ({ ...p, colors: e.target.value }))} placeholder="e.g. Sage & Gold" />
                          </Field>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ════ STEP 2 — SCHEDULE (rentals / menu) ════ */}
                  {step === 2 && (service === 'rentals' || service === 'menu') && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>{service === 'rentals' ? 'Delivery & pick-up' : 'Delivery'} <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>schedule</em></h2>
                        <p>{service === 'rentals' ? 'The rental period is billed per day between delivery and pick-up.' : 'When should we deliver your order?'}</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                        <SectionTitle>🚚 Delivery</SectionTitle>
                        <div className="bkg-two">
                          <Field label="Delivery Date" required error={errors.deliveryDate}>
                            <input
                              className={`bkg-input${errors.deliveryDate ? ' invalid' : ''}`}
                              type="date" min={today} value={schedule.deliveryDate}
                              onChange={(e) => { setSchedule((p) => ({ ...p, deliveryDate: e.target.value })); setErrors((p) => ({ ...p, deliveryDate: '' })); }}
                            />
                          </Field>
                          <Field label="Delivery Time">
                            <input className="bkg-input" type="time" value={schedule.deliveryTime} onChange={(e) => setSchedule((p) => ({ ...p, deliveryTime: e.target.value }))} />
                          </Field>
                        </div>
                        {service === 'rentals' && (
                          <>
                            <SectionTitle>📦 Pick-up</SectionTitle>
                            <div className="bkg-two">
                              <Field label="Pick-up Date" required error={errors.pickupDate}>
                                <input
                                  className={`bkg-input${errors.pickupDate ? ' invalid' : ''}`}
                                  type="date" min={schedule.deliveryDate || today} value={schedule.pickupDate}
                                  onChange={(e) => { setSchedule((p) => ({ ...p, pickupDate: e.target.value })); setErrors((p) => ({ ...p, pickupDate: '' })); }}
                                />
                              </Field>
                              <Field label="Pick-up Time">
                                <input className="bkg-input" type="time" value={schedule.pickupTime} onChange={(e) => setSchedule((p) => ({ ...p, pickupTime: e.target.value }))} />
                              </Field>
                            </div>
                            {schedule.deliveryDate && schedule.pickupDate && schedule.pickupDate >= schedule.deliveryDate && (
                              <div className="bkg-notice ok">
                                ✓ Rental period: <strong>{rentalDays} {rentalDays === 1 ? 'day' : 'days'}</strong>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ════ STEP 3 — PACKAGE (event) ════ */}
                  {step === 3 && service === 'event' && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>Package & <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>add-ons</em></h2>
                        <p>Choose a base package — the estimate updates as you go.</p>
                      </div>

                      <SectionTitle>Package</SectionTitle>
                      {errors.pkg && <p className="bkg-error" style={{ marginBottom: '0.6rem' }}>⚠ {errors.pkg}</p>}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '1.75rem' }}>
                        {EVENT_PACKAGES.map((p) => {
                          const on = pkgId === p.id;
                          return (
                            <div key={p.id} className={`bkg-row${on ? ' on' : ''}`} onClick={() => { setPkgId(p.id); setErrors((x) => ({ ...x, pkg: '' })); }}>
                              <CheckMark on={on} round />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="ttl">{p.name}</div>
                                <div className="sub">{p.blurb}</div>
                              </div>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                                {p.id === 'custom' ? `₱${p.base.toLocaleString()}+` : `₱${p.base.toLocaleString()}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <SectionTitle>Add-ons</SectionTitle>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '1.5rem' }}>
                        {ADDONS.map((a) => {
                          const on = addons.includes(a.id);
                          return (
                            <div key={a.id} className={`bkg-row${on ? ' on' : ''}`} onClick={() => setAddons((prev) => on ? prev.filter((x) => x !== a.id) : [...prev, a.id])}>
                              <CheckMark on={on} />
                              <span className="ttl" style={{ flex: 1 }}>{a.name}</span>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)' }}>+ ₱{a.price.toLocaleString()}</span>
                            </div>
                          );
                        })}
                      </div>

                      {pkg && (
                        <div className="bkg-summary">
                          <div className="cap">Live Estimate</div>
                          <div className="line"><span>{pkg.name}{pkg.included > 0 ? ` (up to ${pkg.included} guests)` : ''}</span><strong>{fmtPHP(pkg.base)}</strong></div>
                          {pkg.id === 'custom' && guestCount > 0 && (
                            <div className="line"><span>Catering × {guestCount} guests</span><strong>{fmtPHP(guestCount * pkg.perExtraGuest)}</strong></div>
                          )}
                          {pkg.id !== 'custom' && extraGuests > 0 && (
                            <div className="line"><span>Extra guests × {extraGuests}</span><strong>{fmtPHP(extraGuests * pkg.perExtraGuest)}</strong></div>
                          )}
                          {addonRows.map((a) => (
                            <div key={a.id} className="line"><span>{a.name}</span><strong>{fmtPHP(a.price)}</strong></div>
                          ))}
                          <div className="total">
                            <span className="l">Estimated Total</span>
                            <span className="v">{fmtPHP(pkg.id === 'custom' ? pkg.base + guestCount * pkg.perExtraGuest + addonRows.reduce((s, a) => s + a.price, 0) : eventTotal)}</span>
                          </div>
                          <div className="line" style={{ paddingTop: '0.45rem' }}>
                            <span>Required downpayment (50%)</span>
                            <strong style={{ color: 'var(--primary)' }}>{fmtPHP(Math.round(eventTotal / 2))}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ════ STEP 3 — ITEMS (rentals) ════ */}
                  {step === 3 && service === 'rentals' && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>Choose your <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>rentals</em></h2>
                        <p>Pick items and quantities — priced per day × {rentalDays} {rentalDays === 1 ? 'day' : 'days'}.</p>
                      </div>
                      {errors.items && <p className="bkg-error" style={{ marginBottom: '0.6rem' }}>⚠ {errors.items}</p>}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '1.5rem' }}>
                        {RENTAL_ITEMS.map((r) => {
                          const soldOut = r.stock <= 0;
                          const on = rentalSel[r.id] != null;
                          return (
                            <div key={r.id}>
                              <div
                                className={`bkg-row${on ? ' on' : ''}${soldOut ? ' off' : ''}`}
                                onClick={() => !soldOut && toggleRental(r.id)}
                                style={on ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined}
                              >
                                <CheckMark on={on} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="ttl">{r.name}</div>
                                  <div className="sub">{soldOut ? 'Out of stock' : `${r.stock} in stock`}</div>
                                </div>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {fmtPHP(r.perDay)}/day
                                </span>
                              </div>
                              {on && (
                                <div
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.8rem',
                                    border: '1px solid var(--primary)', borderTop: 'none',
                                    borderRadius: '0 0 var(--r-lg) var(--r-lg)',
                                    background: 'var(--primary-muted)',
                                    padding: '0.6rem 1rem',
                                  }}
                                >
                                  <span className="bkg-label" style={{ margin: 0 }}>Quantity</span>
                                  <Qty value={rentalSel[r.id]} onDelta={(d) => bumpRental(r.id, d)} label={r.name} />
                                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)' }}>of {r.stock}</span>
                                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary)' }}>
                                    {fmtPHP(r.perDay * rentalSel[r.id] * rentalDays)}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {rentalRows.length > 0 && (
                        <div className="bkg-summary">
                          <div className="cap">Price Breakdown</div>
                          {rentalRows.map((r) => (
                            <div key={r.id} className="line">
                              <span>{r.name} · {fmtPHP(r.perDay)} × {r.qty} × {rentalDays}d</span>
                              <strong>{fmtPHP(r.sub)}</strong>
                            </div>
                          ))}
                          <div className="total"><span className="l">Grand Total</span><span className="v">{fmtPHP(rentalTotal)}</span></div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ════ STEP 3 — MENU (menu) ════ */}
                  {step === 3 && service === 'menu' && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>Menu & <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>payment</em></h2>
                        <p>Pick dishes and trays, then choose how you'd like to pay.</p>
                      </div>
                      {errors.items && <p className="bkg-error" style={{ marginBottom: '0.6rem' }}>⚠ {errors.items}</p>}

                      <SectionTitle>Dishes (per serving)</SectionTitle>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.6rem' }}>
                        {MENU_ITEMS.map((m) => {
                          const on = dishSel[m.id] != null;
                          return (
                            <div key={m.id} className={`bkg-row${on ? ' on' : ''}`} onClick={() => toggleDish(m.id)}>
                              <CheckMark on={on} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="ttl">{m.name}</div>
                                <div className="sub">{m.category}</div>
                              </div>
                              {on && <Qty value={dishSel[m.id]} onDelta={(d) => bumpDish(m.id, d)} label={m.name} />}
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {fmtPHP(m.price)}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <SectionTitle>Party Trays</SectionTitle>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.6rem' }}>
                        {TRAY_ITEMS.map((t) => {
                          const on = traySel[t.id] != null;
                          return (
                            <div key={t.id} className={`bkg-row${on ? ' on' : ''}`} onClick={() => toggleTray(t.id)}>
                              <CheckMark on={on} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="ttl">{t.name}</div>
                                <div className="sub">{t.contents}</div>
                              </div>
                              {on && <Qty value={traySel[t.id]} onDelta={(d) => bumpTray(t.id, d)} label={t.name} />}
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {fmtPHP(t.price)}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {(dishRows.length > 0 || trayRows.length > 0) && (
                        <div className="bkg-summary" style={{ marginBottom: '1.6rem' }}>
                          <div className="cap">Order Summary</div>
                          {[...dishRows, ...trayRows.map((t) => ({ ...t, category: 'Tray' }))].map((r) => (
                            <div key={`${r.category}-${r.id}`} className="line">
                              <span>{r.name} × {r.qty}</span>
                              <strong>{fmtPHP(r.sub)}</strong>
                            </div>
                          ))}
                          <div className="total"><span className="l">Grand Total</span><span className="v">{fmtPHP(menuTotal)}</span></div>
                        </div>
                      )}

                      <SectionTitle>Payment Method</SectionTitle>
                      {errors.payment && <p className="bkg-error" style={{ marginBottom: '0.6rem' }}>⚠ {errors.payment}</p>}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {PAYMENT_METHODS.map((p) => {
                          const on = payment === p.id;
                          return (
                            <div key={p.id} className={`bkg-row${on ? ' on' : ''}`} onClick={() => { setPayment(p.id); setErrors((x) => ({ ...x, payment: '' })); }}>
                              <CheckMark on={on} round />
                              <span aria-hidden="true">{p.icon}</span>
                              <span className="ttl">{p.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ════ STEP 4 — REVIEW (all) ════ */}
                  {step === 4 && (
                    <div className="fade-up">
                      <div className="bkg-step-head">
                        <h2>Review your <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>booking</em></h2>
                        <p>One last look before you confirm.</p>
                      </div>

                      <SectionTitle>Contact</SectionTitle>
                      <div style={{ marginBottom: '1.6rem' }}>
                        <ReviewRow label="Name" value={contact.name} />
                        <ReviewRow label="Email" value={contact.email} />
                        <ReviewRow label="Phone" value={contact.phone} />
                        <ReviewRow label="Address" value={[contact.street, contact.city, contact.zip && `Laguna ${contact.zip}`].filter(Boolean).join(', ')} />
                      </div>

                      {service === 'event' && (
                        <>
                          <SectionTitle>Event</SectionTitle>
                          <div style={{ marginBottom: '1.6rem' }}>
                            <ReviewRow label="Type" value={event.type} />
                            <ReviewRow label="Date" value={event.date ? fmtLong(event.date) : ''} />
                            <ReviewRow label="Time" value={event.time || 'To be finalized'} />
                            <ReviewRow label="Guests" value={event.guests} />
                            <ReviewRow label="Theme" value={event.theme} />
                            <ReviewRow label="Colors" value={event.colors} />
                          </div>
                          <SectionTitle>Package</SectionTitle>
                          <div style={{ marginBottom: '1.6rem' }}>
                            <ReviewRow label="Package" value={pkg?.name ?? ''} />
                            <ReviewRow label="Add-ons" value={addonRows.length ? addonRows.map((a) => a.name).join(', ') : 'None'} />
                            <ReviewRow label="Estimate" value={fmtPHP(eventTotal)} />
                            <ReviewRow label="Downpayment (50%)" value={fmtPHP(Math.round(eventTotal / 2))} />
                          </div>
                        </>
                      )}

                      {service === 'rentals' && (
                        <>
                          <SectionTitle>Schedule</SectionTitle>
                          <div style={{ marginBottom: '1.6rem' }}>
                            <ReviewRow label="Delivery" value={schedule.deliveryDate ? `${fmtLong(schedule.deliveryDate)}${schedule.deliveryTime ? ` · ${schedule.deliveryTime}` : ''}` : ''} />
                            <ReviewRow label="Pick-up" value={schedule.pickupDate ? `${fmtLong(schedule.pickupDate)}${schedule.pickupTime ? ` · ${schedule.pickupTime}` : ''}` : ''} />
                            <ReviewRow label="Period" value={`${rentalDays} ${rentalDays === 1 ? 'day' : 'days'}`} />
                          </div>
                          <SectionTitle>Items</SectionTitle>
                          <div style={{ marginBottom: '1.6rem' }}>
                            {rentalRows.map((r) => (
                              <ReviewRow key={r.id} label={`${r.name} × ${r.qty}`} value={fmtPHP(r.sub)} />
                            ))}
                            <ReviewRow label="Grand Total" value={fmtPHP(rentalTotal)} />
                          </div>
                        </>
                      )}

                      {service === 'menu' && (
                        <>
                          <SectionTitle>Delivery</SectionTitle>
                          <div style={{ marginBottom: '1.6rem' }}>
                            <ReviewRow label="Date" value={schedule.deliveryDate ? fmtLong(schedule.deliveryDate) : ''} />
                            <ReviewRow label="Time" value={schedule.deliveryTime || 'To be finalized'} />
                            <ReviewRow label="Payment" value={PAYMENT_METHODS.find((p) => p.id === payment)?.label ?? ''} />
                          </div>
                          <SectionTitle>Order</SectionTitle>
                          <div style={{ marginBottom: '1.6rem' }}>
                            {dishRows.map((r) => <ReviewRow key={`d${r.id}`} label={`${r.name} × ${r.qty}`} value={fmtPHP(r.sub)} />)}
                            {trayRows.map((r) => <ReviewRow key={`t${r.id}`} label={`${r.name} × ${r.qty} (tray)`} value={fmtPHP(r.sub)} />)}
                            <ReviewRow label="Grand Total" value={fmtPHP(menuTotal)} />
                          </div>
                        </>
                      )}

                      <div
                        style={{
                          background: 'var(--primary-muted)',
                          borderLeft: '3px solid var(--primary)',
                          borderRadius: 'var(--r-lg)',
                          padding: '0.95rem 1.1rem',
                        }}
                      >
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-primary)', lineHeight: 1.6, margin: 0 }}>
                          ✦ Clicking <strong style={{ color: 'var(--primary)', fontWeight: 500 }}>Confirm Booking</strong> shows
                          our terms — nothing is submitted until you agree.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* nav */}
                  <div className="bkg-nav">
                    <button type="button" className="bkg-btn ghost" onClick={back}>
                      {step === 1 ? '← Change Service' : '← Previous'}
                    </button>
                    {step < 4 ? (
                      <button type="button" className="bkg-btn primary" onClick={next} disabled={step === 2 && service === 'event' && dateBooked}>
                        Next →
                      </button>
                    ) : (
                      <button type="button" className="bkg-btn primary" onClick={() => { setAgreed(false); setTermsOpen(true); }}>
                        Confirm Booking →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* footer */}
        <footer style={{ background: 'var(--bg-subtle)', borderTop: '1px solid var(--border)', padding: '3rem 2.5rem', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            © {new Date().getFullYear()} King Jegi Party Need and Catering Services · Calamba, Laguna
          </p>
        </footer>
      </main>

      {/* ═══════════════════════ TERMS MODAL ═══════════════════════ */}
      {termsOpen && (
        <div className="bkg-overlay" onClick={() => setTermsOpen(false)}>
          <div className="bkg-modal" role="dialog" aria-label="Terms and conditions" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                padding: '1.5rem 1.75rem 1.1rem',
                borderBottom: '1px solid var(--border)',
                background: 'linear-gradient(180deg, var(--accent-muted) 0%, var(--surface) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                Terms & <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Conditions</em>
              </h2>
              <button
                type="button"
                onClick={() => setTermsOpen(false)}
                aria-label="Close terms"
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '1.4rem 1.75rem', overflowY: 'auto', flex: 1 }}>
              {[
                ['Reservation', 'Bookings are confirmed within 24 hours by email. A reservation counts only once you receive our official confirmation.'],
                ['Payment', 'A 50% downpayment secures event dates; the balance is due 3 days before the event. Menu and rental orders are settled on delivery.'],
                ['Cancellation', 'Cancel 7+ days ahead to forfeit only the downpayment. One free reschedule is allowed, subject to availability, at least 5 days prior.'],
                ['Equipment', 'Rented items must come back in good condition — damages are charged at replacement cost.'],
                ['Liability', 'We are not liable for delays caused by events beyond our control (weather, regulations, force majeure).'],
              ].map(([t, b]) => (
                <div key={t} style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--primary)', margin: '0 0 0.35rem' }}>{t}</h4>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.65, margin: 0 }}>{b}</p>
                </div>
              ))}
            </div>
            <div style={{ padding: '1.1rem 1.75rem 1.4rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer' }} onClick={() => setAgreed((v) => !v)}>
                <CheckMark on={agreed} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  I have read and agree to the <strong style={{ color: 'var(--primary)', fontWeight: 500 }}>Terms & Conditions</strong> of King Jegi Events & Catering.
                </span>
              </label>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button type="button" className="bkg-btn ghost" style={{ flex: '1 1 130px' }} onClick={() => setTermsOpen(false)}>Cancel</button>
                <button type="button" className="bkg-btn primary" style={{ flex: '1 1 130px' }} disabled={!agreed} onClick={confirm}>Confirm Booking</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ChatWidget />
    </>
  );
}

/* date formatting helpers */
function fmtLong(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}
function fmtShort(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
