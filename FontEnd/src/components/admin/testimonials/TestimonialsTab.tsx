/**
 * The Testimonials tab: the moderation queue for customer reviews. Approving one
 * publishes it to the landing page; rejecting or removing one pulls it.
 *
 * OWNED HERE: the list, its loading and error flags, the status filter and the
 * row being saved. The list is always fetched whole — the filter pills show
 * per-status counts, which a server-filtered list would get wrong.
 *
 * REPORTED UP: the pending count, because the dashboard's sidebar badge shows it
 * while this tab is not mounted. The dashboard keeps only that number.
 */
import { useEffect, useState } from 'react';
import { Check, RotateCw, Star, X } from 'lucide-react';
import {
  getTestimonials,
  moderateTestimonial,
  TestimonialApiError,
  type Testimonial,
  type TestimonialStatus,
} from '../../../api/testimonialsApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmtDate } from '../../../lib/format';

const TESTI_STATUS: Record<TestimonialStatus, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--warning-ink)' },
  Approved: { label: 'Approved', color: 'var(--status-paid)' },
  Rejected: { label: 'Rejected', color: 'var(--danger-ink)' },
};

export interface TestimonialsTabProps {
  notify: (kind: 'success' | 'error' | 'info', message: string) => void;
  /** Receives the Pending count whenever it changes, for the sidebar badge. */
  onPendingCountChange: (count: number) => void;
}

