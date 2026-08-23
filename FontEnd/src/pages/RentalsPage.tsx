import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/landing/Navbar';
import { readSession } from '../lib/tokenStorage';
import { fetchRentalItems, getFullImageUrl, type AdminRentalItem } from '../api/rentalAdminApi';
import { createBooking, addRental, submitBooking, BookingApiError } from '../api/bookingApi';
import { PhoneNumberInput } from '../components/forms/PhoneNumberInput';
import { VenueAddressFields } from '../components/forms/VenueAddressFields';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  type VenueAddress,
} from '../lib/venue';

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─────────────────────────────────────────────────────────────────────────
   Live catalog from /api/Rentalitems — same anonymous-GET pattern MenuPage
   already uses. Prices and stock are whatever the admin has configured; the
   authoritative availability is still computed server-side at booking time.
───────────────────────────────────────────────────────────────────────── */

type RentalCategory = { id: string; label: string; icon: string };

type RentalItem = {
  id: string;
  name: string;
  category: string;
  pricePerDay: number;
  stock: number;
  description: string;
  image?: string | null;
};

/**
 * The real RentalCategory enum (Models/Rentalitem.cs), lowercased to match the
 * DTO's string form. The icons are presentation only — the backend has no notion
 * of them, so they stay here.
 */
const CATEGORIES: RentalCategory[] = [
  { id: 'chairs', label: 'Chairs', icon: '🪑' },
  { id: 'tables', label: 'Tables', icon: '🎪' },
  { id: 'linens', label: 'Linens', icon: '🧵' },
  { id: 'lights', label: 'Lights', icon: '💡' },
  { id: 'others', label: 'Others', icon: '✨' },
];

const CATEGORY_META = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * The catalog has no description field, so the card copy is derived from the real
 * inventory numbers rather than invented — how many are owned, and how many of
 * those are currently out on other bookings.
 */
const describeItem = (r: AdminRentalItem) => {
  const label = CATEGORY_META.get(r.category.toLowerCase())?.label ?? r.category;
  const out = r.quantityOut > 0 ? `, ${r.quantityOut} currently out on other events` : '';
  return `${label} — ${r.totalQuantity} in our inventory${out}.`;
};

const LOW_STOCK_AT = 10;
const MAX_DAYS = 14;

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

