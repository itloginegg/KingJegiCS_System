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
 *
 * SENTIMENT: each review carries what its TEXT says (Positive / Neutral / Negative),
 * scored by Gemini or, when that was unavailable, by the backend's Naive Bayes classifier
 * (or, for text it has no words for, the rule-based lexicon). It is advisory: nothing is
 * approved or hidden because of it. What it adds is the summary strip, a chip per
 * review, and a "Needs a look" filter for reviews whose stars and words disagree. The
 * strip also shows the Naive Bayes model's training size and cross-validated accuracy.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, RotateCw, Sparkles, Star, X } from 'lucide-react';
import {
  analyzeMissingSentiment,
  getSentimentModel,
  getTestimonials,
  moderateTestimonial,
  reanalyzeSentiment,
  TestimonialApiError,
  type SentimentModel,
  type SentimentSource,
  type Testimonial,
  type TestimonialSentiment,
  type TestimonialStatus,
} from '../../../api/testimonialsApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmtDate } from '../../../lib/format';

const TESTI_STATUS: Record<TestimonialStatus, { label: string; color: string }> = {
  Pending: { label: 'Pending', color: 'var(--warning-ink)' },
  Approved: { label: 'Approved', color: 'var(--status-paid)' },
  Rejected: { label: 'Rejected', color: 'var(--danger-ink)' },
};

/* Theme status tokens rather than fixed colours, so the chips keep their contrast in
   both the light and the dark admin theme. Tinted grounds at 14%, like StatusBadge. */
const SENTIMENT_STYLE: Record<TestimonialSentiment, { bg: string; fg: string }> = {
  Positive: { bg: 'color-mix(in srgb, var(--status-paid) 14%, transparent)', fg: 'var(--status-paid)' },
  Neutral: { bg: 'color-mix(in srgb, var(--warning-ink) 14%, transparent)', fg: 'var(--warning-ink)' },
  Negative: { bg: 'color-mix(in srgb, var(--danger-ink) 14%, transparent)', fg: 'var(--danger-ink)' },
};

/* How each scoring method is named on a review: the lead-in to its reason, and the
   chip's tooltip. */
