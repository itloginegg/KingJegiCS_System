import { useEffect, useState } from 'react';
import {
  getBudgetSuggestions,
  SuggestionsApiError,
  type BudgetSuggestionRequest,
  type Proposal,
  type SuggestionSetResponse,
} from '../../api/suggestionsApi';
import { fetchMenuTrays } from '../../api/menuAdminApi';
import { readSession } from '../../lib/tokenStorage';
import { ProposalCard, ProposalCardStyles } from './ProposalCard';
import { PlanReview } from './PlanReview';

/*
 * Plan by Budget — relocated out of CustomerDashboardPage into BookingPage's Step 0.
 * Self-contained (`pbg-` prefix) so it drops into any surface.
 *
 * Signed in or not, the whole flow runs here: survey tiered proposals (POST
 * /api/suggestions/budget is anonymous), open one in <PlanReview> to edit it against
 * live server quotes, then add it to the cart. Sign-in happens at checkout, which
 * places the plan as a submitted booking, all or nothing.
 *
 * GOLDEN RULE: every money figure is rendered from a response, never recomputed.
 */

export interface PlanByBudgetProps {
  /** "Change Service" — back to the flow picker. */
  onBack: () => void;
  /** A plan went into the cart; the caller routes to it. */
  onAddedToCart: () => void;
}

/** The ask the current proposals were generated for — what the review editor prices against. */
interface Ask {
  budget: number;
  guestCount: number;
  eventDate: string;
  bookingType: 'FullService' | 'FoodDelivery';
  eventType: string | null;
}

export function PlanByBudget({ onBack, onAddedToCart }: PlanByBudgetProps) {
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
  /* Captured at "Suggest Plans", so editing the form afterwards can't quietly change
     the guest count or date a proposal being reviewed is priced for. */
  const [ask, setAsk] = useState<Ask | null>(null);
  const [chosen, setChosen] = useState<Proposal | null>(null);

  /* Tray dish names, so a tray row can say what is in it. A nicety: the cards and
     the editor render without it if the fetch fails. */
  const [trayDishes, setTrayDishes] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    fetchMenuTrays(readSession()?.token ?? '')
      .then((trays) => {
        if (!cancelled) setTrayDishes(Object.fromEntries(trays.map((t) => [t.id, t.dishes.map((d) => d.itemName)])));
      })
      .catch(() => {
        /* See above: dish names are optional. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isFull = bookingType === 'FullService';
  const csv = (s: string): string[] | null => {
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length ? arr : null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Number(budget) <= 0 || Number(guestCount) <= 0 || !eventDate) {
      setError('Enter a budget, guest count, and event date.');
      return;
    }
    setLoading(true); setError(''); setResult(null); setChosen(null);
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
      setAsk({
        budget: req.budget,
        guestCount: req.guestCount,
        eventDate: req.eventDate,
        bookingType: req.bookingType,
        eventType: req.eventType ?? null,
      });
    } catch (err) {
      setError(err instanceof SuggestionsApiError ? err.message : 'Could not generate suggestions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pbg-wrap">
      <PlanByBudgetStyles />
      <ProposalCardStyles />

      <form onSubmit={submit} className="pbg-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
              Plan by Budget
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem', maxWidth: 520 }}>
              Tell us your budget — we'll suggest complete, kitchen-priced configurations. Adjust any plan, add it to your cart, and sign in only when you check out.
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
                <ProposalCard
                  key={p.tier}
                  proposal={p}
                  onUse={setChosen}
                  actionLabel="Review this plan"
                  trayDishes={trayDishes}
                />
              ))}
            </div>
          </>
        )
      )}

      {chosen && ask && (
        <PlanReview
          source={{ kind: 'proposal', proposal: chosen, ...ask }}
          trayDishes={trayDishes}
          onClose={() => setChosen(null)}
          onDone={onAddedToCart}
        />
      )}
    </div>
  );
}

/**
 * The `pbg-` styles. Exported because <PlanReview> needs them wherever it opens,
 * including /cart, where a plan is edited without PlanByBudget on the page.
 */
export function PlanByBudgetStyles() {
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
      .pbg-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .pbg-row:last-child { border-bottom: none; }
      .pbg-line-name { font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; color: var(--text-primary); }
      .pbg-line-total { font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; min-width: 5.5rem; text-align: right; }
      .pbg-sub { font-family: var(--font-body); font-size: 0.66rem; font-weight: 300; color: var(--text-dim); margin-top: 0.12rem; }
      .pbg-problem { font-family: var(--font-body); font-size: 0.7rem; color: var(--danger-ink); margin-top: 0.15rem; }
      .pbg-tag { font-family: var(--font-body); font-size: 0.5rem; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500; color: var(--text-muted); background: var(--bg-subtle); border: 1px solid var(--border); padding: 0.15rem 0.45rem; border-radius: var(--r-full); }
      .pbg-step { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: var(--r-full); }
      .pbg-step button { background: none; border: none; cursor: pointer; padding: 0.28rem 0.62rem; color: var(--text-secondary); font-size: 0.9rem; line-height: 1; }
      .pbg-step button:disabled { opacity: 0.35; cursor: not-allowed; }
      .pbg-link { background: none; border: none; padding: 0; cursor: pointer; font-family: var(--font-body); font-size: 0.7rem; color: var(--primary); text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
      .pbg-total-row { display: flex; justify-content: space-between; gap: 1rem; font-family: var(--font-body); font-size: 0.8rem; color: var(--text-secondary); padding: 0.12rem 0; }
      .pbg-total-row.grand { font-size: 1rem; font-weight: 600; color: var(--text-primary); }
      .pbg-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); padding: 1.6rem 1.75rem; }
    `}</style>
  );
}
