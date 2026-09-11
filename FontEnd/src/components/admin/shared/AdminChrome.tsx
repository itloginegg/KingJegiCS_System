/**
 * Small shared chrome for the admin tabs: the error card every failed fetch
 * shows, the heading row each tab opens with, and the overview's stat icons.
 *
 * Presentational only — no state, no data access, nothing but props. They came
 * out of AdminDashboardPage first because that made them the easy third of the
 * extraction; the hard part of that file is the single 5,700-line component
 * function, not these.
 */
import type React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export function AdmErrorCard({ title, message, onRetry, retryLabel = 'Try Again', extraAction }: {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Rendered beside the retry. Carries the auth-expiry route back to sign-in,
      which the menu tab needs and the others do not. */
  extraAction?: React.ReactNode;
}) {
  return (
    <div
      className="adm-card"
      role="alert"
      style={{
        padding: '2.75rem 2rem', textAlign: 'center',
        borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)',
      }}
    >
      {/* Lucide in a tinted disc, per section 11 — the ⚠️ emoji rendered as a
          fixed-colour platform image and could not follow the danger token. */}
      <div
        style={{
          width: 48, height: 48, margin: '0 auto 0.9rem',
          borderRadius: 'var(--r-full)', background: 'var(--danger-muted)',
          color: 'var(--danger)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <AlertTriangle size={22} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
        {title}
      </h3>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8125rem', fontWeight: 400, color: 'var(--danger-ink)', maxWidth: 460, margin: '0 auto 1.4rem', lineHeight: 1.55 }}>
        {message}
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="adm-btn outline" onClick={onRetry}>{retryLabel}</button>
        {extraAction}
      </div>
    </div>
  );
}

export function AdminTabHeader({
  title,
  endpoints,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  actions,
  onRefresh,
  refreshing,
}: {
  title: string;
  endpoints?: React.ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  actions?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {endpoints && (
          <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            Live from the backend — {endpoints}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {onSearchChange && (
          <input
            type="search"
            /* The placeholder is the only visible cue, and a placeholder is not an
               accessible name — it is announced as a value hint and vanishes once
               the field has content. */
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, color: 'var(--text-primary)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '999px', padding: '11px 15px', minWidth: '220px' }}
          />
        )}
        {actions}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            style={{ width: '36px', height: '36px', borderRadius: '999px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1 }}
          >
            <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" className={refreshing ? 'spin' : ''} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
      </div>
    </div>
  );
}

export function OvIcon({ name }: { name: 'wallet' | 'clock' | 'calendar' | 'inbox' }) {
  const paths = {
    wallet: (
      <>
        <rect x="2.6" y="5" width="14.8" height="11" rx="2.6" />
        <path d="M2.6 8.6h14.8" />
        <circle cx="14" cy="12.2" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    clock: (
      <>
        <circle cx="10" cy="10" r="7.1" />
        <path d="M10 5.9v4.4l2.9 1.7" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4.6" width="14" height="12.4" rx="2.6" />
        <path d="M3 8.6h14M7 3.1v3M13 3.1v3" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 11.6 5.2 5.3A1.6 1.6 0 0 1 6.7 4.2h6.6a1.6 1.6 0 0 1 1.5 1.1l2.2 6.3v2.9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
        <path d="M3 11.6h3.6l.9 1.9h5l.9-1.9H17" />
      </>
    ),
  }[name];
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}
