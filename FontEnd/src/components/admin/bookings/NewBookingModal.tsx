/**
 * The admin's "new booking" composer: find or create the customer, then open a
 * Draft for them.
 *
 * Lifted out of AdminDashboardPage. It takes three callbacks and nothing else —
 * every field, the customer search and the lead-time rules are its own state —
 * which is what let it move while most of that page cannot.
 *
 * The lead-time gate here is advisory. It reads the configured minimums so the
 * admin finds out before filling the form in, but BookingService.CreateAsync
 * re-checks server-side and is the actual authority.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createBooking,
  BookingApiError,
  type BookingCreatePayload,
  type BookingTypeName,
} from '../../../api/bookingApi';
import {
  SERVICE_SCOPES,
  SERVING_STYLES,
  scopeIncludesFood,
  type ServiceScope,
  type ServingStyle,
} from '../../../lib/serviceScope';
import { getBookingRules, type BookingRules } from '../../../api/calendarApi';
import { isCompletePhPhone, toE164 } from '../../../lib/phone';
import {
  searchCustomers,
  createWalkInCustomer,
  CustomerAdminApiError,
  type AdminCustomer,
} from '../../../api/customerAdminApi';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  type VenueAddress,
} from '../../../lib/venue';
import { PhoneNumberInput } from '../../forms/PhoneNumberInput';
import { VenueAddressFields } from '../../forms/VenueAddressFields';
import { readSession } from '../../../lib/tokenStorage';
import { fmtDate } from '../../../lib/format';

export function NewBookingModal({ onClose, onCreated, notify }: {
  onClose: () => void;
  onCreated: () => void;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [custMode, setCustMode] = useState<'search' | 'new'>('search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminCustomer | null>(null);

  const [wName, setWName] = useState('');
  const [wEmail, setWEmail] = useState('');
  const [wPhone, setWPhone] = useState('');

  const [bookingType, setBookingType] = useState<BookingTypeName>('FullService');
  const [eventType, setEventType] = useState('Wedding');
  /* Service scope. '' means "not recorded", which the API accepts and reads as Full
     Event — a phone reservation often hasn't got that far, and demanding a serving
     style for it would block the walk-in. */
  const [serviceScope, setServiceScope] = useState<ServiceScope | ''>('');
  const [servingStyle, setServingStyle] = useState<ServingStyle | ''>('');
  const [guests, setGuests] = useState('100');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState<VenueAddress>(emptyVenueAddress);
  const [contact, setContact] = useState('');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  /**
   * Which types need the event fields (end date/time, event type, guest count).
   *
   * Deliberately "not a delivery" rather than "is FullService": RentalService is
   * event-dated too, and the backend's BookingCreateDto.Validate() requires those
   * fields for anything that isn't FoodDelivery. Testing for FullService here hid
   * the inputs for a rental and then posted nulls the server rejects.
   */
  const isFull = bookingType !== 'FoodDelivery';
  const toHms = (t: string) => (t.length === 5 ? `${t}:00` : t);

  /* Walk-ins go through the same Bookingservice.CreateAsync as the customer wizard, so
     the same lead-time rule applies. Fetched rather than hardcoded — it's an
     owner-editable setting. A failed fetch leaves the picker unconstrained and the
     server as the only gate, which is how it behaved before. */
  const [leadRules, setLeadRules] = useState<BookingRules | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBookingRules()
      .then((r) => { if (!cancelled) setLeadRules(r); })
      .catch(() => { if (!cancelled) setLeadRules(null); });
    return () => { cancelled = true; };
  }, []);

  // RentalService follows the full-service lead time; only FoodDelivery is shorter.
  const earliestDate = isFull
    ? leadRules?.earliestFullServiceDate
    : leadRules?.earliestDeliveryDate;
  const leadDays = isFull ? leadRules?.minLeadDaysFullService : leadRules?.minLeadDaysDelivery;
  const dateTooSoon = Boolean(eventDate) && Boolean(earliestDate) && eventDate < earliestDate!;

  const runSearch = async () => {
    const session = readSession();
    if (!session) { setError('You are signed out. Sign in as Owner/Assistant.'); return; }
    setSearching(true); setError('');
    try {
      setResults(await searchCustomers(session.token, q));
    } catch (err) {
      setError(err instanceof CustomerAdminApiError ? err.message : 'Customer search failed.');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => { void runSearch(); /* initial list */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const session = readSession();
    if (!session) { setError('You are signed out. Sign in as Owner/Assistant.'); return; }

    if (!eventDate || !startTime || !isVenueAddressComplete(venue)) { setError('Fill in date, time, and the venue street and city.'); return; }
    if (dateTooSoon) {
      setError(`This booking type needs ${leadDays} day(s) of notice — the earliest date is ${fmtDate(earliestDate!)}.`);
      return;
    }
    if (isFull) {
      if (!endDate || !endTime) { setError('Full-service events need an end date and time.'); return; }
      if (new Date(`${endDate}T${toHms(endTime)}`) <= new Date(`${eventDate}T${toHms(startTime)}`)) {
        setError('The event must end after it starts.'); return;
      }
      if (!eventType || Number(guests) < 1) { setError('Pick an event type and guest count.'); return; }
      /* The same rule the API applies: once a scope that includes food is sent, it
         needs a serving style. Checked here so the modal says so before the round trip. */
      if (serviceScope && scopeIncludesFood(serviceScope) && !servingStyle) {
        setError('Pick a serving style for this service, or leave the service blank.'); return;
      }
    }

    setCreating(true); setError('');
    try {
      let customerId: string;
      if (custMode === 'search') {
        if (!selected) { setError('Select a customer, or switch to New walk-in.'); setCreating(false); return; }
        customerId = selected.id;
      } else {
        if (!wName.trim() || !wEmail.trim() || !isCompletePhPhone(wPhone)) { setError('Fill in the walk-in name, email, and a complete phone number.'); setCreating(false); return; }
        // WalkInCustomerDto enforces E.164, so the display mask is stripped here.
        const made = await createWalkInCustomer(session.token, { fullName: wName.trim(), email: wEmail.trim(), phoneNumber: toE164(wPhone) });
        customerId = made.id;
      }

      const payload: BookingCreatePayload = {
        customerId,
        bookingType,
        eventDate,
        startTime: toHms(startTime),
        endDate: isFull ? endDate : null,
        endTime: isFull ? toHms(endTime) : null,
        eventType: isFull ? eventType : null,
        venueAddress: composeVenueAddress(venue),
        guestCount: isFull ? Number(guests) : null,
        contactNumber: contact.trim() || null,
        /* Sent only when staff actually chose a scope; otherwise the booking carries
           none, exactly as it did before scope existed. */
        service: isFull && serviceScope
          ? { serviceScope, servingStyle: scopeIncludesFood(serviceScope) ? (servingStyle || null) : null }
          : null,
      };
      await createBooking(session.token, payload);
      notify('success', 'Draft booking created. Open it to add items and submit.');
      onCreated();
    } catch (err) {
      setError(
        err instanceof CustomerAdminApiError ? err.message
          : err instanceof BookingApiError ? err.message
          : 'Could not create the booking. Please try again.',
      );
      setCreating(false);
    }
  };

  return createPortal(
    <div className="adm-modal-overlay" onClick={() => !creating && onClose()}>
      <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New booking" style={{ maxWidth: 580 }}>
        <h3>New Booking</h3>

        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem' }}>
          <button type="button" className={`adm-btn${custMode === 'search' ? ' primary' : ''}`} onClick={() => setCustMode('search')}>Existing customer</button>
          <button type="button" className={`adm-btn${custMode === 'new' ? ' primary' : ''}`} onClick={() => setCustMode('new')}>New walk-in</button>
        </div>

        {custMode === 'search' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input className="adm-input" aria-label="Search customers by name or email" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }} style={{ flex: 1 }} />
              <button type="button" className="adm-btn" onClick={() => void runSearch()} disabled={searching}>{searching ? '…' : 'Search'}</button>
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
              {results.length === 0 ? (
                <div style={{ padding: '0.8rem', color: 'var(--text-dim)', fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}>No customers found.</div>
              ) : results.map((c) => (
                <button key={c.id} type="button" onClick={() => setSelected(c)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.8rem', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  background: selected?.id === c.id ? 'var(--primary-muted)' : 'transparent',
                  fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-primary)',
                }}>
                  <strong>{c.fullName}</strong> · <span style={{ color: 'var(--text-muted)' }}>{c.email}</span>
                  {!c.isActive && <span style={{ color: 'var(--danger)' }}> (inactive)</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="form-grid" style={{ marginBottom: '1rem' }}>
            <div className="form-row"><label htmlFor="admin-dashboard-full-name">Full name</label><input className="adm-input" value={wName} onChange={(e) => setWName(e.target.value)}  id="admin-dashboard-full-name"/></div>
            <div className="form-row"><label htmlFor="admin-dashboard-email">Email</label><input className="adm-input" type="email" value={wEmail} onChange={(e) => setWEmail(e.target.value)}  id="admin-dashboard-email"/></div>
            <div className="form-row"><label htmlFor="admin-dashboard-phone">Phone</label><PhoneNumberInput className="adm-input" value={wPhone} onChange={setWPhone}  id="admin-dashboard-phone"/></div>
          </div>
        )}

        <div className="form-grid">
          <div className="form-row"><label>Booking type</label>
            <select className="adm-input" value={bookingType} onChange={(e) => setBookingType(e.target.value as BookingTypeName)}>
              <option value="FullService">Full-service event</option>
              <option value="FoodDelivery">Food delivery</option>
              <option value="RentalService">Rental items only</option>
            </select>
          </div>
          {isFull && (
            <div className="form-row"><label>Event type</label>
              <select className="adm-input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option>Wedding</option><option>Corporate</option><option>Birthday</option><option>Debut</option><option>Others</option>
              </select>
            </div>
          )}
          {isFull && (
            <div className="form-row"><label>Service (optional)</label>
              <select
                className="adm-input"
                value={serviceScope}
                onChange={(e) => {
                  const next = e.target.value as ServiceScope | '';
                  setServiceScope(next);
                  if (!next || !scopeIncludesFood(next)) setServingStyle('');
                }}
              >
                <option value="">Not recorded</option>
                {SERVICE_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
          {isFull && serviceScope && scopeIncludesFood(serviceScope) && (
            <div className="form-row"><label>Serving style</label>
              <select className="adm-input" value={servingStyle} onChange={(e) => setServingStyle(e.target.value as ServingStyle | '')}>
                <option value="">Select…</option>
                {SERVING_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
          {isFull && <div className="form-row"><label htmlFor="admin-dashboard-guests">Guests</label><input className="adm-input" type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)}  id="admin-dashboard-guests"/></div>}
          <div className="form-row">
            <label htmlFor="admin-dashboard-event-date">{isFull ? 'Event date' : 'Delivery date'}</label>
            <input id="admin-dashboard-event-date" className="adm-input" type="date" min={earliestDate} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            {earliestDate && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 300, color: dateTooSoon ? 'var(--danger)' : 'var(--text-dim)', textTransform: 'none', letterSpacing: 'normal' }}>
                Earliest: {fmtDate(earliestDate)} ({leadDays} days' notice)
              </span>
            )}
          </div>
          <div className="form-row"><label htmlFor="admin-dashboard-start-time">{isFull ? 'Start time' : 'Delivery time'}</label><input id="admin-dashboard-start-time" className="adm-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          {isFull && <div className="form-row"><label htmlFor="admin-dashboard-end-date">End date</label><input className="adm-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}  id="admin-dashboard-end-date"/></div>}
          {isFull && <div className="form-row"><label htmlFor="admin-dashboard-end-time">End time</label><input className="adm-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}  id="admin-dashboard-end-time"/></div>}
          <div className="form-row"><label htmlFor="admin-dashboard-contact-number-optional">Contact number (optional)</label><PhoneNumberInput className="adm-input" value={contact} onChange={setContact}  id="admin-dashboard-contact-number-optional"/></div>
        </div>

        <VenueAddressFields
          value={venue}
          onChange={setVenue}
          fieldClassName="form-row"
          inputClassName="adm-input"
          labels={{ street: isFull ? 'Venue street' : 'Delivery street' }}
        />

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.6rem', fontFamily: 'var(--font-body)' }}>{error}</div>}

        <div className="form-actions">
          <button type="button" className="adm-btn" onClick={onClose} disabled={creating}>Cancel</button>
          <button type="button" className="adm-btn primary" onClick={() => void create()} disabled={creating}>{creating ? 'Creating…' : 'Create Draft'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Chat Support (item 3) — customer ↔ staff. Lists every thread, opens one to
   reply, live-refreshes via the "SupportMessage" event on the payment hub.
───────────────────────────────────────────────────────────────────────── */
/* Inbox ordering: urgency band first, most-recent-activity within each band. Threads
   with no draft yet (every thread while drafting is off) share one rank, so the list
   falls back to exactly the LastMessageAt ordering it has always had. */
