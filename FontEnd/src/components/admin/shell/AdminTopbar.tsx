/**
 * The admin topbar: drawer toggle, the current panel's name, the notification bell
 * and the signed-in admin.
 *
 * The bell owns only whether its panel is open. The feed, the unread count and
 * what opening a notification does (switching tabs, seeding a search) belong to the
 * page, which also refreshes the feed from its live-updates connection.
 */
import { useState } from 'react';
import { notificationTarget, type AppNotification } from '../../../api/notificationsApi';
import { fmtDateTime } from '../../../lib/format';
import { FieldLabel } from '../shared/StatusBadge';

export interface AdminTopbarProps {
  /** Name of the panel on screen. */
  title: string;
  adminName: string;
  roleLabel: string;
  onOpenNav: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  /** Called as the bell opens, so the panel shows a fresh feed. */
  onRefreshNotifications: () => void;
  onReadAll: () => void;
  /** The bell has already closed itself when this runs. */
  onOpenNotification: (notification: AppNotification) => void;
}

export function AdminTopbar({
  title,
  adminName,
  roleLabel,
  onOpenNav,
  notifications,
  unreadCount,
  onRefreshNotifications,
  onReadAll,
  onOpenNotification,
}: AdminTopbarProps) {
  const [bellOpen, setBellOpen] = useState(false);

  return (
    <div className="adm-topbar">
      <button type="button" className="adm-iconbtn adm-burger" aria-label="Open navigation" onClick={onOpenNav}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="adm-topbar-title" style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--text-dim)' }}>
        {title}
      </span>
      <div style={{ flex: 1 }} />

      {/* notification bell — the in-app view of what the NotificationWorker sent */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="adm-iconbtn"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          aria-expanded={bellOpen}
          onClick={() => { setBellOpen((o) => !o); if (!bellOpen) onRefreshNotifications(); }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15,
                padding: '0 3px', borderRadius: 'var(--r-full)', background: 'var(--danger)',
                color: 'var(--accent-text)', fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {bellOpen && (
          <>
            {/* click-away layer, below the panel but above the page */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 130 }} onClick={() => setBellOpen(false)} />
            <div
              className="adm-card"
              style={{
                position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0, zIndex: 131,
                width: 340, maxWidth: '90vw', maxHeight: 420, overflowY: 'auto', padding: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)' }}>
                <FieldLabel text="Notifications" />
                {unreadCount > 0 && (
                  <button type="button" className="adm-btn outline" onClick={onReadAll}>
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', padding: '1.6rem 1rem', textAlign: 'center', margin: 0 }}>
                  Nothing yet. Overdue-payment digests and low-stock alerts show up here.
                </p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => { setBellOpen(false); onOpenNotification(n); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', border: 'none',
                      // Read rows stay clickable now that clicking navigates.
                      cursor: notificationTarget(n) === 'none' && n.readAt ? 'default' : 'pointer',
                      borderBottom: '1px solid var(--border)',
                      padding: '0.8rem 1rem',
                      background: n.readAt ? 'transparent' : 'var(--primary-muted)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
                      {!n.readAt && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />}
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {n.body}
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                      {fmtDateTime(n.sentAt)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }} className="adm-hide-sm">
        {adminName} · {roleLabel}
      </span>
      <div className="adm-avatar" title={adminName}>{adminName.charAt(0)}</div>
    </div>
  );
}
