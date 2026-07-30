import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/landing/Navbar';
import { ChatWidget } from '../components/landing/ChatWidget';
import { PlanByBudget } from '../components/suggestions/PlanByBudget';
import { useAuth } from '../hooks/useAuth';
import { readSession } from '../lib/tokenStorage';
import { fetchPackages, type AdminPackage } from '../api/packageAdminApi';
import { fetchMenuItems, fetchMenuTrays, type AdminMenuItem, type AdminMenuTray } from '../api/menuAdminApi';
import { fetchRentalItems, type AdminRentalItem } from '../api/rentalAdminApi';
import { fetchServiceItems, type AdminServiceItem } from '../api/serviceAdminApi';
import {
  createBooking,
  updateBooking,
  addMenuItem,
  addMenuTray,
  addRental,
  addService,
  chooseSlotItems,
  submitBooking,
  getPackageTemplate,
  setBookingPackage,
  BookingApiError,
  type BookingCreatePayload,
  type BookingUpdatePayload,
  type BookingResponse,
  type PackageTemplateResponse,
} from '../api/bookingApi';
import { getCalendarDays, type CalendarDay } from '../api/calendarApi';

/* ── constants ────────────────────────────────────────────────────────── */

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type EventTypeOption = { value: string; label: string; icon: string };
const EVENT_TYPES: EventTypeOption[] = [
  { value: 'Wedding', label: 'Wedding', icon: '💒' },
  { value: 'Birthday', label: 'Birthday', icon: '🎂' },
  { value: 'Corporate', label: 'Corporate', icon: '🏢' },
  { value: 'Debut', label: 'Debut', icon: '👑' },
  { value: 'Other', label: 'Other', icon: '🎉' },
];

