import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Check } from 'lucide-react';
import { Navbar } from '../components/site/Navbar';
import { PlanByBudget } from '../components/suggestions/PlanByBudget';
import { HERO_CARDS, HeroLayout } from '../components/booking/HeroLayout';
import type {
  HeroCardAction,
  ServiceFlow as HeroServiceFlow,
} from '../components/booking/heroTypes';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { snapFromQuote } from '../context/CartContext';
import { holdPlanImages } from '../lib/planImages';
import { readSession } from '../lib/tokenStorage';
import { fetchPackages, packageSuitsEventType, type AdminPackage } from '../api/packageAdminApi';
import { fetchMenuItems, fetchMenuTrays, type AdminMenuItem, type AdminMenuTray } from '../api/menuAdminApi';
import { fetchRentalItems, type AdminRentalItem } from '../api/rentalAdminApi';
import { PhoneNumberInput } from '../components/forms/PhoneNumberInput';
import { VenueAddressFields } from '../components/forms/VenueAddressFields';
import { composeVenueAddress, emptyVenueAddress, type VenueAddress } from '../lib/venue';
import { fetchServiceItems, type AdminServiceItem } from '../api/serviceAdminApi';
import {
  getPackageTemplate,
  eventDetailFieldsFor,
  validateReferenceImage,
  type PackageTemplateResponse,
} from '../api/bookingApi';
import {
  quoteProposal,
  SuggestionsApiError,
  type MaterializeRequest,
  type QuoteResponse,
} from '../api/suggestionsApi';
import { getCalendarDays, getBookingRules, type CalendarDay, type BookingRules } from '../api/calendarApi';
import {
  SERVICE_SCOPES,
  SERVING_STYLES,
  SERVICE_CATEGORIES,
  categoryFitsScope,
  scopeIncludesFood,
  scopeLabel,
  servingStyleLabel,
  type ServiceCategory,
  type ServiceScope,
  type ServingStyle,
} from '../lib/serviceScope';

/* Services show one tab per category. 'OtherServices' holds the ones nobody has
   sorted yet, which are offered on every kind of event. */
type ServiceTab = ServiceCategory | 'OtherServices';
type AlacarteTab = 'dishes' | 'trays' | 'rentals' | ServiceTab;
const isServiceTab = (tab: AlacarteTab): tab is ServiceTab =>
  tab !== 'dishes' && tab !== 'trays' && tab !== 'rentals';
import { SiteFooter } from '../components/site/SiteFooter';

/* ── constants ────────────────────────────────────────────────────────── */

const fmtPHP = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type EventTypeOption = { value: string; label: string; icon: string };
const EVENT_TYPES: EventTypeOption[] = [
  { value: 'Wedding', label: 'Wedding', icon: '💒' },
  { value: 'Birthday', label: 'Birthday', icon: '🎂' },
  { value: 'Corporate', label: 'Corporate', icon: '🏢' },
  { value: 'Debut', label: 'Debut', icon: '👑' },
  // 'Others', not 'Other' — these values are sent raw and must match the backend
  // EventType enum exactly. A mismatch doesn't fail this one field: it makes the
  // whole request body fail to deserialize, which surfaces as the opaque
  // "The dto field is required."
  { value: 'Others', label: 'Other', icon: '🎉' },
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

/**
 * "2026-08-10" → "August 10, 2026" for the lead-time messages.
 *
 * Parsed positionally rather than through `new Date(iso)`, which would read the string
 * as UTC midnight and render the previous day for anyone west of Greenwich.
 */
const fmtLeadDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
};

/* Moved to components/booking/heroTypes so the hero components and this page
   share one definition. Same union, same name, same usages below. */
type ServiceFlow = HeroServiceFlow;

/* ── component ────────────────────────────────────────────────────────── */