const SOURCE_LABEL: Record<SentimentSource, { read: string; title: string }> = {
  Gemini: { read: 'AI read:', title: 'Scored by AI (Gemini)' },
  NaiveBayes: { read: 'Naive Bayes read:', title: 'Scored by the Naive Bayes classifier (Gemini was unavailable)' },
  Lexicon: { read: 'Rule-based read:', title: 'Scored by the rule-based lexicon' },
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

type TestiFilter = 'all' | TestimonialStatus | 'mismatch';

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
  const [testiFilter, setTestiFilter] = useState<TestiFilter>('Pending');
  const [analyzing, setAnalyzing] = useState(false);
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [sentimentModel, setSentimentModel] = useState<SentimentModel | null>(null);
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

  /* Model stats are a footnote to the strip, so a failure just leaves the line out. Re-read
     after any analysis: new Gemini labels become new training examples. */
  const loadSentimentModel = async () => {
    const session = readSession();
    if (!session?.token) return;
    try {
      setSentimentModel(await getSentimentModel(session.token));
    } catch {
      setSentimentModel(null);
    }
  };

  /* Reviews from before sentiment existed have none. Batches of 20, so one click never
     queues more Gemini calls than the free tier comfortably takes; the button stays
     until none are left. */
  const analyzeMissing = async () => {
    const session = readSession();
    if (!session?.token) return;
    setAnalyzing(true);
    try {
      const { analyzed, remaining } = await analyzeMissingSentiment(session.token, 20);
      await loadTestimonials();
      void loadSentimentModel();
      notify('success', remaining > 0
        ? `Analyzed ${analyzed} review${analyzed === 1 ? '' : 's'}; ${remaining} left.`
        : `Analyzed ${analyzed} review${analyzed === 1 ? '' : 's'}. Every review now has a sentiment.`);
    } catch (err) {
      notify('error', err instanceof TestimonialApiError ? err.message : 'Could not analyze the reviews.');
    } finally {
      setAnalyzing(false);
    }
  };

  const reanalyze = async (id: string) => {
    const session = readSession();
    if (!session?.token) return;
    setReanalyzingId(id);
    try {
      const r = await reanalyzeSentiment(session.token, id);
      setTestimonials((prev) => prev.map((t) => (t.id === id ? { ...t, ...r } : t)));
      void loadSentimentModel();
      const fallback = r.sentimentSource === 'NaiveBayes' ? ' (Naive Bayes; Gemini was unavailable)'
        : r.sentimentSource === 'Lexicon' ? ' (rule-based; Gemini was unavailable)'
        : '';
      notify('success', `Re-analyzed: ${r.sentiment ?? 'no result'}${fallback}.`);
    } catch (err) {
      notify('error', err instanceof TestimonialApiError ? err.message : 'Could not re-analyze this review.');
    } finally {
      setReanalyzingId(null);
    }
  };

  useEffect(() => {
    void loadTestimonials();
    void loadSentimentModel();
  }, []);

  const pendingTesti = testimonials.filter((t) => t.status === 'Pending').length;
  useEffect(() => {
    if (loadedOnce) onPendingCountChange(pendingTesti);
  }, [loadedOnce, pendingTesti, onPendingCountChange]);

  const filteredTesti = testimonials.filter((t) =>
    testiFilter === 'all' ? true : testiFilter === 'mismatch' ? t.ratingMismatch : t.status === testiFilter);

  /* Satisfaction summary over every review, whatever the filter shows. */
  const analyzed = testimonials.filter((t) => t.sentiment !== null);
  const countOf = (s: TestimonialSentiment) => analyzed.filter((t) => t.sentiment === s).length;
  const unanalyzed = testimonials.length - analyzed.length;
  const mismatches = testimonials.filter((t) => t.ratingMismatch).length;
  const positiveShare = analyzed.length > 0 ? Math.round((countOf('Positive') / analyzed.length) * 100) : null;

  return (
    <div className="fade-up" style={{ background: 'var(--band-bg)', border: '1px solid var(--band-glass-border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', lineHeight: 1.1, color: 'var(--band-text)' }}>Testimonial Moderation</h2>
          <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.5, color: 'var(--band-muted)' }}>
            Customer reviews waiting for a decision · approved reviews appear on the landing page
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

      {testimonials.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap', padding: '14px 18px', background: 'var(--band-glass)', border: '1px solid var(--band-glass-border)', borderRadius: '14px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--band-muted)' }}>Customer sentiment</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 600, lineHeight: 1.2, color: 'var(--band-text)' }}>
              {positiveShare === null ? '—' : `${positiveShare}% positive`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(['Positive', 'Neutral', 'Negative'] as const).map((s) => (
              <span key={s} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, padding: '8px 12px', borderRadius: '999px', background: SENTIMENT_STYLE[s].bg, color: SENTIMENT_STYLE[s].fg }}>
                {s} {countOf(s)}
              </span>
            ))}
          </div>
          {mismatches > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, color: 'var(--danger-ink)' }}>
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
              {mismatches} where the stars and the words disagree
            </span>
          )}
          {unanalyzed > 0 && (
            <button type="button" onClick={() => void analyzeMissing()} disabled={analyzing} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: 'var(--accent)', color: 'var(--band-bg)', border: 'none', padding: '10px 14px', borderRadius: '999px', cursor: analyzing ? 'wait' : 'pointer' }}>
              <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
              {analyzing ? 'Analyzing…' : `Analyze ${unanalyzed} older review${unanalyzed === 1 ? '' : 's'}`}
            </button>
          )}
          {sentimentModel && (
            <span style={{ flexBasis: '100%', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.5, color: 'var(--band-muted)' }}>
              Fallback model: Naive Bayes, trained on {sentimentModel.seedExamples} starter examples
              {' + '}{sentimentModel.reviewExamples} Gemini-labelled review{sentimentModel.reviewExamples === 1 ? '' : 's'}
              {sentimentModel.accuracy !== null && ` · ${pct(sentimentModel.accuracy)} accurate (${sentimentModel.folds}-fold cross-validation)`}
              {sentimentModel.reviewAccuracy !== null && ` · agrees with Gemini on ${pct(sentimentModel.reviewAccuracy)} of real reviews`}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
        {(['Pending', 'Approved', 'Rejected', 'mismatch', 'all'] as const).map((k) => {
          const count = k === 'all' ? testimonials.length
            : k === 'mismatch' ? mismatches
            : testimonials.filter((t) => t.status === k).length;
          const isActive = testiFilter === k;
          return (
            <span
              key={k}
              onClick={() => setTestiFilter(k)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: isActive ? 600 : 500, lineHeight: 1, padding: '10px 15px', borderRadius: '999px', background: isActive ? 'var(--accent)' : 'rgba(238, 243, 234,.07)', color: isActive ? 'var(--band-bg)' : 'var(--band-muted)', cursor: 'pointer' }}
            >
              {k === 'all' ? 'All' : k === 'mismatch' ? 'Needs a look' : TESTI_STATUS[k].label}
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
                  {t.ratingMismatch && (
                    <p role="note" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '0 0 10px', padding: '9px 12px', borderRadius: '10px', background: 'var(--danger-muted)', border: '1px solid color-mix(in srgb, var(--danger) 28%, transparent)', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 500, lineHeight: 1.5, color: 'var(--danger-ink)' }}>
                      <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" style={{ flex: 'none', marginTop: '2px' }} />
                      <span>
                        {t.rating >= 4
                          ? `${t.rating} stars, but the text reads negative. Worth reading before publishing.`
                          : `${t.rating} star${t.rating === 1 ? '' : 's'}, but the text reads positive. The rating may be a slip.`}
                      </span>
                    </p>
                  )}
                  {t.sentiment && t.sentimentReason && (
                    <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-body)', fontSize: '12px', lineHeight: 1.5, color: 'var(--band-muted)' }}>
                      <strong style={{ fontWeight: 600, color: 'var(--band-text)' }}>
                        {SOURCE_LABEL[t.sentimentSource ?? 'Lexicon'].read}
                      </strong>{' '}
                      {t.sentimentReason}
                    </p>
                  )}
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--band-muted)' }}>
                    Submitted {fmtDate(t.submittedAt)} · {t.customerEmail} · reviewing "{t.bookingName}" ({fmtDate(t.eventDate)})
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                {t.sentiment ? (
                  <span
                    title={`${SOURCE_LABEL[t.sentimentSource ?? 'Lexicon'].title} · score ${t.sentimentScore ?? 0}`}
                    style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', background: SENTIMENT_STYLE[t.sentiment].bg, color: SENTIMENT_STYLE[t.sentiment].fg }}
                  >
                    {t.sentiment}
                  </span>
                ) : (
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 500, lineHeight: 1, color: 'var(--band-muted)' }}>Not analyzed</span>
                )}
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', background: t.status === 'Pending' ? 'rgba(186, 181, 105,.18)' : t.status === 'Approved' ? 'rgba(31,122,51,.18)' : 'rgba(220,38,38,.18)', color: t.status === 'Pending' ? '#BAB569' : t.status === 'Approved' ? '#4ade80' : '#f87171' }}>
                  {t.status}
                </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap', marginTop: '16px' }}>
                {t.status !== 'Approved' && (
                  <button type="button" disabled={testiBusyId === t.id} onClick={() => void setTestiStatus(t.id, 'Approved')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: '#1F7A33', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '999px', cursor: 'pointer' }}>
                    {testiBusyId === t.id ? 'Saving...' : <><Check size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: '#fff' }} /> Approve — publish to landing page</>}
                  </button>
                )}
                <button type="button" disabled={reanalyzingId === t.id} onClick={() => void reanalyze(t.id)} title="Run the sentiment analysis again for this review" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 500, lineHeight: 1, background: 'transparent', color: 'var(--band-muted)', border: '1px solid var(--band-glass-border)', padding: '12px 16px', borderRadius: '999px', cursor: 'pointer' }}>
                  <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
                  {reanalyzingId === t.id ? 'Analyzing…' : t.sentiment ? 'Re-analyze' : 'Analyze'}
                </button>
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