export function TestimonialsTab({ notify, onPendingCountChange }: TestimonialsTabProps) {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [testiLoading, setTestiLoading] = useState(false);
  const [testiError, setTestiError] = useState<string | null>(null);
  const [testiBusyId, setTestiBusyId] = useState<string | null>(null);
  const [testiFilter, setTestiFilter] = useState<'all' | TestimonialStatus>('Pending');
  /* Gates the badge report below. Without it the first render reports 0 before
     the fetch lands, and the sidebar badge blinks to nothing on every visit. */
  const [loadedOnce, setLoadedOnce] = useState(false);

  const loadTestimonials = async () => {
    const session = readSession();
    if (!session?.token) {
      setTestiError('You are not signed in. Sign in with an Owner or Assistant account to moderate testimonials.');
      return;
    }
    setTestiLoading(true);
    setTestiError(null);
    try {
      // Always fetch every status: the filter pills show per-status counts, which
      // would be wrong if the server had already filtered the list for us.
      setTestimonials(await getTestimonials(session.token));
      setLoadedOnce(true);
    } catch (err) {
      setTestiError(
        err instanceof TestimonialApiError ? err.message : 'Could not load testimonials. Please try again.',
      );
    } finally {
      setTestiLoading(false);
    }
  };

  /* Approve/reject writes through to the backend; only Approved rows reach the
     landing page, so this is what actually publishes or pulls a review. */
  const setTestiStatus = async (id: string, status: 'Approved' | 'Rejected') => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setTestiBusyId(id);
    try {
      const updated = await moderateTestimonial(session.token, id, status);
      setTestimonials((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: updated.status, moderatedAt: updated.moderatedAt, moderationNote: updated.moderationNote }
            : t,
        ),
      );
      notify('success', status === 'Approved' ? 'Testimonial published to the landing page.' : 'Testimonial rejected.');
    } catch (err) {
      notify('error', err instanceof TestimonialApiError ? err.message : 'Could not update the testimonial.');
    } finally {
      setTestiBusyId(null);
    }
  };

  useEffect(() => {
    void loadTestimonials();
  }, []);

  const pendingTesti = testimonials.filter((t) => t.status === 'Pending').length;
  useEffect(() => {
    if (loadedOnce) onPendingCountChange(pendingTesti);
  }, [loadedOnce, pendingTesti, onPendingCountChange]);

  const filteredTesti = testimonials.filter((t) => testiFilter === 'all' || t.status === testiFilter);

  return (
    <div className="fade-up" style={{ background: 'var(--band-bg)', border: '1px solid var(--band-glass-border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', lineHeight: 1.1, color: 'var(--band-text)' }}>Testimonial Moderation</h2>
          <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.5, color: 'var(--band-muted)' }}>
            Live from the backend — <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--band-muted)' }}>/api/Testimonials</span> · approved reviews appear on the landing page
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1, color: 'var(--band-muted)' }}>
            {pendingTesti} pending review
          </span>
          <span onClick={() => void loadTestimonials()} style={{ width: '34px', height: '34px', borderRadius: '999px', background: 'rgba(238, 243, 234,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            {testiLoading ? <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--band-text)', animation: 'spin 1s linear infinite' }} /> : <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--band-text)' }} />}
          </span>
        </div>
      </div>

      {testiError && (
        <div style={{ padding: '1.4rem 1.6rem', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: '16px' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
            {testiError}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
        {(['Pending', 'Approved', 'Rejected', 'all'] as const).map((k) => {
          const count = k === 'all' ? testimonials.length : testimonials.filter((t) => t.status === k).length;
          const isActive = testiFilter === k;
          return (
            <span
              key={k}
              onClick={() => setTestiFilter(k)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: isActive ? 600 : 500, lineHeight: 1, padding: '10px 15px', borderRadius: '999px', background: isActive ? 'var(--accent)' : 'rgba(238, 243, 234,.07)', color: isActive ? 'var(--band-bg)' : 'var(--band-muted)', cursor: 'pointer' }}
            >
              {k === 'all' ? 'All' : TESTI_STATUS[k].label}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 500, lineHeight: 1, color: isActive ? 'var(--band-bg)' : 'var(--band-muted)' }}>{count}</span>
            </span>
          );
        })}
      </div>

      {filteredTesti.length === 0 ? (
        <div style={{ padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--band-muted)', background: 'var(--band-glass)', border: '1px solid var(--band-glass-border)', borderRadius: '18px' }}>
          No testimonials in this view.
        </div>
      ) : (
        filteredTesti.map((t) => {
          return (
            <div key={t.id} style={{ background: 'var(--band-glass)', border: '1px solid var(--band-glass-border)', borderRadius: '18px', padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
                <span style={{ flex: 'none', width: '42px', height: '42px', borderRadius: '999px', background: 'rgba(109, 196, 137,.16)', border: '1px solid rgba(109, 196, 137,.34)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: 600, lineHeight: 1, color: 'var(--accent)' }}>
                  {t.authorName.charAt(0)}
                </span>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--band-text)' }}>{t.authorName}</span>
                    <span style={{ display: 'flex', gap: '2px' }} aria-label={`${t.rating} out of 5`}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} size={13} strokeWidth={1.75} fill={i < t.rating ? 'var(--band-accent)' : 'var(--band-border)'} color={i < t.rating ? 'var(--band-accent)' : 'var(--band-border)'} />
                      ))}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-body)', fontSize: '15px', fontWeight: 400, lineHeight: 1.6, fontStyle: 'italic', color: 'var(--band-muted)' }}>
                    "{t.body}"
                  </p>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--band-muted)' }}>
                    Submitted {fmtDate(t.submittedAt)} · {t.customerEmail} · reviewing "{t.bookingName}" ({fmtDate(t.eventDate)})
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', background: t.status === 'Pending' ? 'rgba(186, 181, 105,.18)' : t.status === 'Approved' ? 'rgba(31,122,51,.18)' : 'rgba(220,38,38,.18)', color: t.status === 'Pending' ? '#BAB569' : t.status === 'Approved' ? '#4ade80' : '#f87171' }}>
                  {t.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap', marginTop: '16px' }}>
                {t.status !== 'Approved' && (
                  <button type="button" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Approved')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: '#1F7A33', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '999px', cursor: 'pointer' }}>
                    {testiBusyId === t.id ? 'Saving...' : <><Check size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: '#fff' }} /> Approve — publish to landing page</>}
                  </button>
                )}
                {t.status !== 'Rejected' && (
                  <button type="button" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Rejected')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: '#DC2626', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '999px', cursor: 'pointer' }}>
                    {testiBusyId === t.id ? 'Saving...' : <><X size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: '#fff' }} /> {t.status === 'Approved' ? 'Remove from landing page' : 'Reject'}</>}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
