import { useState } from 'react';
import {
  getBudgetSuggestions,
  materializeProposal,
  SuggestionsApiError,
  type BudgetSuggestionRequest,
  type MaterializeRequest,
  type Proposal,
  type SuggestionSetResponse,
} from '../../api/suggestionsApi';
import { BookingApiError } from '../../api/bookingApi';
import { readSession } from '../../lib/tokenStorage';
import { ProposalCard, ProposalCardStyles } from './ProposalCard';
import { PhoneNumberInput } from '../forms/PhoneNumberInput';
import { VenueAddressFields } from '../forms/VenueAddressFields';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  type VenueAddress,
} from '../../lib/venue';

/*
 * Plan by Budget — relocated out of CustomerDashboardPage into BookingPage's Step 0.
 * Self-contained (`pbg-` prefix) so it drops into any surface. Guests may survey
 * (POST /api/suggestions/budget is anonymous); turning a plan into a Draft requires
 * login (materialize is customer-only) and hands off to onMaterialized afterward.
 *
 * GOLDEN RULE: every money figure is rendered from the response, never recomputed.
 */

const fmt = (n: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

export interface PlanByBudgetProps {
  /** "Change Service" — back to the flow picker. */
  onBack: () => void;
  /** A guest clicked "Use this plan"; caller should route to login. */
  onRequireLogin: () => void;
  /** A Draft was created; caller routes to it (e.g. My Bookings) so it can be reviewed + submitted. */
  onMaterialized: (bookingId: string) => void;
}

export function PlanByBudget({ onBack, onRequireLogin, onMaterialized }: PlanByBudgetProps) {
  const [budget, setBudget] = useState('50000');
  const [guestCount, setGuestCount] = useState('100');
  const [eventDate, setEventDate] = useState('');
  const [bookingType, setBookingType] = useState<'FullService' | 'FoodDelivery'>('FullService');
  const [eventType, setEventType] = useState('Wedding');
  const [dietary, setDietary] = useState('');
  const [avoid, setAvoid] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SuggestionSetResponse | null>(null);
  const [authPrompt, setAuthPrompt] = useState(false);

  const [chosen, setChosen] = useState<Proposal | null>(null);
  const [venue, setVenue] = useState<VenueAddress>(emptyVenueAddress);
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [contact, setContact] = useState('');
  const [mBusy, setMBusy] = useState(false);
  const [mError, setMError] = useState('');

  const [done, setDone] = useState<{ bookingId: string; bookingName: string; dropped: number } | null>(null);

  const isFull = bookingType === 'FullService';
  const csv = (s: string): string[] | null => {
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length ? arr : null;
  };
  const toHms = (t: string) => (t.length === 5 ? `${t}:00` : t);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Number(budget) <= 0 || Number(guestCount) <= 0 || !eventDate) {
      setError('Enter a budget, guest count, and event date.');
      return;
    }
    setLoading(true); setError(''); setResult(null); setAuthPrompt(false);
    try {
      const req: BudgetSuggestionRequest = {
        budget: Number(budget),
        guestCount: Number(guestCount),
        eventDate,
        bookingType,
        eventType: isFull ? eventType : null,
        preferences: (dietary || avoid) ? { dietaryTags: csv(dietary), avoidItemCategories: csv(avoid) } : null,
      };
      setResult(await getBudgetSuggestions(readSession()?.token ?? '', req));
    } catch (err) {
      setError(err instanceof SuggestionsApiError ? err.message : 'Could not generate suggestions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openFinalize = (p: Proposal) => {
    if (!readSession()) { setAuthPrompt(true); return; }   // survey is open; creating needs login
    setAuthPrompt(false);
    setChosen(p);
    setEndDate(eventDate);
    setStartTime(''); setEndTime(''); setVenue(emptyVenueAddress); setContact(''); setMError('');
  };

  const materialize = async () => {
    if (!chosen) return;
    const session = readSession();
    if (!session) { onRequireLogin(); return; }
    if (!isVenueAddressComplete(venue) || !startTime || (isFull && (!endDate || !endTime))) {
      setMError('Please fill in the venue street and city, start time, and (for events) end date and time.');
      return;
    }
    if (isFull) {
      const startAt = new Date(`${eventDate}T${toHms(startTime)}`);
      const endAt = new Date(`${endDate || eventDate}T${toHms(endTime)}`);
      if (endAt <= startAt) { setMError('The event must end after it starts — adjust the end date or time.'); return; }
    }
    setMBusy(true); setMError('');
    try {
      const pkgLine = chosen.lines.find((l) => l.type === 'Package');
      const lines = chosen.lines
        .filter((l) => l.type !== 'Package')
        .map((l) => ({ type: l.type, refId: l.refId, quantity: l.quantity }));
      const req: MaterializeRequest = {
        bookingType,
        eventDate,
        startTime: toHms(startTime),
        endDate: isFull ? (endDate || eventDate) : null,
        endTime: isFull ? toHms(endTime) : null,
        eventType: isFull ? eventType : null,
        venueAddress: composeVenueAddress(venue),
        guestCount: isFull ? Number(guestCount) : null,
        contactNumber: contact.trim() || null,
        proposal: {
          packageId: pkgLine ? pkgLine.refId : null,
          lines,
          packageSlotSelections: chosen.packageSlotSelections.map((s) => ({ slotId: s.slotId, itemIds: s.itemIds })),
        },
      };
      const res = await materializeProposal(session.token, req);
      setChosen(null);
      setDone({ bookingId: res.bookingId, bookingName: res.bookingName, dropped: res.droppedLines.length });
    } catch (err) {
      setMError(
        err instanceof SuggestionsApiError ? err.message
          : err instanceof BookingApiError ? err.message
          : 'Could not create the Draft. Please try again.',
      );
    } finally {
      setMBusy(false);
    }
  };

  if (done) {
    return (
      <div className="pbg-wrap">
        <Styles />
        <div className="pbg-card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.8rem', alignItems: 'center' }}>
          <div style={{ fontSize: '2rem' }}>✅</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
            Draft created
          </h2>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 460 }}>
            "{done.bookingName}" is saved as a Draft. Review the details and submit it from My Bookings.
            {done.dropped > 0 && ` (${done.dropped} item(s) couldn't be added and were skipped — you can adjust them there.)`}
          </p>
          <button type="button" className="pbg-btn primary" onClick={() => onMaterialized(done.bookingId)}>
            Review &amp; Submit in My Bookings →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pbg-wrap">
      <Styles />
      <ProposalCardStyles />

      <form onSubmit={submit} className="pbg-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
              Plan by Budget
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem', maxWidth: 520 }}>
              Tell us your budget — we'll suggest complete, kitchen-priced configurations. Browse freely; sign in only when you're ready to turn one into a booking.
            </p>
          </div>
          <button type="button" className="pbg-btn outline" onClick={onBack}>← Change Service</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
          <label><span className="pbg-label">Budget (₱)</span><input className="pbg-input" type="number" min="100" step="100" value={budget} onChange={(e) => setBudget(e.target.value)} required /></label>
          <label><span className="pbg-label">Guests</span><input className="pbg-input" type="number" min="1" value={guestCount} onChange={(e) => setGuestCount(e.target.value)} required /></label>
          <label><span className="pbg-label">Event Date</span><input className="pbg-input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required /></label>
          <label><span className="pbg-label">Type</span>
            <select className="pbg-input" value={bookingType} onChange={(e) => setBookingType(e.target.value as 'FullService' | 'FoodDelivery')}>
              <option value="FullService">Full-service event</option>
              <option value="FoodDelivery">Food delivery</option>
            </select>
          </label>
          {isFull && (
            <label><span className="pbg-label">Occasion</span>
              <select className="pbg-input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="Wedding">Wedding</option>
                <option value="Corporate">Corporate</option>
                <option value="Birthday">Birthday</option>
                <option value="Others">Others</option>
              </select>
            </label>
          )}
        </div>

        <details>
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Preferences (optional)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '0.8rem' }}>
            <label><span className="pbg-label">Prefer dietary tags</span><input className="pbg-input" placeholder="e.g. Vegan, Halal" value={dietary} onChange={(e) => setDietary(e.target.value)} /></label>
            <label><span className="pbg-label">Avoid categories</span><input className="pbg-input" placeholder="e.g. Pork, Seafood" value={avoid} onChange={(e) => setAvoid(e.target.value)} /></label>
          </div>
        </details>

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</div>}
        <button type="submit" className="pbg-btn primary" style={{ alignSelf: 'flex-start' }} disabled={loading}>
          {loading ? 'Finding plans…' : 'Suggest Plans'}
        </button>
      </form>

      {authPrompt && (
        <div className="pbg-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', borderColor: 'var(--border-accent)' }}>
          <span style={{ flex: 1, minWidth: 220, fontFamily: 'var(--font-body)', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
            Sign in to turn a plan into a booking — your options above stay right here.
          </span>
          <button type="button" className="pbg-btn primary" onClick={onRequireLogin}>Sign in</button>
        </div>
      )}

      {result && (
        result.proposals.length === 0 ? (
          <div className="pbg-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', color: 'var(--accent)', marginBottom: '0.6rem' }}>✦</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {result.note ?? 'No plans fit that budget. Try increasing it or lowering the guest count.'}
            </p>
          </div>
        ) : (
          <>
            {result.note && <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{result.note}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
              {result.proposals.map((p) => (
                <ProposalCard key={p.tier} proposal={p} onUse={openFinalize} busy={mBusy && chosen?.tier === p.tier} />
              ))}
            </div>
          </>
        )
      )}

      {chosen && (
        <div className="pbg-overlay" onClick={() => !mBusy && setChosen(null)}>
          <div className="pbg-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Finalize booking details">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>A few event details</h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>{chosen.tier} plan · {fmt(chosen.total)}</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <VenueAddressFields
                value={venue}
                onChange={setVenue}
                labelClassName="pbg-label"
                inputClassName="pbg-input"
                required
                labels={{ street: isFull ? 'Venue street' : 'Delivery street' }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
                <label><span className="pbg-label">{isFull ? 'Start time' : 'Delivery time'}</span><input className="pbg-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></label>
                {isFull && <label><span className="pbg-label">End time</span><input className="pbg-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></label>}
              </div>
              {isFull && <label><span className="pbg-label">End date</span><input className="pbg-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></label>}
              <label><span className="pbg-label">Contact number (optional)</span><PhoneNumberInput className="pbg-input" value={contact} onChange={setContact} /></label>

              {mError && <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{mError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.2rem' }}>
                <button type="button" className="pbg-btn outline" onClick={() => setChosen(null)} disabled={mBusy}>Cancel</button>
                <button type="button" className="pbg-btn primary" onClick={() => void materialize()} disabled={mBusy}>{mBusy ? 'Creating…' : 'Create Draft'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .pbg-wrap { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
      .pbg-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); padding: 1.6rem 1.75rem; }
      .pbg-label { font-family: var(--font-body); font-size: 0.52rem; letter-spacing: 0.26em; text-transform: uppercase; font-weight: 500; color: var(--text-dim); display: block; margin-bottom: 0.4rem; }
      .pbg-input { width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 0.6rem 0.85rem; font-family: var(--font-body); font-size: 0.85rem; color: var(--text-primary); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
      .pbg-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
      select.pbg-input { cursor: pointer; }
      .pbg-btn { font-family: var(--font-body); font-size: 0.62rem; letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500; padding: 0.65rem 1.2rem; border-radius: var(--r-full); cursor: pointer; white-space: nowrap; border: 1px solid transparent; display: inline-flex; align-items: center; gap: 0.4rem; transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s; }
      .pbg-btn.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
      .pbg-btn.primary:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
      .pbg-btn.outline { background: transparent; color: var(--primary); border-color: var(--border-accent); }
      .pbg-btn.outline:hover:not(:disabled) { background: var(--primary-muted); border-color: var(--primary); }
      .pbg-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .pbg-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(20, 14, 8, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
      .pbg-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); padding: 1.6rem 1.75rem; }
    `}</style>
  );
}