const formatTime12h = (time24: string) => {
  if (!time24) return '';
  const [h, m] = time24.split(':');
  if (!h || !m) return time24;
  let hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour.toString().padStart(2, '0')}:${m} ${ampm}`;
};

type ServiceFlow = 'event' | 'rentals';

/* ── component ────────────────────────────────────────────────────────── */

export function BookingPage() {
  const { user } = useAuth();

  const navigate = useNavigate();

  /* ── wizard state ── */
  const [serviceFlow, setServiceFlow] = useState<ServiceFlow | null>(null);
  const [step, setStep] = useState(0);
  const [planMode, setPlanMode] = useState(false);   // Step-0 "Plan by Budget" card

  // Step 1 — Contact
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [zipCode, setZipCode] = useState('');

  // Step 2 — Event
  const [eventType, setEventType] = useState('');
  const [guests, setGuests] = useState(50);
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');

  /* Real availability for the chosen date, straight from the backend's calendar
     (isLocked = manually locked, or the confirmed count has reached capacity). This
     is advisory here — confirmation is still gated server-side — but it means the
     customer finds out before building a whole booking on an unavailable date. */
  const [dateStatus, setDateStatus] = useState<CalendarDay | null>(null);
  const [dateChecking, setDateChecking] = useState(false);

  // Delivery (rentals/menu flows)

  // API state
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingResponse, setBookingResponse] = useState<BookingResponse | null>(null);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Step 3 — Catalog data
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [menuTrays, setMenuTrays] = useState<AdminMenuTray[]>([]);
  const [rentalItems, setRentalItems] = useState<AdminRentalItem[]>([]);
  const [serviceItems, setServiceItems] = useState<AdminServiceItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Step 3 — Selection mode
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [packageTemplate, setPackageTemplate] = useState<PackageTemplateResponse | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);

  // Package slot selections: slotId → Set of chosen itemIds
  const [slotSelections, setSlotSelections] = useState<Record<string, string[]>>({});

  // À la carte quantity maps
  const [menuItemQty, setMenuItemQty] = useState<Record<string, number>>({});
  const [menuTrayQty, setMenuTrayQty] = useState<Record<string, number>>({});
  const [rentalQty, setRentalQty] = useState<Record<string, number>>({});
  const [serviceQty, setServiceQty] = useState<Record<string, number>>({});
  const [alacarteTab, setAlacarteTab] = useState<'dishes' | 'trays' | 'rentals' | 'services'>('dishes');
  const [dishFilter, setDishFilter] = useState('all');

  // Step 3 → 4 saving
  const [savingSelections, setSavingSelections] = useState(false);

  // Step 4
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Terms
  const [showTerms, setShowTerms] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);

  /* ── prefill from auth ── */
  useEffect(() => {
    if (user) {
      setFullName(user.name || '');
      setEmail(user.email || '');
      if ('phoneNumber' in user && typeof (user as Record<string, unknown>).phoneNumber === 'string') {
        setPhone((user as Record<string, unknown>).phoneNumber as string);
      }
    }
  }, [user]);

  /* ── load catalog on step 3 ── */
  const loadCatalog = useCallback(async () => {
    // The catalog GETs are anonymous (item 1); the login gate lives at
    // handleCreateBooking. Step 3 is only reached post-create, so a token is
    // normally present — fall back to '' so browsing never hard-blocks on it.
    const token = readSession()?.token ?? '';
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [pkgs, items, trays, rentals, services] = await Promise.all([
        fetchPackages(token),
        fetchMenuItems(token),
        fetchMenuTrays(token),
        fetchRentalItems(token),
        fetchServiceItems(token),
      ]);
      setPackages(pkgs);
      setMenuItems(items);
      setMenuTrays(trays);
      setRentalItems(rentals);
      setServiceItems(services);
    } catch {
      setCatalogError('Unable to load the catalog. Please try again.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 3) void loadCatalog();
  }, [step, loadCatalog]);

  /* ── load package template ── */
  const loadTemplate = useCallback(async (pkgId: string) => {
    const session = readSession();
    if (!session || !bookingId) return;
    setTemplateLoading(true);
    setCatalogError(null);
    try {
      // Set the package on the booking
      await setBookingPackage(session.token, bookingId, pkgId);

      // Fetch the template slots
      const tmpl = await getPackageTemplate(session.token, pkgId);
      setPackageTemplate(tmpl);
      // Initialize slot selections
      const initial: Record<string, string[]> = {};
      tmpl.slots.forEach(s => { initial[s.slotId] = []; });
      setSlotSelections(initial);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Unable to load package details. Please try again.');
    } finally {
      setTemplateLoading(false);
    }
  }, [bookingId]);

  /* Look up the chosen date's real calendar state. The endpoint is anonymous, so
     this works for guests browsing before they sign in. A date the backend has no
     row for has never been booked — that's an open date, not an error. */
  useEffect(() => {
    if (!eventDate) {
      setDateStatus(null);
      return;
    }
    let cancelled = false;
    setDateChecking(true);
    getCalendarDays(eventDate, eventDate)
      .then((days) => {
        if (!cancelled) setDateStatus(days.find((d) => d.date === eventDate) ?? null);
      })
      .catch(() => {
        // Advisory only — a failed lookup must never block the form. The server
        // still enforces the real rule at confirmation.
        if (!cancelled) setDateStatus(null);
      })
      .finally(() => {
        if (!cancelled) setDateChecking(false);
      });
    return () => { cancelled = true; };
  }, [eventDate]);

  /* ── derived ── */
  const contactComplete = fullName.trim() && email.trim() && phone.trim();

  // Both remaining flows ('event' and 'rentals') create a FullService booking, so both
  // must supply the fields CreateAsync requires: event type, guests, dates, and times.
  const eventComplete = eventType && guests >= 1 && eventDate && startTime && endDate && endTime;

  const stepLabels = useMemo(() => {
    if (serviceFlow === 'event') return ['Contact', 'Event Details', 'Package & Add‑ons', 'Review'];
    if (serviceFlow === 'rentals') return ['Contact', 'Event Details', 'Rentals & Add‑ons', 'Review'];
    return [];
  }, [serviceFlow]);

  const dishCategories = useMemo(() =>
    [...new Set(menuItems.map(m => m.itemCategory))].filter(Boolean),
  [menuItems]);

  const selectedPkg = packages.find(p => p.id === selectedPackageId);

  const menuItemTotal = Object.entries(menuItemQty).reduce((s, [id, q]) => {
    const item = menuItems.find(m => m.id === id);
    return s + (item?.pricePerTray ?? 0) * q;
  }, 0);
  const menuTrayTotal = Object.entries(menuTrayQty).reduce((s, [id, q]) => {
    const tray = menuTrays.find(t => t.id === id);
    return s + (tray?.pricePerTray ?? 0) * q;
  }, 0);
  const rentalTotal = Object.entries(rentalQty).reduce((s, [id, q]) => {
    const item = rentalItems.find(r => r.id === id);
    return s + (item?.unitPrice ?? 0) * q;
  }, 0);
  const serviceTotal = Object.entries(serviceQty).reduce((s, [id, q]) => {
    const item = serviceItems.find(si => si.id === id);
    return s + (item?.unitCost ?? 0) * q;
  }, 0);
  let packageBaseCost = 0;
  let packageOverageCost = 0;
  let packageOverageGuests = 0;
  if (selectedPkg) {
    packageBaseCost = selectedPkg.basePrice;
    if (guests > selectedPkg.maxPax) {
      packageOverageGuests = guests - selectedPkg.maxPax;
      packageOverageCost = packageOverageGuests * selectedPkg.pricePerExtraPax;
    }
  }
  const packagePrice = packageBaseCost + packageOverageCost;
  const grandTotal = packagePrice + menuItemTotal + menuTrayTotal + rentalTotal + serviceTotal;

  /* ── quantity helpers ── */

  /**
   * Delta setter for the +/- buttons. The snap-to-baseQty behaviour is deliberate:
   * the first "+" jumps straight to the sensible serving quantity rather than 1, and
   * a "−" from exactly that quantity clears the line entirely.
   */
  const setQty = (setter: React.Dispatch<React.SetStateAction<Record<string, number>>>, id: string, delta: number, baseQty: number = 1) => {
    setter(prev => {
      const current = prev[id] ?? 0;
      let next = current + delta;
      if (current === 0 && delta > 0) next = baseQty;
      else if (current === baseQty && delta < 0) next = 0;
      if (next <= 0) { const c = { ...prev }; delete c[id]; return c; }
      return { ...prev, [id]: next };
    });
  };

  /**
   * Absolute setter for typed input. Deliberately NOT setQty with a computed delta:
   * that one snaps to baseQty, which would fight the user mid-keystroke (typing "2"
   * over a base of 10 would jump to 10). Non-numeric or negative input clears the
   * line, and 0 deletes the map entry exactly as setQty does — so a quantity of zero
   * is never persisted as a real line.
   */
  const setQtyExact = (setter: React.Dispatch<React.SetStateAction<Record<string, number>>>, id: string, raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setter(prev => {
      if (next <= 0) { const c = { ...prev }; delete c[id]; return c; }
      return { ...prev, [id]: next };
    });
  };

  const toggleSlotItem = (slotId: string, itemId: string, chooseCount: number) => {
    setSlotSelections(prev => {
      const current = prev[slotId] ?? [];
      if (current.includes(itemId)) {
        return { ...prev, [slotId]: current.filter(id => id !== itemId) };
      }
      if (current.length >= chooseCount) {
        // replace oldest
        return { ...prev, [slotId]: [...current.slice(1), itemId] };
      }
      return { ...prev, [slotId]: [...current, itemId] };
    });
  };

  /* ── Step 2 → 3: create booking ── */
  const handleCreateBooking = async () => {
    const session = readSession();
    if (!session || !user) { setApiError('Please sign in.'); return; }
    
    if (user.role === 'admin') {
      setApiError('Admins cannot book events through this customer page. Please log out and create a customer account to test this feature.');
      return;
    }

    setCreatingBooking(true);
    setApiError(null);

    const venueAddress = [streetAddress, city, zipCode].filter(Boolean).join(', ');

    const payload: BookingCreatePayload = {
      customerId: user.id,
      // 'rentals' is FullService too — a rental line can't sit on a FoodDelivery booking
      // (EnsureNotDeliveryAsync). Both flows now send the full event fields.
      bookingType: 'FullService',
      eventDate,
      startTime: startTime + ':00',
      endDate: endDate || null,
      endTime: endTime ? endTime + ':00' : null,
      eventType,
      venueAddress: venueAddress || 'To be provided',
      guestCount: guests,
      contactNumber: phone || null,
    };

    try {
      if (bookingId && bookingResponse) {
        let currentPkgId = bookingResponse.menuPackageId || null;
        if (currentPkgId && serviceFlow === 'event') {
          const pkg = packages.find(p => p.id === currentPkgId);
          if (pkg && guests < pkg.minPax) {
            currentPkgId = null;
            setSelectedPackageId(null);
            setSlotSelections({});
          }
        }

        const updatePayload: BookingUpdatePayload = {
          bookingName: bookingResponse.bookingName,
          eventDate: payload.eventDate,
          startTime: payload.startTime,
          endDate: payload.endDate,
          endTime: payload.endTime,
          eventType: payload.eventType,
          venueAddress: payload.venueAddress,
          guestCount: payload.guestCount,
          menuPackageId: currentPkgId,
          contactNumber: payload.contactNumber,
        };
        const result = await updateBooking(session.token, bookingId, updatePayload);
        setBookingResponse(result);
        setStep(3);
      } else {
        const result = await createBooking(session.token, payload);
        setBookingId(result.id);
        setBookingResponse(result);
        setStep(3);
      }
    } catch (err) {
      setApiError(err instanceof BookingApiError ? err.message : 'Failed to save booking.');
    } finally {
      setCreatingBooking(false);
    }
  };

  /* ── Step 3 → 4: save selections ── */
  const handleSaveSelections = async () => {
    if (!bookingId) return;
    const session = readSession();
    if (!session) return;

    setSavingSelections(true);
    setApiError(null);

    try {
      if (selectedPackageId && packageTemplate) {
        // Save package slot selections
        for (const slot of packageTemplate.slots) {
          const chosen = slotSelections[slot.slotId] ?? [];
          if (chosen.length === slot.chooseCount) {
            await chooseSlotItems(session.token, bookingId, slot.slotId, chosen);
          }
        }
      }
      
      // Save à la carte items one by one
      for (const [id, qty] of Object.entries(menuItemQty)) {
        await addMenuItem(session.token, bookingId, id, qty);
      }
      for (const [id, qty] of Object.entries(menuTrayQty)) {
        await addMenuTray(session.token, bookingId, id, qty);
      }
      for (const [id, qty] of Object.entries(rentalQty)) {
        await addRental(session.token, bookingId, id, qty);
      }
      for (const [id, qty] of Object.entries(serviceQty)) {
        await addService(session.token, bookingId, id, qty);
      }
      setStep(4);
    } catch (err) {
      setApiError(err instanceof BookingApiError ? err.message : 'Failed to save selections.');
    } finally {
      setSavingSelections(false);
    }
  };

  /* ── Step 4: submit ── */
  const handleSubmit = async () => {
    if (!bookingId) return;
    const session = readSession();
    if (!session) return;

    setSubmitting(true);
    setApiError(null);
    try {
      await submitBooking(session.token, bookingId);
      setSubmitted(true);
    } catch (err) {
      setApiError(err instanceof BookingApiError ? err.message : 'Failed to submit booking.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── navigation helpers ── */
  const pickService = (flow: ServiceFlow) => { setServiceFlow(flow); setStep(1); };

  const today = new Date().toISOString().split('T')[0];

  /* ── can proceed checks ── */
  const allSlotsComplete = packageTemplate
    ? packageTemplate.slots.every(s => (slotSelections[s.slotId]?.length ?? 0) === s.chooseCount)
    : false;

  const hasAlacarteItems = Object.keys(menuItemQty).length > 0
    || Object.keys(menuTrayQty).length > 0
    || Object.keys(rentalQty).length > 0
    || Object.keys(serviceQty).length > 0;

  const canProceedStep3 =
    (selectedPackageId ? allSlotsComplete : true) && (hasAlacarteItems || !!selectedPackageId);

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        /* ── blobs & animation ── */
        .blob { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.18; pointer-events: none; animation: blobDrift 18s ease-in-out infinite alternate; }
        .blob-primary { background: var(--primary); }
        .blob-accent { background: var(--accent); }
        @keyframes blobDrift { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-20px) scale(1.08); } 100% { transform: translate(-20px,15px) scale(0.95); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.7s ease both; }

        /* ── page layout ── */
        .bk-container{max-width:880px;margin:0 auto}

        /* ── stepper ── */
        .bk-stepper{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:2.5rem;flex-wrap:wrap}
        .bk-step-item{display:flex;align-items:center;gap:.55rem;font-family:var(--font-body);font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;font-weight:500;color:var(--text-dim);transition:color .3s}
        .bk-step-item.active{color:var(--primary)}
        .bk-step-item.done{color:var(--primary);opacity:.7}
        .bk-step-num{width:30px;height:30px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:.78rem;font-weight:600;background:var(--surface);border:2px solid var(--border);color:var(--text-dim);transition:all .3s}
        .bk-step-item.active .bk-step-num{background:var(--primary);border-color:var(--primary);color:var(--primary-text)}
        .bk-step-item.done .bk-step-num{background:var(--primary-muted);border-color:var(--primary);color:var(--primary)}
        .bk-step-line{width:48px;height:2px;background:var(--border);margin:0 .4rem;border-radius:1px;transition:background .3s}
        .bk-step-line.done{background:var(--primary)}

        /* ── card ── */
        .bk-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:2rem 2.25rem;box-shadow:var(--shadow-md);transition:border-color .25s,box-shadow .25s,transform .25s}
        .bk-card:hover{border-color:var(--border-accent);box-shadow:var(--shadow-lg)}
        .bk-heading{font-family:var(--font-display);font-size:1.5rem;font-weight:600;color:var(--text-primary);margin:0 0 .35rem}
        .bk-sub{font-family:var(--font-body);font-size:.8rem;font-weight:300;color:var(--text-muted);margin:0 0 1.6rem}

        /* ── form ── */
        .bk-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem}
        @media(max-width:600px){.bk-grid{grid-template-columns:1fr}}
        .bk-grid-3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:1.1rem}
        @media(max-width:600px){.bk-grid-3{grid-template-columns:1fr}}
        .bk-field{display:flex;flex-direction:column;gap:.35rem}
        .bk-field.full{grid-column:1/-1}
        .bk-label{font-family:var(--font-body);font-size:.58rem;letter-spacing:.22em;text-transform:uppercase;font-weight:500;color:var(--text-dim)}
        .bk-input{background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--r-lg);padding:.72rem 1rem;font-family:var(--font-body);font-size:.85rem;font-weight:300;color:var(--text-primary);outline:none;transition:border-color .2s,box-shadow .2s}
        .bk-input:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-muted)}
        .bk-input::placeholder{color:var(--text-dim)}

        /* ── event type cards ── */
        .bk-type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:.75rem}
        .bk-type-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:1.1rem .7rem;display:flex;flex-direction:column;align-items:center;gap:.35rem;cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s;text-align:center}
        .bk-type-card:hover{border-color:var(--border-accent);transform:translateY(-3px);box-shadow:var(--shadow-md)}
        .bk-type-card.active{border-color:var(--primary);background:var(--primary-muted);box-shadow:0 0 0 3px var(--primary-muted),var(--shadow-md)}
        .bk-type-icon{font-size:1.5rem}
        .bk-type-label{font-family:var(--font-body);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;font-weight:500;color:var(--text-primary)}

        /* ── buttons ── */
        .bk-nav{display:flex;justify-content:space-between;gap:1rem;margin-top:1.8rem}
        .bk-btn{font-family:var(--font-body);font-size:.64rem;letter-spacing:.18em;text-transform:uppercase;font-weight:500;padding:.85rem 1.4rem;border-radius:var(--r-full);border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:.45rem;transition:all .25s}
        .bk-btn:disabled{opacity:.4;cursor:not-allowed}
        .bk-btn.primary{background:var(--primary);color:var(--primary-text);border-color:var(--primary)}
        .bk-btn.primary:hover:not(:disabled){background:var(--primary-hover);transform:translateY(-2px);box-shadow:var(--shadow-green)}
        .bk-btn.outline{background:transparent;color:var(--primary);border-color:var(--border-accent)}
        .bk-btn.outline:hover:not(:disabled){background:var(--primary-muted);border-color:var(--primary);transform:translateY(-2px)}
        .bk-btn.danger{background:var(--danger);color:#fff;border-color:var(--danger)}

        /* ── mode cards ── */
        .bk-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.2rem 0}
        @media(max-width:600px){.bk-mode-grid{grid-template-columns:1fr}}
        .bk-mode-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:1.6rem 1.4rem;cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s;text-align:center}
        .bk-mode-card:hover{border-color:var(--border-accent);transform:translateY(-3px);box-shadow:var(--shadow-md)}
        .bk-mode-card.active{border-color:var(--primary);background:var(--primary-muted);box-shadow:0 0 0 3px var(--primary-muted),var(--shadow-md)}
        .bk-mode-icon{font-size:2.2rem;margin-bottom:.6rem}
        .bk-mode-title{font-family:var(--font-display);font-size:1.1rem;font-weight:600;color:var(--text-primary);margin-bottom:.3rem}
        .bk-mode-desc{font-family:var(--font-body);font-size:.75rem;color:var(--text-muted)}

        /* ── catalog cards ── */
        .bk-catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;margin-top:1rem}
        .bk-catalog-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:1.1rem;cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s}
        .bk-catalog-card:hover{border-color:var(--border-accent);transform:translateY(-3px);box-shadow:var(--shadow-md)}
        .bk-catalog-card.selected{border-color:var(--primary);background:var(--primary-muted);box-shadow:0 0 0 3px var(--primary-muted),var(--shadow-md)}
        .bk-catalog-name{font-family:var(--font-display);font-size:.95rem;font-weight:600;color:var(--text-primary);margin-bottom:.3rem}
        .bk-catalog-meta{font-family:var(--font-body);font-size:.72rem;color:var(--text-muted)}
        .bk-catalog-price{font-family:var(--font-display);font-size:1rem;font-weight:600;color:var(--primary);margin-top:.4rem}

        /* ── tabs ── */
        .bk-tabs{display:flex;gap:.5rem;margin-bottom:1.2rem;flex-wrap:wrap}
        .bk-tab{font-family:var(--font-body);font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;font-weight:500;padding:.5rem 1rem;border-radius:var(--r-full);border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all .25s}
        .bk-tab:hover{border-color:var(--border-accent);color:var(--primary)}
        .bk-tab.active{background:var(--primary);color:var(--primary-text);border-color:var(--primary)}

        /* ── qty stepper ── */
        .bk-qty{display:flex;align-items:center;border:1px solid var(--border);border-radius:var(--r-full);background:var(--bg-subtle);overflow:hidden;margin-top:.5rem;width:fit-content}
        .bk-qty-btn{border:none;background:transparent;cursor:pointer;width:26px;height:26px;line-height:1;color:var(--primary);font-size:.9rem;font-weight:600;display:flex;align-items:center;justify-content:center;transition:background .15s}
        .bk-qty-btn:hover{background:var(--primary-muted)}
        /* Typable quantity. Sits flush between the +/- buttons, so it drops the input's
           own chrome (border/background/spinners) and inherits the pill's styling. */
        .bk-qty-val{width:38px;min-width:38px;text-align:center;font-family:var(--font-body);font-size:.72rem;font-weight:500;color:var(--text-primary);background:transparent;border:none;outline:none;padding:0;-moz-appearance:textfield;appearance:textfield}
        .bk-qty-val::-webkit-outer-spin-button,.bk-qty-val::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        .bk-qty-val:focus{background:var(--surface);border-radius:var(--r-sm);box-shadow:0 0 0 2px var(--primary-muted)}

        /* ── slot selection ── */
        .bk-slot-section{margin-top:1.5rem;padding:1.2rem;border:1px solid var(--border);border-radius:var(--r-xl);background:var(--bg-subtle)}
        .bk-slot-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem}
        .bk-slot-title{font-family:var(--font-display);font-size:1rem;font-weight:600;color:var(--text-primary)}
        .bk-slot-badge{font-family:var(--font-body);font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;padding:.25rem .6rem;border-radius:var(--r-full);background:var(--primary-muted);color:var(--primary);font-weight:500}
        .bk-slot-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.6rem}
        .bk-slot-item{padding:.7rem;border:1px solid var(--border);border-radius:var(--r-lg);cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s;background:var(--surface)}
        .bk-slot-item:hover{border-color:var(--border-accent);transform:translateY(-2px);box-shadow:var(--shadow-md)}
        .bk-slot-item.chosen{border-color:var(--primary);background:var(--primary-muted);box-shadow:0 0 0 2px var(--primary-muted)}
        .bk-slot-item-name{font-family:var(--font-body);font-size:.8rem;font-weight:500;color:var(--text-primary)}
        .bk-slot-item-cat{font-family:var(--font-body);font-size:.65rem;color:var(--text-muted)}

        /* ── service flow picker ── */
        .bk-flow-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem;margin:2rem 0}
        @media(max-width:700px){.bk-flow-grid{grid-template-columns:1fr}}
        .bk-flow-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:2.2rem 1.5rem;cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s;text-align:center;display:flex;flex-direction:column;align-items:center}
        .bk-flow-card:hover{border-color:var(--border-accent);transform:translateY(-4px);box-shadow:var(--shadow-lg)}
        .bk-flow-icon{font-size:2.5rem;margin-bottom:.8rem;filter:saturate(0.85);transition:transform .4s}
        .bk-flow-card:hover .bk-flow-icon{transform:scale(1.12)}
        .bk-flow-title{font-family:var(--font-display);font-size:1.2rem;font-weight:600;color:var(--text-primary);margin-bottom:.4rem}
        .bk-flow-desc{font-family:var(--font-body);font-size:.78rem;color:var(--text-muted);line-height:1.6}

        /* ── error/feedback ── */
        .bk-error{padding:.9rem 1rem;border:1px solid var(--danger);color:var(--danger);border-radius:var(--r-lg);margin-bottom:1rem;font-family:var(--font-body);font-size:.8rem}
        .bk-success-card{text-align:center;padding:3rem 2rem}
        .bk-success-icon{font-size:3.5rem;margin-bottom:1rem}
        .bk-success-title{font-family:var(--font-display);font-size:1.8rem;font-weight:600;color:var(--primary);margin-bottom:.5rem}
        .bk-success-sub{font-family:var(--font-body);font-size:.85rem;color:var(--text-muted);max-width:440px;margin:0 auto}

        /* ── review sections ── */
        .bk-review-section{margin-bottom:1.5rem}
        .bk-review-title{font-family:var(--font-display);font-size:1.05rem;font-weight:600;color:var(--text-primary);margin-bottom:.6rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)}
        .bk-review-row{display:flex;justify-content:space-between;padding:.35rem 0;font-family:var(--font-body);font-size:.8rem}
        .bk-review-label{color:var(--text-muted);font-weight:300}
        .bk-review-value{color:var(--text-primary);font-weight:500;text-align:right}
        .bk-review-total{display:flex;justify-content:space-between;padding:.8rem 0;font-family:var(--font-display);font-size:1.2rem;font-weight:600;border-top:2px solid var(--primary);margin-top:.5rem;color:var(--primary)}

        /* ── loading ── */
        .bk-loading{text-align:center;padding:2rem;color:var(--text-muted);font-family:var(--font-body);font-size:.85rem}
        .bk-spinner{display:inline-block;width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:bk-spin .6s linear infinite;margin-right:.5rem;vertical-align:middle}
        @keyframes bk-spin{to{transform:rotate(360deg)}}

        /* ── terms overlay ── */
        .bk-terms-overlay{position:fixed;inset:0;background:rgba(20,14,8,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem}
        .bk-terms-panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);max-width:600px;width:100%;max-height:80vh;overflow-y:auto;padding:2rem 2.25rem;box-shadow:var(--shadow-lg)}
        .bk-terms-panel h3{font-family:var(--font-display);font-size:1.3rem;margin-bottom:1rem;color:var(--text-primary)}
        .bk-terms-panel p,.bk-terms-panel li{font-family:var(--font-body);font-size:.78rem;color:var(--text-muted);line-height:1.7}
        .bk-terms-panel ol{padding-left:1.3rem;margin:.8rem 0}

        /* ── filter ── */
        .bk-filter-row{display:flex;align-items:center;gap:.8rem;margin-bottom:1rem}
        .bk-select{background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--r-full);padding:.5rem .8rem;font-family:var(--font-body);font-size:.78rem;color:var(--text-primary);outline:none;transition:border-color .2s}
        .bk-select:focus{border-color:var(--primary)}
      `}</style>

      <Navbar activePage="quotation" />

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>
        
        {/* ═══════════════════════ HERO (STEP 0) ═══════════════════════ */}
        {step === 0 && !submitted && (
          <section style={{ padding: '6rem 0', position: 'relative', paddingTop: 'calc(6rem + 80px)', paddingBottom: '4rem', overflow: 'hidden' }}>
            <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
            <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />
            
            <div className="fade-up" style={{ maxWidth: 880, margin: '0 auto', padding: '0 2.5rem', position: 'relative' }}>
              {!planMode ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', background: 'var(--accent-muted)', border: '1px solid var(--border-accent)', padding: '0.35rem 1rem', marginBottom: '1.5rem' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 500 }}>
                      Start Here
                    </span>
                  </div>
                  <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)', fontWeight: 400, lineHeight: 1.08, color: 'var(--text-primary)', marginBottom: '1.5rem' }}>
                    Book Your <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Experience</em>
                  </h1>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1.75, maxWidth: 520, margin: '0 auto 2.5rem', fontWeight: 300 }}>
                    Choose the service that fits your occasion. We'll guide you through every detail.
                  </p>

                  <div className="bk-flow-grid">
                    <div className="bk-flow-card" onClick={() => pickService('event')}>
                      <div className="bk-flow-icon">🎉</div>
                      <div className="bk-flow-title">Full Event Catering</div>
                      <div className="bk-flow-desc">Complete event packages with staff, styling, and curated menus for any occasion.</div>
                    </div>
                    <div className="bk-flow-card" onClick={() => pickService('rentals')}>
                      <div className="bk-flow-icon">🪑</div>
                      <div className="bk-flow-title">Rental Items Only</div>
                      <div className="bk-flow-desc">Tables, chairs, linens, and decor — delivered to your venue.</div>
                    </div>
                    <div className="bk-flow-card" onClick={() => setPlanMode(true)}>
                      <div className="bk-flow-icon">💡</div>
                      <div className="bk-flow-title">Plan by Budget</div>
                      <div className="bk-flow-desc">Tell us your budget — we'll suggest complete, kitchen-priced options you can book.</div>
                    </div>
                  </div>
                </div>
              ) : (
                <PlanByBudget
                  onBack={() => setPlanMode(false)}
                  onRequireLogin={() => navigate('/login')}
                  onMaterialized={(bookingId) => navigate('/dashboard', { state: { pendingDraftId: bookingId } })}
                />
              )}
            </div>
          </section>
        )}

        {/* ═══════════════════════ MAIN CONTENT (STEPS 1-4 & SUCCESS) ═══════════════════════ */}
        {(step >= 1 || submitted) && (
          <section style={{ background: 'var(--bg-subtle)', padding: '3.5rem 0 6rem', minHeight: 'calc(100vh - 6rem)' }}>
            <div className="bk-container" style={{ padding: '0 1.5rem' }}>

              {/* ═══════ SUBMITTED SUCCESS ═══════ */}
          {submitted && (
            <div className="bk-card bk-success-card">
              <div className="bk-success-icon">✅</div>
              <div className="bk-success-title">Booking Submitted!</div>
              <p className="bk-success-sub">
                Your booking has been submitted for review. Our team will reach out to confirm the details.
                You can track your booking status in your dashboard.
              </p>
              <div style={{ marginTop: '1.5rem' }}>
                <button className="bk-btn outline" onClick={() => { setStep(0); setServiceFlow(null); setSubmitted(false); setBookingId(null); }}>
                  Book Another
                </button>
              </div>
            </div>
          )}

          {/* ── STEPPER ── */}
          {step >= 1 && !submitted && (
            <div className="bk-stepper">
              {stepLabels.map((label, i) => {
                const num = i + 1;
                const cls = step === num ? 'active' : step > num ? 'done' : '';
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                    {i > 0 && <div className={`bk-step-line${step >= num ? ' done' : ''}`} />}
                    <div className={`bk-step-item ${cls}`}>
                      <span className="bk-step-num">{step > num ? '✓' : num}</span>
                      <span>{label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {apiError && step >= 1 && !submitted && (
            <div className="bk-error">{apiError}</div>
          )}

          {/* ═══════ STEP 1 — CONTACT ═══════ */}
          {step === 1 && !submitted && (
            <div className="bk-card">
              <h2 className="bk-heading">Contact Details</h2>
              <p className="bk-sub">Let us know how to reach you for your event.</p>

              <div className="bk-grid">
                <div className="bk-field">
                  <label className="bk-label">Full Name</label>
                  <input className="bk-input" placeholder="Juan Dela Cruz" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div className="bk-field">
                  <label className="bk-label">Email Address</label>
                  <input className="bk-input" type="email" placeholder="juan@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="bk-field">
                  <label className="bk-label">Phone Number</label>
                  <input 
                    className="bk-input" 
                    type="tel" 
                    placeholder="+63 000-000-0000" 
                    value={phone} 
                    onChange={e => {
                      let val = e.target.value.replace(/\D/g, '');
                      if (val.startsWith('63')) val = val.substring(2);
                      else if (val.startsWith('0')) val = val.substring(1);
                      
                      if (val.length === 0) setPhone('');
                      else if (val.length <= 3) setPhone(`+63 ${val}`);
                      else if (val.length <= 6) setPhone(`+63 ${val.substring(0,3)}-${val.substring(3)}`);
                      else setPhone(`+63 ${val.substring(0,3)}-${val.substring(3,6)}-${val.substring(6,10)}`);
                    }} 
                  />
                </div>
              </div>

              <div style={{ marginTop: '1.2rem' }}>
                <label className="bk-label" style={{ marginBottom: '.6rem', display: 'block' }}>
                  Venue Address
                </label>
                <div className="bk-grid-3">
                  <div className="bk-field">
                    <label className="bk-label">Street</label>
                    <input className="bk-input" placeholder="123 Main St." value={streetAddress} onChange={e => setStreetAddress(e.target.value)} />
                  </div>
                  <div className="bk-field">
                    <label className="bk-label">City</label>
                    <select className="bk-input" value={city} onChange={e => setCity(e.target.value)}>
                      <option value="" disabled>Select a city</option>
                      <option value="Calamba">Calamba</option>
                      <option value="Cabuyao">Cabuyao</option>
                      <option value="Santa Rosa">Santa Rosa</option>
                      <option value="Los Banos">Los Baños</option>
                    </select>
                    <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>Currently catering to the Laguna area only</div>
                  </div>
                  <div className="bk-field">
                    <label className="bk-label">Zip Code</label>
                    <input className="bk-input" placeholder="1100" value={zipCode} onChange={e => setZipCode(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="bk-nav">
                <button className="bk-btn outline" onClick={() => { setStep(0); setServiceFlow(null); }}>← Change Service</button>
                <button className="bk-btn primary" disabled={!contactComplete} onClick={() => setStep(2)}>
                  Next → Event Details
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 2 — EVENT / DELIVERY ═══════ */}
          {step === 2 && !submitted && (
            <div className="bk-card">
              <h2 className="bk-heading">Event Details</h2>
              <p className="bk-sub">
                {serviceFlow === 'rentals'
                  ? 'Tell us about the event your rentals are for so we can schedule delivery and pickup.'
                  : 'Tell us about your celebration so we can prepare the perfect setup.'}
              </p>

              <div className="bk-field full" style={{ marginBottom: '1.2rem' }}>
                <label className="bk-label">Event Type</label>
                <div className="bk-type-grid">
                  {EVENT_TYPES.map(t => (
                    <div key={t.value} className={`bk-type-card${eventType === t.value ? ' active' : ''}`} onClick={() => setEventType(t.value)}>
                      <span className="bk-type-icon">{t.icon}</span>
                      <span className="bk-type-label">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bk-grid">
                <div className="bk-field">
                  <label className="bk-label">Expected Guests</label>
                  <input className="bk-input" type="number" min={1} value={guests} onChange={e => setGuests(Number(e.target.value) || 1)} />
                </div>
                <div className="bk-field">
                  <label className="bk-label">Event Date</label>
                  <input className="bk-input" type="date" min={today} value={eventDate} onChange={e => setEventDate(e.target.value)} />
                  {dateChecking && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem', display: 'block' }}>
                      Checking availability…
                    </span>
                  )}
                  {!dateChecking && dateStatus?.isLocked && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 400, color: 'var(--danger)', marginTop: '0.3rem', display: 'block' }}>
                      {dateStatus.isManuallyLocked
                        ? 'This date is closed for bookings. Please choose another.'
                        : `This date is fully booked (${dateStatus.confirmedCount} of ${dateStatus.maxCapacity} events). Please choose another.`}
                    </span>
                  )}
                  {!dateChecking && dateStatus && !dateStatus.isLocked && dateStatus.confirmedCount > 0 && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem', display: 'block' }}>
                      {dateStatus.maxCapacity - dateStatus.confirmedCount} of {dateStatus.maxCapacity} slots still open on this date.
                    </span>
                  )}
                </div>
                <div className="bk-field">
                  <label className="bk-label">Start Time</label>
                  <input className="bk-input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                </div>
                <div className="bk-field">
                  <label className="bk-label">End Date</label>
                  <input className="bk-input" type="date" min={eventDate || today} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <div className="bk-field">
                  <label className="bk-label">End Time</label>
                  <input className="bk-input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
              </div>

              <div className="bk-nav">
                <button className="bk-btn outline" onClick={() => setStep(1)}>← Back</button>
                <button
                  className="bk-btn primary"
                  disabled={!eventComplete || creatingBooking}
                  onClick={handleCreateBooking}
                >
                  {creatingBooking ? <><span className="bk-spinner" /> Creating…</> : 'Next → Rentals & Add‑ons'}
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 3 — SELECTIONS ═══════ */}
          {step === 3 && !submitted && (
            <div className="bk-card">
              <h2 className="bk-heading">
                {serviceFlow === 'event' ? 'Package & Add‑ons' : 'Rentals & Add‑ons'}
              </h2>
              <p className="bk-sub">
                {serviceFlow === 'event'
                  ? 'Choose a curated package or build your own à la carte selection.'
                  : serviceFlow === 'rentals'
                  ? 'Select the items you need for your event.'
                  : 'Pick dishes and trays for your delivery.'}
              </p>

              {catalogLoading ? (
                <div className="bk-loading"><span className="bk-spinner" /> Loading catalog…</div>
              ) : catalogError ? (
                <div className="bk-error">{catalogError}</div>
              ) : (
                <>

                  {/* ── PACKAGE PATH ── */}
                  {serviceFlow === 'event' && (
                    <div style={{ marginBottom: '2rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>Select a Package</h3>
                        {selectedPackageId && (
                          <button className="bk-btn outline" style={{ fontSize: '.55rem', padding: '.4rem .8rem' }} onClick={() => { setSelectedPackageId(null); setPackageTemplate(null); }}>Clear Selection</button>
                        )}
                      </div>

                      <div className="bk-catalog-grid">
                        {packages.map(pkg => {
                          const isEligible = guests >= pkg.minPax;
                          return (
                            <div
                              key={pkg.id}
                              className={`bk-catalog-card${selectedPackageId === pkg.id ? ' selected' : ''}`}
                              style={!isEligible ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                              onClick={() => { 
                                if (!isEligible) return;
                                setSelectedPackageId(pkg.id); 
                                void loadTemplate(pkg.id); 
                              }}
                            >
                              <div className="bk-catalog-name">{pkg.packageName}</div>
                              <div className="bk-catalog-meta">{pkg.minPax}–{pkg.maxPax} pax</div>
                              {!isEligible && <div style={{ fontSize: '.65rem', color: '#ff4d4f', marginTop: '.25rem', fontWeight: 500 }}>Requires at least {pkg.minPax} guests</div>}
                              <div className="bk-catalog-meta" style={{ marginTop: '.2rem' }}>{pkg.description}</div>
                              <div className="bk-catalog-price">{fmtPHP(pkg.basePrice)}</div>
                              {pkg.inclusions.length > 0 && (
                                <div style={{ marginTop: '.5rem', display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                                  {pkg.inclusions.map((inc, i) => (
                                    <span key={i} style={{ fontSize: '.6rem', padding: '.15rem .4rem', background: 'var(--primary-muted)', color: 'var(--primary)', borderRadius: '4px', fontFamily: 'var(--font-body)' }}>{inc}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Slot selections */}
                      {templateLoading && <div className="bk-loading" style={{ marginTop: '1rem' }}><span className="bk-spinner" /> Loading package details…</div>}

                      {packageTemplate && selectedPackageId && !templateLoading && (
                        <div style={{ marginTop: '1.5rem' }}>
                          {packageTemplate.fixedItems.length > 0 && (
                            <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: '.6rem', letterSpacing: '.15em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--text-dim)', marginBottom: '.5rem' }}>Always Included</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                                {packageTemplate.fixedItems.map(fi => (
                                  <span key={fi.id} style={{ fontSize: '.72rem', padding: '.25rem .6rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', fontFamily: 'var(--font-body)', color: 'var(--text-primary)' }}>{fi.itemName}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {packageTemplate.slots.map(slot => {
                            const chosen = slotSelections[slot.slotId] ?? [];
                            return (
                              <div key={slot.slotId} className="bk-slot-section">
                                <div className="bk-slot-header">
                                  <span className="bk-slot-title">{slot.label}</span>
                                  <span className="bk-slot-badge">
                                    Choose {slot.chooseCount} • {chosen.length}/{slot.chooseCount} selected
                                  </span>
                                </div>
                                <div className="bk-slot-items">
                                  {slot.eligibleItems.map(item => (
                                    <div
                                      key={item.id}
                                      className={`bk-slot-item${chosen.includes(item.id) ? ' chosen' : ''}`}
                                      onClick={() => toggleSlotItem(slot.slotId, item.id, slot.chooseCount)}
                                    >
                                      <div className="bk-slot-item-name">{item.itemName}</div>
                                      <div className="bk-slot-item-cat">{item.itemCategory} · {item.courseCategory}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── À LA CARTE PATH ── */}
                  <div>
                    {serviceFlow === 'event' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>À la Carte</h3>
                      </div>
                    )}

                      {/* Tabs */}
                      <div className="bk-tabs">
                        {serviceFlow === 'event' && (
                          <>
                            <button className={`bk-tab${alacarteTab === 'dishes' ? ' active' : ''}`} onClick={() => setAlacarteTab('dishes')}>Dishes</button>
                            <button className={`bk-tab${alacarteTab === 'trays' ? ' active' : ''}`} onClick={() => setAlacarteTab('trays')}>Trays</button>
                          </>
                        )}
                        {(serviceFlow === 'event' || serviceFlow === 'rentals') && (
                          <button className={`bk-tab${alacarteTab === 'rentals' ? ' active' : ''}`} onClick={() => setAlacarteTab('rentals')}>Rentals</button>
                        )}
                        {serviceFlow === 'event' && (
                          <button className={`bk-tab${alacarteTab === 'services' ? ' active' : ''}`} onClick={() => setAlacarteTab('services')}>Services</button>
                        )}
                      </div>

                      {/* Dishes tab */}
                      {alacarteTab === 'dishes' && (
                        <>
                          <div className="bk-filter-row">
                            <span className="bk-label" style={{ letterSpacing: '.1em' }}>Filter:</span>
                            <select className="bk-select" value={dishFilter} onChange={e => setDishFilter(e.target.value)}>
                              <option value="all">All Categories</option>
                              {dishCategories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div className="bk-catalog-grid">
                            {menuItems.filter(m => m.isActive && (dishFilter === 'all' || m.itemCategory === dishFilter)).map(item => {
                              const baseQty = serviceFlow === 'event' ? Math.max(1, Math.ceil(guests / (item.servesPerTray || 25))) : 1;
                              return (
                                <div key={item.id} className="bk-catalog-card" style={{ cursor: 'default' }}>
                                  <div className="bk-catalog-name">{item.itemName}</div>
                                  <div className="bk-catalog-meta">{item.itemCategory} · {item.courseCategory}</div>
                                  <div className="bk-catalog-price">{fmtPHP(item.pricePerTray ?? 0)}</div>
                                  {serviceFlow === 'event' && menuItemQty[item.id] === baseQty && <div className="bk-catalog-meta" style={{ marginTop: '-.3rem', marginBottom: '.5rem', color: 'var(--primary)', fontWeight: 500 }}>Recommends {baseQty} trays for {guests} guests</div>}
                                  <div className="bk-qty">
                                    <button className="bk-qty-btn" onClick={() => setQty(setMenuItemQty, item.id, -1, baseQty)}>−</button>
                                    <input
                                      className="bk-qty-val"
                                      type="number"
                                      min={0}
                                      inputMode="numeric"
                                      value={menuItemQty[item.id] ?? 0}
                                      onChange={(e) => setQtyExact(setMenuItemQty, item.id, e.target.value)}
                                      aria-label={`Quantity for ${item.itemName}`}
                                    />
                                    <button className="bk-qty-btn" onClick={() => setQty(setMenuItemQty, item.id, 1, baseQty)}>+</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {/* Trays tab */}
                      {alacarteTab === 'trays' && (
                        <div className="bk-catalog-grid">
                          {menuTrays.filter(t => t.isActive).map(tray => {
                            const baseQty = serviceFlow === 'event' ? Math.max(1, Math.ceil(guests / (tray.servesMin || 25))) : 1;
                            return (
                              <div key={tray.id} className="bk-catalog-card" style={{ cursor: 'default' }}>
                                <div className="bk-catalog-name">{tray.trayName}</div>
                                <div className="bk-catalog-meta">{tray.dishes?.length ?? 0} dishes</div>
                                <div className="bk-catalog-price">{fmtPHP(tray.pricePerTray)}</div>
                                {serviceFlow === 'event' && menuTrayQty[tray.id] === baseQty && <div className="bk-catalog-meta" style={{ marginTop: '-.3rem', marginBottom: '.5rem', color: 'var(--primary)', fontWeight: 500 }}>Recommends {baseQty} trays for {guests} guests</div>}
                                <div className="bk-qty">
                                  <button className="bk-qty-btn" onClick={() => setQty(setMenuTrayQty, tray.id, -1, baseQty)}>−</button>
                                  <input
                                    className="bk-qty-val"
                                    type="number"
                                    min={0}
                                    inputMode="numeric"
                                    value={menuTrayQty[tray.id] ?? 0}
                                    onChange={(e) => setQtyExact(setMenuTrayQty, tray.id, e.target.value)}
                                    aria-label={`Quantity for ${tray.trayName}`}
                                  />
                                  <button className="bk-qty-btn" onClick={() => setQty(setMenuTrayQty, tray.id, 1, baseQty)}>+</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Rentals tab */}
                      {alacarteTab === 'rentals' && (
                        <div className="bk-catalog-grid">
                          {rentalItems.filter(r => r.isActive).map(item => (
                            <div key={item.id} className="bk-catalog-card" style={{ cursor: 'default' }}>
                              <div className="bk-catalog-name">{item.itemName}</div>
                              <div className="bk-catalog-meta">{item.category}</div>
                              <div className="bk-catalog-price">{fmtPHP(item.unitPrice)}</div>
                              <div className="bk-qty">
                                <button className="bk-qty-btn" onClick={() => setQty(setRentalQty, item.id, -1)}>−</button>
                                <input
                                  className="bk-qty-val"
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={rentalQty[item.id] ?? 0}
                                  onChange={(e) => setQtyExact(setRentalQty, item.id, e.target.value)}
                                  aria-label={`Quantity for ${item.itemName}`}
                                />
                                <button className="bk-qty-btn" onClick={() => setQty(setRentalQty, item.id, 1)}>+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Services tab */}
                      {alacarteTab === 'services' && (
                        <div className="bk-catalog-grid">
                          {serviceItems.filter(s => s.isActive).map(item => (
                            <div key={item.id} className="bk-catalog-card" style={{ cursor: 'default' }}>
                              <div className="bk-catalog-name">{item.serviceName}</div>
                              <div className="bk-catalog-price">{fmtPHP(item.unitCost)}</div>
                              <div className="bk-qty">
                                <button className="bk-qty-btn" onClick={() => setQty(setServiceQty, item.id, -1)}>−</button>
                                <input
                                  className="bk-qty-val"
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={serviceQty[item.id] ?? 0}
                                  onChange={(e) => setQtyExact(setServiceQty, item.id, e.target.value)}
                                  aria-label={`Quantity for ${item.serviceName}`}
                                />
                                <button className="bk-qty-btn" onClick={() => setQty(setServiceQty, item.id, 1)}>+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Running total */}
                      {grandTotal > 0 && (
                        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                          <div style={{ padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.12em' }}>Estimated Total</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: 'var(--primary)' }}>{fmtPHP(grandTotal)}</span>
                          </div>
                          {selectedPkg && packageOverageCost > 0 && (
                            <div style={{ textAlign: 'right', paddingRight: '.5rem', fontSize: '.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-body)' }}>
                              Base Package ({selectedPkg.maxPax} pax): {fmtPHP(packageBaseCost)} &nbsp;|&nbsp; Additional Guests ({packageOverageGuests} pax): {fmtPHP(packageOverageCost)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                </>
              )}

              <div className="bk-nav">
                <button className="bk-btn outline" onClick={() => setStep(2)}>← Back</button>
                <button
                  className="bk-btn primary"
                  disabled={!canProceedStep3 || savingSelections}
                  onClick={handleSaveSelections}
                >
                  {savingSelections ? <><span className="bk-spinner" /> Saving…</> : 'Next → Review'}
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 4 — REVIEW ═══════ */}
          {step === 4 && !submitted && (
            <div className="bk-card">
              <h2 className="bk-heading">Review & Submit</h2>
              <p className="bk-sub">Review your booking details before submitting.</p>

              {/* Contact Summary */}
              <div className="bk-review-section">
                <div className="bk-review-title">Contact Information</div>
                <div className="bk-review-row"><span className="bk-review-label">Name</span><span className="bk-review-value">{fullName}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Email</span><span className="bk-review-value">{email}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Phone</span><span className="bk-review-value">{phone}</span></div>
                {(streetAddress || city || zipCode) && (
                  <div className="bk-review-row"><span className="bk-review-label">Address</span><span className="bk-review-value">{[streetAddress, city, zipCode].filter(Boolean).join(', ')}</span></div>
                )}
              </div>

              {/* Event Summary */}
              <div className="bk-review-section">
                <div className="bk-review-title">Event Details</div>
                <div className="bk-review-row"><span className="bk-review-label">Event Type</span><span className="bk-review-value">{eventType}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Guests</span><span className="bk-review-value">{guests}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Date</span><span className="bk-review-value">{eventDate}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Time</span><span className="bk-review-value">{formatTime12h(startTime)} — {formatTime12h(endTime)}</span></div>
              </div>

              {/* Selections Summary */}
              <div className="bk-review-section">
                <div className="bk-review-title">Selections</div>
                {selectedPkg && (
                  <>
                    <div className="bk-review-row"><span className="bk-review-label">Package</span><span className="bk-review-value">{selectedPkg.packageName} — {fmtPHP(selectedPkg.basePrice)}</span></div>
                    {packageTemplate?.slots.map(slot => {
                      const selectedIds = slotSelections[slot.slotId] || [];
                      const selectedItems = selectedIds.map(id => menuItems.find(m => m.id === id)?.itemName).filter(Boolean).join(', ');
                      if (!selectedItems) return null;
                      return (
                        <div key={slot.slotId} className="bk-review-row" style={{ paddingLeft: '1rem', marginTop: '-.5rem' }}>
                          <span className="bk-review-label" style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>↳ {slot.label}</span>
                          <span className="bk-review-value" style={{ fontSize: '.75rem' }}>{selectedItems}</span>
                        </div>
                      );
                    })}
                  </>
                )}
                {Object.entries(menuItemQty).map(([id, qty]) => {
                  const item = menuItems.find(m => m.id === id);
                  if (!item) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{item.itemName} ×{qty}</span><span className="bk-review-value">{fmtPHP((item.pricePerTray ?? 0) * qty)}</span></div>;
                })}
                {Object.entries(menuTrayQty).map(([id, qty]) => {
                  const tray = menuTrays.find(t => t.id === id);
                  if (!tray) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{tray.trayName} ×{qty}</span><span className="bk-review-value">{fmtPHP(tray.pricePerTray * qty)}</span></div>;
                })}
                {Object.entries(rentalQty).map(([id, qty]) => {
                  const item = rentalItems.find(r => r.id === id);
                  if (!item) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{item.itemName} ×{qty}</span><span className="bk-review-value">{fmtPHP(item.unitPrice * qty)}</span></div>;
                })}
                {Object.entries(serviceQty).map(([id, qty]) => {
                  const item = serviceItems.find(s => s.id === id);
                  if (!item) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{item.serviceName} ×{qty}</span><span className="bk-review-value">{fmtPHP(item.unitCost * qty)}</span></div>;
                })}

                <div className="bk-review-total">
                  <span>Estimated Total</span>
                  <span>{fmtPHP(grandTotal)}</span>
                </div>
              </div>

              {/* Terms */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '1rem' }}>
                <input type="checkbox" id="terms-agree" checked={termsAgreed} onChange={e => setTermsAgreed(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                <label htmlFor="terms-agree" style={{ fontFamily: 'var(--font-body)', fontSize: '.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  I agree to the{' '}
                  <span style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }} onClick={e => { e.preventDefault(); setShowTerms(true); }}>
                    Terms & Conditions
                  </span>
                </label>
              </div>

              <div className="bk-nav">
                <button className="bk-btn outline" onClick={() => setStep(3)}>← Back</button>
                <button
                  className="bk-btn primary"
                  disabled={!termsAgreed || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? <><span className="bk-spinner" /> Submitting…</> : 'Submit Booking'}
                </button>
              </div>
            </div>
          )}

            </div>
          </section>
        )}
      </main>

      {/* ── TERMS MODAL ── */}
      {showTerms && (
        <div className="bk-terms-overlay" onClick={() => setShowTerms(false)}>
          <div className="bk-terms-panel" onClick={e => e.stopPropagation()}>
            <h3>Terms & Conditions</h3>
            <ol>
              <li><strong>Reservation Fee:</strong> A non-refundable reservation fee secures your date. Your booking is not confirmed until the fee is received.</li>
              <li><strong>Payment Schedule:</strong> 50% of the remaining balance is due one week before the event. The final balance is due on the event day.</li>
              <li><strong>Cancellation:</strong> Cancellations after confirmation are subject to the reservation fee forfeiture. Additional payments may be eligible for partial refund at the caterer's discretion.</li>
              <li><strong>Equipment:</strong> All rented equipment must be returned in the same condition. Damages or losses will be charged accordingly.</li>
              <li><strong>Liability:</strong> The caterer is not liable for delays caused by force majeure, venue restrictions, or third-party service failures.</li>
            </ol>
            <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
              <button className="bk-btn primary" onClick={() => { setTermsAgreed(true); setShowTerms(false); }}>I Agree</button>
            </div>
          </div>
        </div>
      )}

      <ChatWidget />
    </>
  );
}