export function BookingPage() {
  const { user } = useAuth();

  const navigate = useNavigate();

  /* ── wizard state ── */
  /**
   * Arriving from the landing page's Reserve-this-Date modal, which passes the picked
   * date and the chosen path in router state. When both are present we skip the
   * Step-0 service picker — the visitor already answered that question.
   */
  const location = useLocation();
  const preset = (location.state ?? {}) as {
    presetDate?: string;
    /** 'plan' opens Step 0's Plan-by-Budget panel rather than a wizard flow. */
    presetFlow?: ServiceFlow | 'plan';
    /** Preselects a package, so /packages' "Book this package" lands on step 3 with it chosen. */
    presetPackageId?: string;
  };
  const presetService = preset.presetFlow === 'plan' ? null : preset.presetFlow ?? null;

  /* The wizard ends in the cart, not in a booking. Nothing is sent to the server while
     it is filled in: step 4 prices the plan, "Add to cart" stores it, and checkout —
     where signing in happens — places it. */
  const { addPlan } = useCart();

  /* An 'event' preset still stops at step 0: the visitor chose catering, but not yet
     which kind, and a scope-less event would reach step 3 with nothing to key off. */
  const [serviceFlow, setServiceFlow] = useState<ServiceFlow | null>(presetService === 'rentals' ? 'rentals' : null);
  const [step, setStep] = useState(presetService === 'rentals' ? 1 : 0);
  // Step-0 "Plan by Budget" card. Opens straight away when the landing page's
  // reserve modal sent us here with that path chosen.
  const [planMode, setPlanMode] = useState(preset.presetFlow === 'plan');

  /* Which kind of event service. Set only on the 'event' flow, by the scope picker the
     Full Event card opens in place of the card grid. Kept apart from ServiceFlow on
     purpose: every `serviceFlow === 'event'` check below stays true for all three. */
  const [scopeMode, setScopeMode] = useState(presetService === 'event');
  const [serviceScope, setServiceScope] = useState<ServiceScope | null>(null);
  const [servingStyle, setServingStyle] = useState<ServingStyle | null>(null);
  const [dietaryRequirements, setDietaryRequirements] = useState('');
  /* Styling is collapsed by default on Catering Alone, but never removed. */
  const [stylingOpen, setStylingOpen] = useState(false);
  /* Set when a Styling Only plan picked up food and became Full Event, so step 3 can
     say so and ask for the serving style it now needs. */
  const [scopeSwitched, setScopeSwitched] = useState(false);

  // Step 1 — Contact
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [venue, setVenue] = useState<VenueAddress>(emptyVenueAddress);

  // Step 2 — Event
  const [eventType, setEventType] = useState('');
  const [guests, setGuests] = useState(50);
  const [eventDate, setEventDate] = useState(preset.presetDate ?? '');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');

  /* Step 2 — event-type-specific details.
     Only the set matching the chosen type is sent; the server rejects the others
     outright (EventDetailRules), so these are cleared whenever the type changes. */
  const [groomName, setGroomName] = useState('');
  const [brideName, setBrideName] = useState('');
  const [celebrantName, setCelebrantName] = useState('');
  const [celebrantSex, setCelebrantSex] = useState('');
  const [celebrantAge, setCelebrantAge] = useState('');
  const [eventName, setEventName] = useState('');

  /* Step 2 — motif & theme. The text saves with the booking; the images upload
     separately once the Draft exists, because create is JSON and a file needs
     multipart. Held as Files until then. */
  const [motif, setMotif] = useState('');
  const [theme, setTheme] = useState('');
  const [motifImage, setMotifImage] = useState<File | null>(null);
  const [themeImage, setThemeImage] = useState<File | null>(null);
  const [motifPreview, setMotifPreview] = useState<string | null>(null);
  const [themePreview, setThemePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  /* Real availability for the chosen date, straight from the backend's calendar
     (isLocked = manually locked, or the confirmed count has reached capacity). This
     is advisory here — confirmation is still gated server-side — but it means the
     customer finds out before building a whole booking on an unavailable date. */
  const [dateStatus, setDateStatus] = useState<CalendarDay | null>(null);
  const [dateChecking, setDateChecking] = useState(false);
  /* Configured lead times. Null until fetched (or if the fetch fails), in which case
     the date field falls back to "not in the past" and the server stays the gate. */
  const [bookingRules, setBookingRules] = useState<BookingRules | null>(null);

  // Delivery (rentals/menu flows)

  // Step 3 — Catalog data
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [menuTrays, setMenuTrays] = useState<AdminMenuTray[]>([]);
  const [rentalItems, setRentalItems] = useState<AdminRentalItem[]>([]);
  const [serviceItems, setServiceItems] = useState<AdminServiceItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Step 3 — Selection mode
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(preset.presetPackageId ?? null);
  const [packageTemplate, setPackageTemplate] = useState<PackageTemplateResponse | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);

  // Package slot selections: slotId → Set of chosen itemIds
  const [slotSelections, setSlotSelections] = useState<Record<string, string[]>>({});

  // À la carte quantity maps.
  const [menuItemQty, setMenuItemQty] = useState<Record<string, number>>({});
  const [menuTrayQty, setMenuTrayQty] = useState<Record<string, number>>({});
  const [rentalQty, setRentalQty] = useState<Record<string, number>>({});
  const [serviceQty, setServiceQty] = useState<Record<string, number>>({});
  const [alacarteTab, setAlacarteTab] = useState<AlacarteTab>(
    /* A rentals booking has no Dishes tab to click, and the tab CONTENT is not
       gated on the flow — so defaulting to 'dishes' there rendered the whole dish
       catalog under a bar whose only button was "Rentals". */
    presetService === 'rentals' ? 'rentals' : 'dishes',
  );

  const [dishFilter, setDishFilter] = useState('all');


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
    // The catalog GETs are anonymous, so a guest can build a whole booking before
    // signing in. A token is sent when there is one, and '' otherwise.
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

  /* ── load package template ──
     Anonymous, like the catalog. Nothing is saved: the chosen package and its dishes
     stay in this page's state until step 4 puts the plan in the cart. */
  const loadTemplate = useCallback(async (pkgId: string) => {
    templateTriedFor.current = pkgId;
    setTemplateLoading(true);
    setCatalogError(null);
    try {
      const tmpl = await getPackageTemplate(readSession()?.token ?? '', pkgId);
      setPackageTemplate(tmpl);
      setSlotSelections(Object.fromEntries(tmpl.slots.map((s) => [s.slotId, [] as string[]])));
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Unable to load package details. Please try again.');
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  /* A package chosen before arriving (/packages' "Book this package") has no template
     yet, and without one its courses can never be filled in. Tried once per package,
     so a failed load shows its error instead of retrying on every render. */
  const templateTriedFor = useRef<string | null>(null);
  useEffect(() => {
    if (step !== 3 || !selectedPackageId || packageTemplate || templateTriedFor.current === selectedPackageId) return;
    void loadTemplate(selectedPackageId);
  }, [step, selectedPackageId, packageTemplate, loadTemplate]);

  /* Lead-time rules, fetched once. Deliberately not hardcoded: MinLeadDaysFullService
     is owner-editable, and a copy here would disagree with the API the moment it
     changed. Anonymous, so this works for guests browsing before they sign in. */
  useEffect(() => {
    let cancelled = false;
    getBookingRules()
      .then((rules) => { if (!cancelled) setBookingRules(rules); })
      // Advisory only — the server still enforces the real rule on submit.
      .catch(() => { if (!cancelled) setBookingRules(null); });
    return () => { cancelled = true; };
  }, []);

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

  /* Earliest legal event date. Both wizard flows create FullService/RentalService
     bookings, and Bookingservice applies the full-service lead time to everything that
     isn't a FoodDelivery — so one value covers both. Falls back to "not in the past"
     when the rules fetch failed, leaving the server as the only gate rather than
     inventing a limit the API might not agree with. */
  const today = new Date().toISOString().split('T')[0];
  const earliestBookingDate = bookingRules?.earliestFullServiceDate ?? today;
  const dateTooSoon = Boolean(eventDate) && eventDate < earliestBookingDate;

  // Both remaining flows ('event' and 'rentals') create a FullService booking, so both
  // must supply the fields CreateAsync requires: event type, guests, dates, and times.
  // The lead-time check joins them: a too-soon date is rejected by the API, so blocking
  // Next here gets the customer a friendlier message before they've filled in the rest.
  /* Which detail fields the chosen type uses. 'none' covers a booking with no event
     type at all (a food delivery), where the whole block renders nothing. */
  const detailGroup = eventDetailFieldsFor(eventType || null);

  /* Picks a reference image and swaps in a local preview.
     Validated before upload so a 10 MB file is refused instantly rather than after
     the round trip; the server enforces the same limits regardless. The previous
     object URL is revoked on replace — without that, every re-pick leaks a blob for
     the life of the page. */
  const pickImage = (kind: 'motif' | 'theme', file: File | null) => {
    setImageError(null);
    const prev = kind === 'motif' ? motifPreview : themePreview;
    if (prev) URL.revokeObjectURL(prev);

    if (!file) {
      if (kind === 'motif') { setMotifImage(null); setMotifPreview(null); }
      else { setThemeImage(null); setThemePreview(null); }
      return;
    }

    const problem = validateReferenceImage(file);
    if (problem) {
      setImageError(problem);
      if (kind === 'motif') { setMotifImage(null); setMotifPreview(null); }
      else { setThemeImage(null); setThemePreview(null); }
      return;
    }

    const url = URL.createObjectURL(file);
    if (kind === 'motif') { setMotifImage(file); setMotifPreview(url); }
    else { setThemeImage(file); setThemePreview(url); }
  };

  // Release any surviving preview URLs when the wizard unmounts.
  useEffect(() => () => {
    if (motifPreview) URL.revokeObjectURL(motifPreview);
    if (themePreview) URL.revokeObjectURL(themePreview);
    // Intentionally empty deps: this is unmount-only cleanup, and the previews are
    // already revoked on replace by pickImage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Switching event type clears the previous type's answers.
     Not cosmetic: the server rejects a payload carrying fields that don't belong to
     the chosen type, so leaving a groom's name behind after switching to Birthday
     would make Next fail with a validation error pointing at an invisible field. */
  const chooseEventType = (value: string) => {
    if (value === eventType) return;
    setEventType(value);
    setGroomName(''); setBrideName('');
    setCelebrantName(''); setCelebrantSex(''); setCelebrantAge('');
    setEventName('');
  };

  /* Every applicable detail field must be filled before Step 2 can advance.
     This is a wizard-level requirement, not a server one — the API accepts a booking
     with details still missing so that admin walk-ins (often just a date and a type
     over the phone) aren't blocked. A customer going through the wizard, though,
     knows these answers, so asking up front saves a follow-up call. */
  const eventScope = serviceFlow === 'event' ? serviceScope : null;
  const hasFood = serviceFlow === 'event' && scopeIncludesFood(serviceScope);
  /* Serving style is the one scope answer the server insists on, and only once a scope
     that includes food is sent. Dietary requirements stay optional. */
  const servingComplete = !hasFood || servingStyle !== null;

  const detailsComplete = serviceFlow === 'rentals' ? true :
    detailGroup === 'couple' ? Boolean(groomName.trim() && brideName.trim())
      : detailGroup === 'celebrant'
        ? Boolean(celebrantName.trim() && celebrantSex.trim() && celebrantAge.trim())
        : detailGroup === 'named' ? Boolean(eventName.trim())
          : true;

  const eventComplete =
    (serviceFlow === 'rentals' ? true : (eventType && guests >= 1)) &&
    eventDate && startTime && endDate && endTime && !dateTooSoon && detailsComplete && servingComplete;

  const stepLabels = useMemo(() => {
    if (serviceFlow === 'event' && serviceScope === 'StylingOnly') return ['Contact', 'Event Details', 'Styling & Add‑ons', 'Review'];
    if (serviceFlow === 'event') return ['Contact', 'Event Details', 'Package & Add‑ons', 'Review'];
    if (serviceFlow === 'rentals') return ['Contact', 'Event Details', 'Rentals & Add‑ons', 'Review'];
    return [];
  }, [serviceFlow, serviceScope]);

  /* Dishes and trays are an event-flow surface, but a rentals booking can still
     be carrying food: the customer may have used "← Change Service" after the
     cart seeded them, and the backend accepts menu lines on any BookingType.
     Hiding the tabs then would leave those lines on the draft with nothing in the
     UI that shows or removes them — and there is no endpoint to remove a line
     once saved. So the tabs follow the selections, not the flow. */
  const hasFoodSelections =
    Object.keys(menuItemQty).length > 0 || Object.keys(menuTrayQty).length > 0;
  const showFoodTabs = hasFood || hasFoodSelections;

  /* A Styling Only plan can't carry food (the server refuses it), so food arriving on
     one (left over from "← Change Service", or a preset package) makes it Full Event
     Catering, out loud, rather than failing at the quote. */
  /* A waiter or a buffet table on the plan counts as food here too: the server refuses
     food service on a styling-only event just as it refuses dishes. */
  const hasFoodServiceSelections = Object.keys(serviceQty).some(
    (id) => serviceItems.find((s) => s.id === id)?.category === 'FoodService',
  );
  useEffect(() => {
    if (serviceFlow !== 'event' || serviceScope !== 'StylingOnly') return;
    if (!hasFoodSelections && !hasFoodServiceSelections && !selectedPackageId) return;
    setServiceScope('FullEvent');
    setScopeSwitched(true);
  }, [serviceFlow, serviceScope, hasFoodSelections, hasFoodServiceSelections, selectedPackageId]);

  /* The service tabs this plan can use: a category with at least one active service
     that fits the scope, in the order the admin form lists them, then the unsorted. */
  const serviceTabs = useMemo(() => {
    if (serviceFlow !== 'event') return [] as { key: ServiceTab; label: string }[];
    const active = serviceItems.filter((s) => s.isActive);
    const tabs: { key: ServiceTab; label: string }[] = SERVICE_CATEGORIES
      .filter((c) => categoryFitsScope(c.value, serviceScope) && active.some((s) => s.category === c.value))
      .map((c) => ({ key: c.value, label: c.label }));
    if (active.some((s) => !s.category)) tabs.push({ key: 'OtherServices', label: 'Other services' });
    return tabs;
  }, [serviceFlow, serviceScope, serviceItems]);


  /* Keep the open tab reachable. The tab CONTENT below is not gated on the flow,
     so a tab that stops being rendered would otherwise keep showing its catalog
     under a bar that no longer contains its button. */
  useEffect(() => {
    if (!showFoodTabs && (alacarteTab === 'dishes' || alacarteTab === 'trays')) setAlacarteTab('rentals');
    else if (serviceFlow !== 'event' && isServiceTab(alacarteTab)) setAlacarteTab('rentals');
    // A category tab this scope can't take, or one with nothing in it. Only once the
    // catalog has loaded, or every service tab would look empty on the way in.
    else if (isServiceTab(alacarteTab) && serviceItems.length > 0 && !serviceTabs.some((t) => t.key === alacarteTab))
      setAlacarteTab(serviceTabs[0]?.key ?? 'rentals');
  }, [showFoodTabs, serviceFlow, alacarteTab, serviceItems.length, serviceTabs]);

  const dishCategories = useMemo(() =>
    [...new Set(menuItems.map(m => m.itemCategory))].filter(Boolean),
  [menuItems]);

  const selectedPkg = packages.find(p => p.id === selectedPackageId);

  // Step 3 only offers packages whose pax range covers the guest count, and that are
  // made for the chosen event type (a wedding package can't go on a birthday; the
  // server refuses it too).
  const fitsGuests = (pkg: { minPax: number; maxPax: number }) => guests >= pkg.minPax && guests <= pkg.maxPax;
  const fitsEvent = (pkg: AdminPackage) => packageSuitsEventType(pkg, eventType || null);
  const packagesForEvent = packages.filter(fitsEvent);
  const eligiblePackages = packagesForEvent.filter(fitsGuests);

  /* A package preselected (e.g. from PackagePage) or picked before the guest count or
     event type changed is dropped once Step 3 shows it no longer fits. Waits for Step 3
     so the preset survives until Step 2's answers are in. */
  useEffect(() => {
    if (step !== 3 || !selectedPkg || (fitsGuests(selectedPkg) && fitsEvent(selectedPkg))) return;
    setSelectedPackageId(null);
    setPackageTemplate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedPkg, guests, eventType]);

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

  /* ── step 4: price the plan, then put it in the cart ──
     Priced by the server (POST /api/suggestions/quote) with every detail included —
     dates, times, event type, the event details — so step 4 shows the total checkout
     will charge and any refusal checkout would give. And because nothing has been
     saved before this point, an edited quantity can't be lost any more: there is no
     earlier save left for it to collide with. */
  const bookingType: MaterializeRequest['bookingType'] = serviceFlow === 'rentals' ? 'RentalService' : 'FullService';

  const planRecipe = useMemo<MaterializeRequest>(() => {
    const clean = (s: string) => s.trim() || null;
    const toLines = (type: string, qty: Record<string, number>) =>
      Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([refId, quantity]) => ({ type, refId, quantity }));
    const packageId = hasFood ? selectedPackageId : null;

    return {
      bookingType,
      eventDate,
      startTime: startTime ? `${startTime}:00` : '',
      endDate: endDate || null,
      endTime: endTime ? `${endTime}:00` : null,
      eventType: eventType || null,
      venueAddress: composeVenueAddress(venue) || 'To be provided',
      guestCount: guests,
      contactNumber: phone || null,
      /* Only the group matching the event type. The quote refuses a field that
         doesn't belong to the type, so the others go as null, never as ''. */
      eventDetails: {
        groomName: detailGroup === 'couple' ? clean(groomName) : null,
        brideName: detailGroup === 'couple' ? clean(brideName) : null,
        celebrantName: detailGroup === 'celebrant' ? clean(celebrantName) : null,
        celebrantSex: detailGroup === 'celebrant' ? clean(celebrantSex) : null,
        celebrantAge: detailGroup === 'celebrant' && celebrantAge.trim() ? Number(celebrantAge) : null,
        eventName: detailGroup === 'named' ? clean(eventName) : null,
        motif: clean(motif),
        theme: clean(theme),
        /* Event flow only. Styling Only carries no serving style or dietary needs: the
           server refuses them there rather than dropping them. */
        serviceScope: eventScope,
        servingStyle: hasFood ? servingStyle : null,
        dietaryRequirements: hasFood ? clean(dietaryRequirements) : null,
      },
      proposal: {
        packageId,
        lines: [
          ...toLines('MenuItem', menuItemQty),
          ...toLines('MenuTray', menuTrayQty),
          ...toLines('Rental', rentalQty),
          ...toLines('Service', serviceQty),
        ],
        packageSlotSelections: packageId
          ? Object.entries(slotSelections).map(([slotId, itemIds]) => ({ slotId, itemIds }))
          : [],
      },
    };
  }, [
    bookingType, hasFood, eventScope, servingStyle, dietaryRequirements, selectedPackageId, eventDate, startTime, endDate, endTime, eventType, venue,
    guests, phone, detailGroup, groomName, brideName, celebrantName, celebrantSex, celebrantAge, eventName,
    motif, theme, menuItemQty, menuTrayQty, rentalQty, serviceQty, slotSelections,
  ]);
  const recipeKey = JSON.stringify(planRecipe);

  /* Keyed like PlanReview's quote: an answer for an older version of the plan never
     lands on a newer one, and state is only set from the promise. */
  const [quoted, setQuoted] = useState<{ key: string; quote: QuoteResponse | null; error: string | null } | null>(null);
  const latestQuoteKey = useRef(recipeKey);
  useEffect(() => {
    latestQuoteKey.current = recipeKey;
    if (step !== 4) return;
    const key = recipeKey;
    quoteProposal(readSession()?.token ?? '', {
      bookingType: planRecipe.bookingType,
      eventDate: planRecipe.eventDate,
      endDate: planRecipe.endDate,
      guestCount: planRecipe.guestCount,
      startTime: planRecipe.startTime,
      endTime: planRecipe.endTime,
      eventType: planRecipe.eventType,
      eventDetails: planRecipe.eventDetails,
      proposal: planRecipe.proposal,
    })
      .then((quote) => {
        if (latestQuoteKey.current === key) setQuoted({ key, quote, error: null });
      })
      .catch((err: unknown) => {
        if (latestQuoteKey.current !== key) return;
        setQuoted({
          key,
          quote: null,
          error: err instanceof SuggestionsApiError ? err.message : 'Could not price your booking right now.',
        });
      });
  }, [step, recipeKey, planRecipe]);

  const planQuote = quoted?.key === recipeKey ? quoted : null;

  /** A line's total from the quote once it's in; the local estimate until then. */
  const quotedLineTotal = (type: string, refId: string, estimate: number) =>
    planQuote?.quote?.lines.find((l) => l.type === type && l.refId === refId && !l.problem)?.lineTotal ?? estimate;

  const addToCart = () => {
    const quote = planQuote?.quote;
    if (!quote || !quote.canCheckout || !termsAgreed) return;
    const typeLabel = EVENT_TYPES.find((t) => t.value === eventType)?.label ?? eventType;
    const key = addPlan({
      title: serviceFlow === 'rentals'
        ? `Equipment rental${typeLabel ? ` · ${typeLabel}` : ''}`
        : `${typeLabel || 'Event'} · ${guests} guests${eventScope && eventScope !== 'FullEvent' ? ` · ${scopeLabel(eventScope)}` : ''}`,
      recipe: planRecipe,
      snap: snapFromQuote(quote),
      imageNames: motifImage || themeImage ? { motif: motifImage?.name, theme: themeImage?.name } : undefined,
    });
    /* The files can't go to storage; they wait in memory for checkout to upload them
       once the booking exists (lib/planImages). */
    holdPlanImages(key, { motif: motifImage, theme: themeImage });
    navigate('/cart');
  };

  /* ── navigation helpers ── */
  const pickService = (flow: ServiceFlow) => {
    /* Catering is a question first: which kind. The picker swaps in for the card grid,
       the same way Plan by Budget does, and pickScope finishes the choice. */
    if (flow === 'event') { setScopeMode(true); return; }
    setServiceFlow(flow);
    setServiceScope(null);
    setStep(1);
  };

  const pickScope = (scope: ServiceScope) => {
    setServiceFlow('event');
    setServiceScope(scope);
    setScopeSwitched(false);
    setScopeMode(false);
    setStylingOpen(false);
    // Open step 3 on the tab this scope is about.
    setAlacarteTab(scope === 'StylingOnly' ? 'Decor' : 'dishes');
    if (!scopeIncludesFood(scope)) { setServingStyle(null); setDietaryRequirements(''); }
    setStep(1);
  };

  /* Styling Only becomes Full Event from step 3's "Add food" button. */
  const addFoodToStylingOnly = () => {
    setServiceScope('FullEvent');
    setScopeSwitched(true);
    setAlacarteTab('dishes');
  };

  /* Hero card dispatch. 'plan' is deliberately NOT a pickService call — it swaps
     the card grid for <PlanByBudget /> and leaves `step` at 0. */
  const pickHeroCard = (action: HeroCardAction) => {
    if (action.kind === 'plan') setPlanMode(true);
    else pickService(action.flow);
  };

  /* ── can proceed checks ── */
  const allSlotsComplete = packageTemplate
    ? packageTemplate.slots.every(s => (slotSelections[s.slotId]?.length ?? 0) === s.chooseCount)
    : false;

  const hasAlacarteItems = Object.keys(menuItemQty).length > 0
    || Object.keys(menuTrayQty).length > 0
    || Object.keys(rentalQty).length > 0
    || Object.keys(serviceQty).length > 0;

  const canProceedStep3 =
    (selectedPackageId ? allSlotsComplete : true) && (hasAlacarteItems || !!selectedPackageId) && servingComplete;

  /* Serving style as a radio group. Rendered on step 2, and again in step 3's notice
     when a Styling Only plan has just become Full Event and still needs one. */
  const renderServingStyle = (name: string) => (
    <div className="bk-serve-grid" role="radiogroup" aria-label="Serving style">
      {SERVING_STYLES.map((s) => (
        <label key={s.value} className={`bk-serve-card${servingStyle === s.value ? ' active' : ''}`}>
          <input
            type="radio"
            name={name}
            value={s.value}
            checked={servingStyle === s.value}
            onChange={() => setServingStyle(s.value)}
            className="sr-only"
          />
          <span className="bk-serve-title">{s.label}</span>
          <span className="bk-serve-desc">{s.description}</span>
        </label>
      ))}
    </div>
  );

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

        /* ── page layout ──
           1200 rather than 880: the container now holds a 260px rail beside the
           step card, and 880 would leave the card narrower than it was before. */
        .bk-container{max-width:1200px;margin:0 auto}
        .bk-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:2rem;align-items:start}
        .bk-main{min-width:0}

        /* Sticky so the total stays on screen through a long step-3 catalog.
           96px clears the fixed navbar. */
        .bk-rail-inner{position:sticky;top:96px;display:flex;flex-direction:column;gap:1.25rem}

        .bk-draft{display:flex;align-items:center;gap:.4rem;margin:0;font-family:var(--font-body);font-size:.75rem;font-weight:500;color:var(--status-paid)}

        /* ── stepper (vertical rail) ── */
        .bk-stepper{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.15rem}
        .bk-step-item{display:flex;align-items:center;gap:.7rem;padding:.5rem 0;font-family:var(--font-body);font-size:.8125rem;font-weight:500;color:var(--text-muted);transition:color .3s;position:relative}
        /* The connector is drawn from the item rather than as its own element, so
           the list stays a real <ol> of four <li>s for a screen reader. */
        .bk-step-item:not(:last-child)::after{content:'';position:absolute;left:14px;top:34px;width:2px;height:calc(100% - 28px);background:var(--border);border-radius:1px}
        .bk-step-item.done::after{background:var(--primary)}
        .bk-step-item.active{color:var(--text-primary);font-weight:600}
        .bk-step-item.done{color:var(--text-secondary)}
        .bk-step-num{width:28px;height:28px;flex-shrink:0;border-radius:var(--r-full);display:flex;align-items:center;justify-content:center;font-family:var(--font-numeric);font-size:.75rem;font-weight:500;background:var(--surface);border:1px solid var(--border-strong);color:var(--text-muted);transition:background .3s,border-color .3s,color .3s;z-index:1}
        .bk-step-item.active .bk-step-num{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
        .bk-step-item.done .bk-step-num{background:var(--primary);border-color:var(--primary);color:var(--primary-text)}

        /* ── progress bar (below the rail breakpoint) ── */
        .bk-progress{display:none}
        .bk-progress-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-bottom:.5rem}
        .bk-progress-head span:first-child{font-family:var(--font-numeric);font-size:.625rem;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted)}
        .bk-progress-head span:last-child{font-family:var(--font-body);font-size:.875rem;font-weight:600;color:var(--text-primary)}
        .bk-progress-track{height:4px;border-radius:var(--r-full);background:var(--border);overflow:hidden}
        .bk-progress-fill{height:100%;background:var(--accent);border-radius:var(--r-full);transition:width .35s ease}

        /* ── running total ── */
        .bk-summary{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:1.1rem 1.25rem;box-shadow:var(--shadow-sm)}
        .bk-summary-kicker{font-family:var(--font-numeric);font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.4rem}
        .bk-summary-total{font-family:var(--font-numeric);font-variant-numeric:tabular-nums;font-size:1.5rem;font-weight:500;color:var(--text-primary);letter-spacing:-.01em;margin-bottom:.9rem}
        .bk-summary-list{margin:0;padding-top:.9rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.5rem}
        .bk-summary-list > div{display:flex;justify-content:space-between;align-items:baseline;gap:.75rem}
        .bk-summary-list dt{font-family:var(--font-body);font-size:.75rem;color:var(--text-muted)}
        .bk-summary-list dd{margin:0;font-family:var(--font-body);font-size:.75rem;font-weight:600;color:var(--text-primary);text-align:right;overflow-wrap:anywhere}

        /* Rail collapses at the foundations' nav breakpoint. */
        @media(max-width:1020px){
          .bk-layout{grid-template-columns:1fr;gap:1.5rem}
          .bk-rail-inner{position:static;gap:1rem}
          .bk-stepper{display:none}
          .bk-progress{display:block}
          .bk-summary{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap}
          .bk-summary-kicker{margin:0}
          .bk-summary-total{margin:0;font-size:1.25rem}
          .bk-summary-list{display:none}
        }

        /* ── card ── */
        /* Three grounds, one step apart: the section is --bg-subtle, the card --bg,
           and the fields inside it --surface. The card used to be --surface too,
           which left every input the same colour as the card it sat on and relying
           on its border alone to exist. */
        .bk-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-xl);padding:2rem 2.25rem;box-shadow:var(--shadow-md)}
        .bk-heading{font-family:var(--font-display);font-size:1.5rem;font-weight:600;letter-spacing:-.02em;color:var(--text-primary);margin:0 0 .35rem}
        .bk-sub{font-family:var(--font-body);font-size:.875rem;font-weight:400;line-height:1.5;color:var(--text-muted);margin:0 0 1.6rem}
        .bk-cart-note{display:flex;align-items:flex-start;gap:.55rem;font-family:var(--font-body);font-size:.8125rem;line-height:1.5;color:var(--text-secondary);background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--r-lg);padding:.7rem .85rem;margin:0 0 1.6rem}
        .bk-cart-note svg{flex:none;margin-top:.1rem;color:var(--accent)}

        /* ── form ── */
        .bk-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem}
        @media(max-width:600px){.bk-grid{grid-template-columns:1fr}}
        .bk-grid-3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:1.1rem}
        @media(max-width:600px){.bk-grid-3{grid-template-columns:1fr}}
        .bk-field{display:flex;flex-direction:column;gap:.5rem}
        .bk-field.full{grid-column:1/-1}
        .bk-label{font-family:var(--font-body);font-size:.6875rem;line-height:1;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--text-muted)}
        /* --surface, not --bg-subtle: the card is already --surface in light, so a
           --bg-subtle field disappeared into it. The field now sits on the same
           step the rest of the app's inputs use, with the accent focus ring. */
        .bk-input{background:var(--surface);border:1px solid var(--border-strong);border-radius:12px;padding:.875rem;font-family:var(--font-body);font-size:.9375rem;line-height:1.2;font-weight:400;color:var(--text-primary);outline:none;transition:border-color .2s}
        .bk-input:focus,.bk-input:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
        .bk-input::placeholder{color:var(--text-dim)}

        /* ── event type cards ── */
        .bk-type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:.75rem}
        .bk-type-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:1.1rem .7rem;display:flex;flex-direction:column;align-items:center;gap:.35rem;cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s;text-align:center}
        .bk-type-card:hover{border-color:var(--border-accent);transform:translateY(-3px);box-shadow:var(--shadow-md)}
        .bk-type-card.active{border-color:var(--primary);background:var(--primary-muted);box-shadow:0 0 0 3px var(--primary-muted),var(--shadow-md)}
        .bk-type-icon{font-size:1.5rem}
        .bk-type-label{font-family:var(--font-body);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;font-weight:500;color:var(--text-primary)}

        /* ── buttons ── */
        .bk-nav{display:flex;justify-content:space-between;gap:1rem;margin-top:1.8rem;flex-wrap:wrap}
        /* Sentence case at 14/600 rather than 10px uppercase on .18em tracking —
           the old label was narrower than the icon beside it. */
        .bk-btn{font-family:var(--font-body);font-size:.875rem;letter-spacing:.01em;font-weight:600;line-height:1;padding:1rem 1.75rem;border-radius:var(--r-full);border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;white-space:nowrap;transition:background .2s,color .2s,border-color .2s,transform .2s,box-shadow .2s}
        .bk-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
        .bk-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
        .bk-btn.danger{background:var(--danger);color:var(--danger-text);border-color:var(--danger)}
        .bk-btn.danger:hover:not(:disabled){filter:brightness(.92);transform:translateY(-2px)}

        /* leave-confirmation modal — same overlay/modal shape as the dashboards */
        .bk-overlay{position:fixed;inset:0;z-index:150;background:rgba(20,14,8,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:1.5rem}
        .bk-modal{width:min(440px,100%);background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);padding:1.9rem 1.8rem 1.6rem}
        .bk-modal-title{font-family:var(--font-display);font-size:1.35rem;font-weight:500;color:var(--text-primary);margin:0 0 .6rem}
        .bk-modal-body{font-family:var(--font-body);font-size:.84rem;font-weight:300;color:var(--text-muted);line-height:1.7;margin:0 0 1.5rem}
        .bk-modal-actions{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:flex-end}
        /* The forward action is the rose in this direction — --accent is "the button
           you press", --primary is structure. Back stays a neutral outline so the
           pair reads as one primary and one escape rather than two equal choices. */
        .bk-btn.primary{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}
        .bk-btn.primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover);transform:translateY(-1px);box-shadow:var(--shadow-gold)}
        .bk-btn.outline{background:transparent;color:var(--text-primary);border-color:var(--border-strong)}
        .bk-btn.outline:hover:not(:disabled){background:var(--primary-muted)}
        .bk-btn.danger{background:var(--danger);color:var(--danger-text);border-color:var(--danger)}

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
        .bk-flow-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
        .bk-flow-note{font-family:var(--font-body);font-size:.72rem;color:var(--text-dim);line-height:1.5;margin-top:.6rem}

        /* ── serving style ── */
        .bk-serve-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem}
        @media(max-width:600px){.bk-serve-grid{grid-template-columns:1fr}}
        .bk-serve-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:.9rem 1rem;display:flex;flex-direction:column;gap:.25rem;cursor:pointer;transition:border-color .25s,box-shadow .25s}
        .bk-serve-card:hover{border-color:var(--border-accent)}
        .bk-serve-card:focus-within{outline:2px solid var(--accent);outline-offset:1px}
        .bk-serve-card.active{border-color:var(--primary);background:var(--primary-muted);box-shadow:0 0 0 3px var(--primary-muted)}
        .bk-serve-title{font-family:var(--font-body);font-size:.875rem;font-weight:600;color:var(--text-primary)}
        .bk-serve-desc{font-family:var(--font-body);font-size:.72rem;line-height:1.45;color:var(--text-muted)}
        .bk-hint{font-family:var(--font-body);font-size:.72rem;line-height:1.5;color:var(--text-muted);margin:.4rem 0 0}
        .bk-link{background:none;border:none;padding:0;font:inherit;color:var(--primary);text-decoration:underline;cursor:pointer}
        .bk-disclosure{border:1px solid var(--border);border-radius:var(--r-xl);padding:.85rem 1rem;margin-bottom:1.2rem;background:var(--surface)}
        .bk-disclosure-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;padding:0;cursor:pointer;font-family:var(--font-body);font-size:.8125rem;font-weight:600;color:var(--text-primary)}

        /* ── error/feedback ── */
        /* Tinted panel with a 28% edge, per artboard 3d — it was a hairline danger
           border on the page ground, which read as an outlined input rather than a
           problem. Title and body take --danger-ink, the text-weight step. */
        .bk-error{
          background:var(--danger-muted);
          border:1px solid color-mix(in srgb, var(--danger) 28%, transparent);
          border-radius:var(--r-xl);
          padding:1.25rem 1.375rem;margin-bottom:1rem;
          display:flex;gap:.75rem;align-items:flex-start;
          font-family:var(--font-body);font-size:.8125rem;line-height:1.45;color:var(--danger-ink);
        }
        .bk-error svg{flex:none;margin-top:2px}
        .bk-error-title{font-weight:600;font-size:.8125rem;line-height:1.3;margin-bottom:4px}
        /* No opacity. It was .85, and fading the ink is the one thing in this panel
           that broke it: --danger-ink measures 5.70 light / 5.21 dark on the
           --danger-muted ground, and .85 took that to 4.53 / 4.20. The body is
           already separated from the title by weight (400 vs 600) and size, so the
           fade bought nothing the type was not doing. */
        .bk-error-body{font-weight:400;font-size:.75rem;line-height:1.45}

        .bk-success-card{text-align:center;padding:2rem}
        /* The mark sits in a 56px tint disc rather than being a 3.5rem glyph on its
           own, so the success colour is carried by the container and the check can
           stay currentColor. */
        .bk-success-icon{
          width:56px;height:56px;margin:0 auto 18px;
          border-radius:var(--r-full);
          background:color-mix(in srgb, var(--status-paid) 12%, transparent);
          color:var(--status-paid);
          display:flex;align-items:center;justify-content:center;
        }
        .bk-success-title{font-family:var(--font-display);font-size:1.5rem;font-weight:600;letter-spacing:-.025em;line-height:1.15;color:var(--text-primary);margin-bottom:.625rem}

        /* skeleton rows — artboard 3d, "Loading · step 3 catalog" */
        .bk-skel-kicker{font-family:var(--font-numeric);font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1rem}
        .bk-skel-rows{display:flex;flex-direction:column;gap:11px;margin-bottom:20px}
        .bk-skel{height:14px;border-radius:var(--r-full);background:var(--secondary-muted)}
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

      <Navbar activePage="quotation" placement="sticky" />

      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>
        
        {/* ═══════════════════════ HERO (STEP 0) ═══════════════════════ */}
        {step === 0 && (
          <section style={{ padding: '6rem 0', position: 'relative', paddingTop: 'calc(6rem + 80px)', paddingBottom: '4rem', overflow: 'hidden' }}>
            <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
            <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />
            
            {/* Widened from 880 to 1200: an asymmetric 4/8 split inside 880px
                leaves the card descriptions too narrow to read. 1200 matches the
                container the menu and rentals pages use. */}
            <div className="fade-up" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem', position: 'relative' }}>
              {scopeMode ? (
                <div>
                  <h2 className="bk-heading" style={{ fontSize: '1.9rem' }}>What should we take care of?</h2>
                  <p className="bk-sub" style={{ marginBottom: 0 }}>
                    Pick the part of your event you need us for. You can still add the other half later.
                  </p>
                  <div className="bk-flow-grid">
                    {SERVICE_SCOPES.map((s) => (
                      <button key={s.value} type="button" className="bk-flow-card" onClick={() => pickScope(s.value)}>
                        <span className="bk-flow-icon" aria-hidden="true">{s.icon}</span>
                        <span className="bk-flow-title">{s.label}</span>
                        <span className="bk-flow-desc">{s.includes}</span>
                        <span className="bk-flow-note">{s.excludes}</span>
                      </button>
                    ))}
                  </div>
                  <p className="bk-hint" style={{ textAlign: 'center' }}>
                    Just need food delivered, with no staff on site?{' '}
                    <button type="button" className="bk-link" onClick={() => navigate('/menus')}>Order from our menu</button>.
                  </p>
                  <div className="bk-nav" style={{ justifyContent: 'center' }}>
                    <button type="button" className="bk-btn outline" onClick={() => setScopeMode(false)}>← Back to services</button>
                  </div>
                </div>
              ) : !planMode ? (
                <HeroLayout
                  cards={HERO_CARDS}
                  onSelect={pickHeroCard}
                  onPrimaryAction={() => pickService('event')}
                />
              ) : (
                <PlanByBudget
                  onBack={() => setPlanMode(false)}
                  onAddedToCart={() => navigate('/cart')}
                />
              )}
            </div>
          </section>
        )}

        {/* ═══════════════════════ MAIN CONTENT (STEPS 1-4 & SUCCESS) ═══════════════════════ */}
        {step >= 1 && (
          <section style={{ 
            background: 'var(--bg-subtle)', 
            paddingTop: 'calc(4rem + 80px)',
            paddingBottom: '6rem',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div className="bk-container" style={{ padding: '0 1.5rem', width: '100%', margin: 'auto' }}>

          {/* ── STEPPER RAIL + STEP CONTENT ──
              The stepper used to be a centred horizontal strip above the card, which
              meant the running total only appeared at step 4. It is a sticky rail
              now, so "what have I picked and what does it cost" is answerable from
              step 2 onward. Below 1020 the rail collapses to a progress bar. */}
          {step >= 1 && (
            <div className="bk-layout">
              <aside className="bk-rail">
                <div className="bk-rail-inner">
                  <ol className="bk-stepper">
                    {stepLabels.map((label, i) => {
                      const num = i + 1;
                      const state = step === num ? 'active' : step > num ? 'done' : '';
                      return (
                        <li key={label} className={`bk-step-item ${state}`}>
                          <span className="bk-step-num">
                            {step > num
                              ? <Check size={14} strokeWidth={2.25} aria-hidden="true" />
                              : num}
                          </span>
                          <span className="bk-step-label">{label}</span>
                        </li>
                      );
                    })}
                  </ol>

                  {/* Progress bar counterpart, shown only where the rail is hidden. */}
                  <div className="bk-progress" aria-hidden="true">
                    <div className="bk-progress-head">
                      <span>Step {step} of {stepLabels.length}</span>
                      <span>{stepLabels[step - 1]}</span>
                    </div>
                    <div className="bk-progress-track">
                      <div className="bk-progress-fill" style={{ width: `${(step / stepLabels.length) * 100}%` }} />
                    </div>
                  </div>

                  {/* Running total. Reads the same figures step 4 sums — no new
                      endpoint, the calculation was already at component scope. */}
                  <div className="bk-summary">
                    <div className="bk-summary-kicker">Estimated total</div>
                    <div className="bk-summary-total">{fmtPHP(grandTotal)}</div>
                    <dl className="bk-summary-list">
                      {eventScope && (
                        <div>
                          <dt>Service</dt>
                          <dd>{scopeLabel(eventScope)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Event type</dt>
                        <dd>{EVENT_TYPES.find(t => t.value === eventType)?.label ?? (eventType || 'not set')}</dd>
                      </div>
                      <div>
                        <dt>Guests</dt>
                        <dd>{guests || 'not set'}</dd>
                      </div>
                      <div>
                        <dt>{serviceFlow === 'rentals' ? 'Rentals' : 'Package'}</dt>
                        <dd>
                          {serviceFlow === 'rentals'
                            ? (rentalTotal > 0 ? 'selected' : 'none yet')
                            : !hasFood
                            ? 'none (styling only)'
                            : (selectedPkg?.packageName ?? 'not chosen')}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </aside>

              <div className="bk-main">

          {/* ═══════ STEP 1 — CONTACT ═══════ */}
          {step === 1 && (
            <div className="bk-card">
              <h2 className="bk-heading">Contact Details</h2>
              <p className="bk-sub">Let us know how to reach you for your event.</p>

              <div className="bk-grid">
                <div className="bk-field">
                  <label htmlFor="booking-full-name" className="bk-label">Full Name</label>
                  <input className="bk-input" placeholder="Juan Dela Cruz" value={fullName} onChange={e => setFullName(e.target.value)} id="booking-full-name"/>
                </div>
                <div className="bk-field">
                  <label htmlFor="booking-email-address" className="bk-label">Email Address</label>
                  <input className="bk-input" type="email" placeholder="juan@example.com" value={email} onChange={e => setEmail(e.target.value)} id="booking-email-address"/>
                </div>
                <div className="bk-field">
                  <label htmlFor="booking-phone-number" className="bk-label">Phone Number</label>
                  <PhoneNumberInput className="bk-input" value={phone} onChange={setPhone}  id="booking-phone-number"/>
                </div>
              </div>

              <div style={{ marginTop: '1.2rem' }}>
                <label className="bk-label" style={{ marginBottom: '.6rem', display: 'block' }}>
                  Venue Address
                </label>
                <VenueAddressFields
                  value={venue}
                  onChange={setVenue}
                  fieldClassName="bk-field"
                  labelClassName="bk-label"
                  inputClassName="bk-input"
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1.1rem' }}
                />
              </div>

              <div className="bk-nav">
                <button className="bk-btn outline" onClick={() => { setStep(0); setServiceFlow(null); setServiceScope(null); }}>← Change Service</button>
                <button className="bk-btn primary" disabled={!contactComplete} onClick={() => setStep(2)}>
                  Next → Event Details
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 2 — EVENT / DELIVERY ═══════ */}
          {step === 2 && (
            <div className="bk-card">
              <h2 className="bk-heading">Event Details</h2>
              <p className="bk-sub">
                {serviceFlow === 'rentals'
                  ? 'Tell us about the event your rentals are for so we can schedule delivery and pickup.'
                  : 'Tell us about your celebration so we can prepare the perfect setup.'}
              </p>

              <div className="bk-field full" style={{ marginBottom: '1.2rem' }}>
                <label className="bk-label">Event Type{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                <div className="bk-type-grid">
                  {EVENT_TYPES.map(t => (
                    <div key={t.value} className={`bk-type-card${eventType === t.value ? ' active' : ''}`} onClick={() => chooseEventType(t.value)}>
                      <span className="bk-type-icon">{t.icon}</span>
                      <span className="bk-type-label">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Event-type-specific details.
                  Renders nothing at all when no type is chosen, which also covers the
                  bookings that never have one — the backend leaves EventType null for a
                  FoodDelivery, and every field here would be rejected for it. */}
              {detailGroup === 'couple' && (
                <div className="bk-grid" style={{ marginBottom: '1.2rem' }}>
                  <div className="bk-field">
                    <label htmlFor="booking-grooms-name" className="bk-label">Groom's Name{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                    <input className="bk-input" value={groomName} onChange={e => setGroomName(e.target.value)} placeholder="Full name" id="booking-grooms-name"/>
                  </div>
                  <div className="bk-field">
                    <label htmlFor="booking-brides-name" className="bk-label">Bride's Name{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                    <input className="bk-input" value={brideName} onChange={e => setBrideName(e.target.value)} placeholder="Full name" id="booking-brides-name"/>
                  </div>
                </div>
              )}

              {/* Birthday and Debut take an identical field set, so they share one block
                  rather than being duplicated per type. */}
              {detailGroup === 'celebrant' && (
                <div className="bk-grid" style={{ marginBottom: '1.2rem' }}>
                  <div className="bk-field">
                    <label htmlFor="booking-celebrants-name" className="bk-label">Celebrant's Name{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                    <input className="bk-input" value={celebrantName} onChange={e => setCelebrantName(e.target.value)} placeholder="Full name" id="booking-celebrants-name"/>
                  </div>
                  <div className="bk-field">
                    <label className="bk-label">Celebrant's Sex{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                    <select className="bk-input" value={celebrantSex} onChange={e => setCelebrantSex(e.target.value)}>
                      <option value="">Select…</option>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="bk-field">
                    <label htmlFor="booking-celebrants-age" className="bk-label">Celebrant's Age{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                    <input
                      className="bk-input"
                      type="number"
                      min={0}
                      max={130}
                      value={celebrantAge}
                      onChange={e => setCelebrantAge(e.target.value)}
                      placeholder="e.g. 18"
                    id="booking-celebrants-age"/>
                  </div>
                </div>
              )}

              {detailGroup === 'named' && (
                <div className="bk-field full" style={{ marginBottom: '1.2rem' }}>
                  <label htmlFor="booking-event-name" className="bk-label">Event Name{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                  <input className="bk-input" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. Annual Awards Night" id="booking-event-name"/>
                </div>
              )}

              {/* Motif & theme. Optional throughout — a customer who hasn't decided yet
                  can leave these blank and the events team follows up. Open for Full
                  Event and Styling Only; collapsed, never removed, for Catering Alone. */}
              {detailGroup !== 'none' && eventScope === 'CateringOnly' && (
                <div className="bk-disclosure">
                  <button
                    type="button"
                    className="bk-disclosure-toggle"
                    aria-expanded={stylingOpen || Boolean(motif || theme)}
                    onClick={() => setStylingOpen((o) => !o)}
                  >
                    <span>Add styling (motif &amp; theme)</span>
                    <span aria-hidden="true">{stylingOpen || motif || theme ? '−' : '+'}</span>
                  </button>
                  {!(stylingOpen || motif || theme) && (
                    <p className="bk-hint">Catering Alone leaves styling out. Open this if you'd still like a motif or backdrop.</p>
                  )}
                </div>
              )}
              {detailGroup !== 'none' && (eventScope !== 'CateringOnly' || stylingOpen || Boolean(motif || theme)) && (
                <div className="bk-grid" style={{ marginBottom: '1.2rem' }}>
                  <div className="bk-field">
                    <label htmlFor="booking-motif-optional" className="bk-label">Motif (optional)</label>
                    <input className="bk-input" value={motif} onChange={e => setMotif(e.target.value)} placeholder="e.g. Sage green and blush" id="booking-motif-optional"/>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={e => pickImage('motif', e.target.files?.[0] ?? null)}
                      style={{ marginTop: '0.5rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-muted)' }}
                      aria-label="Motif reference image"
                    />
                    {motifPreview && (
                      <img
                        src={motifPreview}
                        alt="Motif reference preview"
                        style={{ marginTop: '0.5rem', width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 'var(--r-lg)' }}
                      />
                    )}
                  </div>
                  <div className="bk-field">
                    <label htmlFor="booking-theme-optional" className="bk-label">Theme (optional)</label>
                    <input className="bk-input" value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g. Rustic garden" id="booking-theme-optional"/>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={e => pickImage('theme', e.target.files?.[0] ?? null)}
                      style={{ marginTop: '0.5rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-muted)' }}
                      aria-label="Theme reference image"
                    />
                    {themePreview && (
                      <img
                        src={themePreview}
                        alt="Theme reference preview"
                        style={{ marginTop: '0.5rem', width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 'var(--r-lg)' }}
                      />
                    )}
                  </div>
                </div>
              )}

              {imageError && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--danger)', marginBottom: '1rem' }}>
                  {imageError}
                </p>
              )}

              {/* Serving style and dietary needs: catering scopes only. Serving style is
                  required (the server refuses a catering plan without one); drop-off is
                  not a style, it's the delivery order on the menu page. */}
              {hasFood && (
                <div style={{ marginBottom: '1.2rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                  <div className="bk-field full">
                    <span className="bk-label" id="booking-serving-style">Serving Style</span>
                    {renderServingStyle('serving-style-step2')}
                    <p className="bk-hint">
                      Need the food dropped off with no staff?{' '}
                      <button type="button" className="bk-link" onClick={() => navigate('/menus')}>Order a delivery from the menu</button> instead.
                    </p>
                  </div>
                  <div className="bk-field full">
                    <label htmlFor="booking-dietary" className="bk-label">Dietary Requirements (optional)</label>
                    <textarea
                      id="booking-dietary"
                      className="bk-input"
                      rows={3}
                      maxLength={500}
                      value={dietaryRequirements}
                      onChange={(e) => setDietaryRequirements(e.target.value)}
                      placeholder="e.g. two guests with coeliac disease, one halal, no pork for the head table"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                </div>
              )}

              <div className="bk-grid">
                <div className="bk-field">
                  <label htmlFor="booking-expected-guests" className="bk-label">Expected Guests{serviceFlow === 'rentals' ? ' (optional)' : ''}</label>
                  <input className="bk-input" type="number" min={1} value={guests} onChange={e => setGuests(Number(e.target.value) || 1)} id="booking-expected-guests"/>
                </div>
                <div className="bk-field">
                  <label htmlFor="booking-event-date" className="bk-label">Event Date</label>
                  <input className="bk-input" type="date" min={earliestBookingDate} value={eventDate} onChange={e => setEventDate(e.target.value)} id="booking-event-date"/>
                  {/* The lead-time message wins over availability: a too-soon date will
                      be rejected regardless of how many slots that day has open. */}
                  {dateTooSoon ? (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 400, color: 'var(--danger)', marginTop: '0.3rem', display: 'block' }}>
                      We need at least {bookingRules?.minLeadDaysFullService ?? 7} days' notice — the earliest date we can take is {fmtLeadDate(earliestBookingDate)}.
                    </span>
                  ) : !eventDate && bookingRules && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem', display: 'block' }}>
                      Earliest available: {fmtLeadDate(earliestBookingDate)} ({bookingRules.minLeadDaysFullService} days' notice).
                    </span>
                  )}
                  {!dateTooSoon && dateChecking && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem', display: 'block' }}>
                      Checking availability…
                    </span>
                  )}
                  {!dateTooSoon && !dateChecking && dateStatus?.isLocked && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 400, color: 'var(--danger)', marginTop: '0.3rem', display: 'block' }}>
                      {dateStatus.isManuallyLocked
                        ? 'This date is closed for bookings. Please choose another.'
                        : `This date is fully booked (${dateStatus.confirmedCount} of ${dateStatus.maxCapacity} events). Please choose another.`}
                    </span>
                  )}
                  {!dateTooSoon && !dateChecking && dateStatus && !dateStatus.isLocked && dateStatus.confirmedCount > 0 && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem', display: 'block' }}>
                      {dateStatus.maxCapacity - dateStatus.confirmedCount} of {dateStatus.maxCapacity} slots still open on this date.
                    </span>
                  )}
                </div>
                <div className="bk-field">
                  <label htmlFor="booking-start-time" className="bk-label">Start Time</label>
                  <input className="bk-input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} id="booking-start-time"/>
                </div>
                <div className="bk-field">
                  <label htmlFor="booking-end-date" className="bk-label">End Date</label>
                  <input className="bk-input" type="date" min={eventDate || today} value={endDate} onChange={e => setEndDate(e.target.value)} id="booking-end-date"/>
                </div>
                <div className="bk-field">
                  <label htmlFor="booking-end-time" className="bk-label">End Time</label>
                  <input className="bk-input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} id="booking-end-time"/>
                </div>
              </div>

              <div className="bk-nav">
                <button className="bk-btn outline" onClick={() => setStep(1)}>← Back</button>
                <button
                  className="bk-btn primary"
                  disabled={!eventComplete}
                  onClick={() => setStep(3)}
                >
                  {serviceFlow === 'event' ? `Next → ${stepLabels[2]}` : 'Next → Rentals & Add‑ons'}
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 3 — SELECTIONS ═══════ */}
          {step === 3 && (
            <div className="bk-card">
              <h2 className="bk-heading">
                {stepLabels[2]}
              </h2>
              <p className="bk-sub">
                {serviceFlow === 'event' && !hasFood
                  ? 'Choose the decor, furniture and services for your event.'
                  : serviceFlow === 'event'
                  ? 'Choose a curated package and any add-ons for your event.'
                  : serviceFlow === 'rentals'
                  ? 'Select the items you need for your event.'
                  : 'Pick dishes and trays for your delivery.'}
              </p>

              {catalogLoading ? (
                <div aria-live="polite" aria-busy="true">
                  <div className="bk-skel-kicker">Loading · step 3 catalog</div>
                  <div className="bk-skel-rows">
                    <div className="bk-skel" style={{ width: '62%' }} />
                    <div className="bk-skel" style={{ width: '88%' }} />
                    <div className="bk-skel" style={{ width: '74%' }} />
                  </div>
                  <span className="sr-only">Loading catalog…</span>
                </div>
              ) : catalogError ? (
                <div className="bk-error" role="alert">
                  <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
                  <div>
                    <div className="bk-error-title">{catalogError}</div>
                    <div className="bk-error-body">Everything you've chosen so far is still here. Try again in a moment.</div>
                  </div>
                </div>
              ) : (
                <>

                  {/* Styling Only has no food; adding some makes it Full Event, and says so. */}
                  {serviceFlow === 'event' && !hasFood && (
                    <p className="bk-cart-note">
                      <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span>
                        Event Styling Only doesn't include food.{' '}
                        <button type="button" className="bk-link" onClick={addFoodToStylingOnly}>Add food to this event</button>
                        {' '}to switch to Full Event Catering.
                      </span>
                    </p>
                  )}
                  {scopeSwitched && hasFood && (
                    <div className="bk-cart-note" role="status" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <span>
                        This is now <strong>Full Event Catering</strong>: food and styling.
                        {!servingStyle && ' Choose how the food will be served:'}
                      </span>
                      {!servingStyle && renderServingStyle('serving-style-step3')}
                    </div>
                  )}

                  {/* ── PACKAGE PATH ── */}
                  {hasFood && (
                    <div style={{ marginBottom: '2rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>Select a Package</h3>
                        {selectedPackageId && (
                          <button className="bk-btn outline" style={{ fontSize: '.55rem', padding: '.4rem .8rem' }} onClick={() => { setSelectedPackageId(null); setPackageTemplate(null); }}>Clear Selection</button>
                        )}
                      </div>

                      {eligiblePackages.length === 0 && (
                        <p className="bk-hint">
                          {packagesForEvent.length === 0
                            ? `We don't have a package for a ${EVENT_TYPES.find((t) => t.value === eventType)?.label.toLowerCase() ?? 'this kind of'} event yet. Build your event from the add-ons below, or go back to change the event type.`
                            : `No ${EVENT_TYPES.find((t) => t.value === eventType)?.label.toLowerCase() ?? ''} package fits ${guests} guests. Go back to adjust the guest count, or build your event from the add-ons below.`}
                        </p>
                      )}
                      <div className="bk-catalog-grid">
                        {eligiblePackages.map(pkg => {
                          return (
                            <div
                              key={pkg.id}
                              className={`bk-catalog-card${selectedPackageId === pkg.id ? ' selected' : ''}`}
                              onClick={() => {
                                setSelectedPackageId(pkg.id);
                                void loadTemplate(pkg.id);
                              }}
                            >
                              <div className="bk-catalog-name">{pkg.packageName}</div>
                              <div className="bk-catalog-meta">{pkg.minPax}–{pkg.maxPax} pax</div>
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

                  {/* ── ADD-ONS PATH ── */}
                  <div>
                    {serviceFlow === 'event' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>{hasFood ? 'Add-Ons' : 'À la Carte'}</h3>
                      </div>
                    )}

                      {/* Tabs */}
                      <div className="bk-tabs">
                        {showFoodTabs && (
                          <>
                            <button className={`bk-tab${alacarteTab === 'dishes' ? ' active' : ''}`} onClick={() => setAlacarteTab('dishes')}>Dishes</button>
                            <button className={`bk-tab${alacarteTab === 'trays' ? ' active' : ''}`} onClick={() => setAlacarteTab('trays')}>Trays</button>
                          </>
                        )}
                        {(serviceFlow === 'event' || serviceFlow === 'rentals') && (
                          <button className={`bk-tab${alacarteTab === 'rentals' ? ' active' : ''}`} onClick={() => setAlacarteTab('rentals')}>Rentals</button>
                        )}
                        {serviceTabs.map((t) => (
                          <button key={t.key} className={`bk-tab${alacarteTab === t.key ? ' active' : ''}`} onClick={() => setAlacarteTab(t.key)}>{t.label}</button>
                        ))}
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

                      {/* Service tabs, one per category */}
                      {isServiceTab(alacarteTab) && (
                        <div className="bk-catalog-grid">
                          {serviceItems
                            .filter(s => s.isActive && (alacarteTab === 'OtherServices' ? !s.category : s.category === alacarteTab))
                            .map(item => (
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
                  disabled={!canProceedStep3}
                  onClick={() => setStep(4)}
                >
                  Next → Review
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 4 — REVIEW ═══════ */}
          {step === 4 && (
            <div className="bk-card">
              <h2 className="bk-heading">Review & Add to Cart</h2>
              <p className="bk-sub">Check the details and today's price. Nothing is booked until you place the order at checkout.</p>

              {/* Contact Summary */}
              <div className="bk-review-section">
                <div className="bk-review-title">Contact Information</div>
                <div className="bk-review-row"><span className="bk-review-label">Name</span><span className="bk-review-value">{fullName}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Email</span><span className="bk-review-value">{email}</span></div>
                <div className="bk-review-row"><span className="bk-review-label">Phone</span><span className="bk-review-value">{phone}</span></div>
                {composeVenueAddress(venue) && (
                  <div className="bk-review-row"><span className="bk-review-label">Address</span><span className="bk-review-value">{composeVenueAddress(venue)}</span></div>
                )}
              </div>

              {/* Event Summary */}
              <div className="bk-review-section">
                <div className="bk-review-title">Event Details</div>
                {eventScope && (
                  <div className="bk-review-row"><span className="bk-review-label">Service</span><span className="bk-review-value">{scopeLabel(eventScope)}</span></div>
                )}
                {hasFood && servingStyle && (
                  <div className="bk-review-row"><span className="bk-review-label">Serving Style</span><span className="bk-review-value">{servingStyleLabel(servingStyle)}</span></div>
                )}
                {hasFood && dietaryRequirements.trim() && (
                  <div className="bk-review-row"><span className="bk-review-label">Dietary Requirements</span><span className="bk-review-value" style={{ whiteSpace: 'pre-wrap' }}>{dietaryRequirements.trim()}</span></div>
                )}
                {(motif.trim() || theme.trim()) && (
                  <div className="bk-review-row"><span className="bk-review-label">Motif / Theme</span><span className="bk-review-value">{[motif.trim(), theme.trim()].filter(Boolean).join(' · ')}</span></div>
                )}
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
                    <div className="bk-review-row"><span className="bk-review-label">Package</span><span className="bk-review-value">{selectedPkg.packageName} — {fmtPHP(quotedLineTotal('Package', selectedPkg.id, packagePrice))}</span></div>
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
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{item.itemName} ×{qty}</span><span className="bk-review-value">{fmtPHP(quotedLineTotal('MenuItem', id, (item.pricePerTray ?? 0) * qty))}</span></div>;
                })}
                {Object.entries(menuTrayQty).map(([id, qty]) => {
                  const tray = menuTrays.find(t => t.id === id);
                  if (!tray) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{tray.trayName} ×{qty}</span><span className="bk-review-value">{fmtPHP(quotedLineTotal('MenuTray', id, tray.pricePerTray * qty))}</span></div>;
                })}
                {Object.entries(rentalQty).map(([id, qty]) => {
                  const item = rentalItems.find(r => r.id === id);
                  if (!item) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{item.itemName} ×{qty}</span><span className="bk-review-value">{fmtPHP(quotedLineTotal('Rental', id, item.unitPrice * qty))}</span></div>;
                })}
                {Object.entries(serviceQty).map(([id, qty]) => {
                  const item = serviceItems.find(s => s.id === id);
                  if (!item) return null;
                  return <div key={id} className="bk-review-row"><span className="bk-review-label">{item.serviceName} ×{qty}</span><span className="bk-review-value">{fmtPHP(quotedLineTotal('Service', id, item.unitCost * qty))}</span></div>;
                })}

                <div className="bk-review-total">
                  {/* A refused quote prices nothing (its total is 0), so the local estimate stays up. */}
                  <span>{planQuote?.quote?.canCheckout ? 'Total' : 'Estimated Total'}</span>
                  <span>{fmtPHP(planQuote?.quote?.canCheckout ? planQuote.quote.total : grandTotal)}</span>
                </div>
              </div>

              {/* What the server says about this booking today: the same checks
                  checkout will run, so a refusal shows here instead of there. */}
              {!planQuote && (
                <p className="bk-loading" aria-live="polite">
                  <span className="bk-spinner" /> Checking today's prices and availability…
                </p>
              )}
              {planQuote?.error && (
                <div className="bk-error" role="alert">
                  <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
                  <div>
                    <div className="bk-error-title">{planQuote.error}</div>
                    <div className="bk-error-body">Your booking isn't lost — go back a step and return to try again.</div>
                  </div>
                </div>
              )}
              {planQuote?.quote && !planQuote.quote.canCheckout && (
                <div className="bk-error" role="alert">
                  <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
                  <div>
                    <div className="bk-error-title">This booking can't be placed as it is</div>
                    <div className="bk-error-body">
                      <ul style={{ margin: '.3rem 0 .4rem', paddingLeft: '1.1rem' }}>
                        {planQuote.quote.problems.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))}
                      </ul>
                      Go back to fix it: the date and time are on step 2, the selections on step 3.
                    </div>
                  </div>
                </div>
              )}
              {(motifImage || themeImage) && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '.75rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
                  Your reference images are kept for checkout in this tab only. Refreshing before you place the order will lose them.
                </p>
              )}

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
                  disabled={!termsAgreed || !planQuote?.quote?.canCheckout}
                  onClick={addToCart}
                >
                  Add to cart
                </button>
              </div>
            </div>
          )}

              </div>
            </div>
          )}

            </div>
          </section>
        )}
      </main>
                            <SiteFooter />
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

    </>
  );
}