export function RentalsPage() {
  const [category, setCategory] = useState<'all' | string>('all');
  const [days, setDays] = useState(1);
  // Keyed by the catalog's real GUID ids, not the old static numeric ones.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const navigate = useNavigate();

  /* live catalog */
  const [rentals, setRentals] = useState<RentalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCatalog = async () => {
    setLoading(true);
    setLoadError(null);
    const token = readSession()?.token ?? '';   // catalog GETs are anonymous
    try {
      const items = await fetchRentalItems(token);
      setRentals(
        items
          .filter((r) => r.isActive)
          .map((r) => ({
            id: r.id,
            name: r.itemName,
            category: r.category.toLowerCase(),
            pricePerDay: r.unitPrice,
            stock: r.stock,
            description: describeItem(r),
            image: getFullImageUrl(r.imageUrl),
          })),
      );
    } catch {
      setLoadError('Unable to load the rental catalog. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, []);

  const qtyOf = (id: string) => quantities[id] ?? 1;
  const bumpQty = (item: RentalItem, delta: number) =>
    setQuantities((prev) => ({
      ...prev,
      [item.id]: Math.min(item.stock, Math.max(1, (prev[item.id] ?? 1) + delta)),
    }));

  const visible = useMemo(
    () => (category === 'all' ? rentals : rentals.filter((r) => r.category === category)),
    [category, rentals],
  );

  const countFor = (id: 'all' | string) =>
    id === 'all' ? rentals.length : rentals.filter((r) => r.category === id).length;

  /* estimate (display-only — the authoritative total is computed by the backend) */
  const planPieces = useMemo(() => Object.values(plan).reduce((a, b) => a + b, 0), [plan]);
  const planPerDay = useMemo(
    () =>
      Object.entries(plan).reduce((sum, [id, qty]) => {
        const item = rentals.find((r) => r.id === id);
        return sum + (item ? item.pricePerDay * qty : 0);
      }, 0),
    [plan, rentals],
  );

  const addToPlan = (item: RentalItem) => {
    setPlan((prev) => {
      const next = Math.min(item.stock, (prev[item.id] ?? 0) + qtyOf(item.id));
      return { ...prev, [item.id]: next };
    });
    setFlashId(item.id);
    window.setTimeout(() => setFlashId((prev) => (prev === item.id ? null : prev)), 1500);
  };

  /* ── checkout ───────────────────────────────────────────────────────────
     Checks out into a RentalService booking — the type built for exactly this:
     5% reservation fee rather than the flat one, no event-slot consumption, and
     stock re-validated at confirm. The backend treats it as event-shaped, so it
     requires the same event fields FullService does; that's why this form asks
     for more than MenuPage's delivery checkout.
  ───────────────────────────────────────────────────────────────────────── */
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  const [eventType, setEventType] = useState('Wedding');
  const [guests, setGuests] = useState('50');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [address, setAddress] = useState<VenueAddress>(emptyVenueAddress);
  const [contact, setContact] = useState('');

  const planLines = useMemo(
    () =>
      Object.entries(plan)
        .map(([id, qty]) => ({ item: rentals.find((r) => r.id === id), qty }))
        .filter((l): l is { item: RentalItem; qty: number } => Boolean(l.item)),
    [plan, rentals],
  );

  const placeRentalOrder = async () => {
    const session = readSession();
    if (!session) { navigate('/login'); return; }   // creating a booking requires login
    if (planLines.length === 0) { setCheckoutError('Your rental list is empty.'); return; }
    if (!eventDate || !startTime || !endDate || !endTime) {
      setCheckoutError('Please give the delivery date/time and the pickup date/time.');
      return;
    }
    if (new Date(`${endDate}T${endTime}`) <= new Date(`${eventDate}T${startTime}`)) {
      setCheckoutError('Pickup must be after delivery.');
      return;
    }
    if (!isVenueAddressComplete(address)) { setCheckoutError('Please provide a delivery street and city.'); return; }

    setPlacing(true);
    setCheckoutError('');
    try {
      const booking = await createBooking(session.token, {
        customerId: session.user.id,
        bookingType: 'RentalService',
        eventDate,
        startTime: `${startTime}:00`,
        endDate,
        endTime: `${endTime}:00`,
        eventType,
        venueAddress: composeVenueAddress(address),
        guestCount: Number(guests) || 1,
        menuPackageId: null,
        contactNumber: contact.trim() || null,
      });

      for (const line of planLines) {
        await addRental(session.token, booking.id, line.item.id, line.qty);
      }

      await submitBooking(session.token, booking.id);
      setPlan({});
      setCheckoutOpen(false);
      navigate('/dashboard');
    } catch (err) {
      setCheckoutError(
        err instanceof BookingApiError ? err.message : 'Could not place your rental booking. Please try again.',
      );
    } finally {
      setPlacing(false);
    }
  };

  /* Escape closes the checkout */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCheckoutOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        .rnt-estimate-cta { border: none; cursor: pointer; }
        .rnt-estimate-cta:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── checkout modal ── */
        .rnt-overlay {
          position: fixed; inset: 0; z-index: 160;
          background: rgba(20, 14, 8, 0.55);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 1.5rem;
        }
        .rnt-modal {
          width: min(620px, 100%); max-height: 90vh; display: flex; flex-direction: column;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
        }
        .rnt-modal-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 0.8rem;
          padding: 1.2rem 1.5rem; border-bottom: 1px solid var(--border);
        }
        .rnt-modal-eyebrow {
          font-family: var(--font-body); font-size: 0.56rem; font-weight: 500;
          letter-spacing: 0.24em; text-transform: uppercase; color: var(--text-dim);
        }
        .rnt-modal-title {
          font-family: var(--font-display); font-size: 1.3rem; font-weight: 500;
          color: var(--text-primary); margin: 0.2rem 0 0;
        }
        .rnt-modal-close {
          background: transparent; border: none; cursor: pointer;
          color: var(--text-dim); font-size: 0.85rem; line-height: 1;
        }
        .rnt-modal-body { overflow-y: auto; padding: 1.2rem 1.5rem; display: flex; flex-direction: column; gap: 1.2rem; }
        .rnt-modal-foot {
          display: flex; gap: 0.6rem; justify-content: flex-end; flex-wrap: wrap;
          padding: 1rem 1.5rem; border-top: 1px solid var(--border);
        }
        .rnt-lines { display: flex; flex-direction: column; gap: 0.35rem; }
        .rnt-line {
          display: flex; justify-content: space-between; gap: 0.8rem;
          font-family: var(--font-body); font-size: 0.76rem; font-weight: 300; color: var(--text-muted);
        }
        .rnt-line.total {
          border-top: 1px solid var(--border); margin-top: 0.4rem; padding-top: 0.5rem;
          font-weight: 600; color: var(--text-primary);
        }
        .rnt-note {
          font-family: var(--font-body); font-size: 0.68rem; font-weight: 300;
          color: var(--text-dim); line-height: 1.6; margin: 0.4rem 0 0;
        }
        .rnt-form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
        .rnt-form label {
          display: flex; flex-direction: column; gap: 0.25rem;
          font-family: var(--font-body); font-size: 0.62rem; font-weight: 500;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim);
        }
        .rnt-form label.full { grid-column: 1 / -1; }
        /* VenueAddressFields renders label + control as siblings rather than
           nesting the control inside the label, so the stacking and full-width
           sizing that .rnt-form label gave for free is restated here. */
        .rnt-addr-field { display: flex; flex-direction: column; gap: 0.25rem; }
        .rnt-addr-field label {
          font-family: var(--font-body); font-size: 0.62rem; font-weight: 500;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim);
        }
        .rnt-addr-field input, .rnt-addr-field select { width: 100%; box-sizing: border-box; }
        .rnt-form input, .rnt-form select {
          background: var(--bg-subtle); border: 1px solid var(--border);
          border-radius: var(--r-md); padding: 0.55rem 0.7rem;
          font-family: var(--font-body); font-size: 0.8rem; font-weight: 400;
          letter-spacing: normal; text-transform: none; color: var(--text-primary); outline: none;
        }
        .rnt-form input:focus, .rnt-form select:focus {
          border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted);
        }
        .rnt-error {
          font-family: var(--font-body); font-size: 0.76rem; color: var(--danger); margin: 0;
        }
        @media (max-width: 560px) { .rnt-form { grid-template-columns: 1fr; } }

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
            {loading ? (
              <div className="rnt-empty fade-up">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)' }}>
                  Loading our inventory…
                </p>
              </div>
            ) : loadError ? (
              <div className="rnt-empty fade-up">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  Couldn't load the rental catalog
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--danger)', marginBottom: '1.2rem' }}>
                  {loadError}
                </p>
                <button type="button" className="btn-outline" onClick={() => void loadCatalog()}>
                  Try Again
                </button>
              </div>
            ) : visible.length === 0 ? (
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
                      <div
                        className="rnt-tile"
                        style={item.image ? { backgroundImage: `url('${item.image}')`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                      >
                        {!item.image && <span className="icon" aria-hidden="true">{meta?.icon}</span>}
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
          <button type="button" className="rnt-estimate-cta" onClick={() => setCheckoutOpen(true)}>
            Book Rentals →
          </button>
        </div>
      )}

      {/* ═══════════════════════ CHECKOUT ═══════════════════════ */}
      {checkoutOpen && (
        <div className="rnt-overlay" role="dialog" aria-modal="true" aria-label="Book your rentals" onClick={() => setCheckoutOpen(false)}>
          <div className="rnt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rnt-modal-head">
              <div>
                <p className="rnt-modal-eyebrow">Rental Booking</p>
                <h3 className="rnt-modal-title">Delivery &amp; pickup</h3>
              </div>
              <button type="button" className="rnt-modal-close" onClick={() => setCheckoutOpen(false)} aria-label="Close">✕</button>
            </div>

            <div className="rnt-modal-body">
              <div className="rnt-lines">
                {planLines.map((line) => (
                  <div key={line.item.id} className="rnt-line">
                    <span>{line.item.name} × {line.qty}</span>
                    <span>{fmtPHP(line.item.pricePerDay * line.qty * days)}</span>
                  </div>
                ))}
                <div className="rnt-line total">
                  <span>Estimated total · {days} {days === 1 ? 'day' : 'days'}</span>
                  <span>{fmtPHP(planPerDay * days)}</span>
                </div>
                <p className="rnt-note">
                  Final pricing is confirmed by our team. A reservation fee of 5% of the
                  total secures your booking.
                </p>
              </div>

              <div className="rnt-form">
                <label>Delivery date<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
                <label>Delivery time<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
                <label>Pickup date<input type="date" value={endDate} min={eventDate || undefined} onChange={(e) => setEndDate(e.target.value)} /></label>
                <label>Pickup time<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label>
                <label>Event type
                  <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
                    <option>Wedding</option><option>Corporate</option><option>Birthday</option>
                    <option>Debut</option><option>Others</option>
                  </select>
                </label>
                <label>Expected guests<input type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} /></label>
                <VenueAddressFields
                  value={address}
                  onChange={setAddress}
                  fieldClassName="rnt-addr-field"
                  style={{ gridColumn: '1 / -1', gap: '0.8rem' }}
                  labels={{ street: 'Delivery street' }}
                />
                <label className="full">Contact number<PhoneNumberInput value={contact} onChange={setContact} /></label>
              </div>

              {checkoutError && <p className="rnt-error">{checkoutError}</p>}
            </div>

            <div className="rnt-modal-foot">
              <button type="button" className="btn-outline" onClick={() => setCheckoutOpen(false)}>Back</button>
              <button type="button" className="rnt-estimate-cta" disabled={placing} onClick={() => void placeRentalOrder()}>
                {placing ? 'Booking…' : 'Confirm Rental Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
