/**
 * The admin sidebar: brand, navigation (with the Bookings status tree), theme
 * toggle and sign-out. Below 900px it is a drawer with its own scrim.
 *
 * Presentational. Which tab is active, whether the drawer is open, and what every
 * item does stay with the page, which also owns the URL those choices write to.
 */
import type { ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock, Circle, LogOut, Megaphone, ScrollText, Tent, Users, UtensilsCrossed, Wrench, X,
} from 'lucide-react';
import { ThemeToggle } from '../../ui/ThemeToggle';
import { BookingsTreeMenu } from '../bookings/BookingsTreeMenu';
import type { AdminNavItem, AdminTab } from './types';

type TreeProps = ComponentProps<typeof BookingsTreeMenu>;

export interface AdminSidebarProps {
  /** Drawer state; only meaningful below the drawer breakpoint. */
  open: boolean;
  onClose: () => void;
  /** The Operations group. Bookings renders as the status tree. */
  nav: AdminNavItem[];
  tab: AdminTab;
  placeholderName: string;
  placeholderItems: readonly string[];
  bookingsNav: Pick<TreeProps, 'expanded' | 'onToggleExpanded' | 'value' | 'onSelect' | 'counts' | 'totalCount'>;
  onOpenTab: (tab: AdminTab) => void;
  onOpenPlaceholder: (name: string) => void;
  /** Booking Histories owns a real pathname, so its active state comes from the route. */
  historiesActive: boolean;
  isOwner: boolean;
  onLogout: () => void;
}

export function AdminSidebar({
  open,
  onClose,
  nav,
  tab,
  placeholderName,
  placeholderItems,
  bookingsNav,
  onOpenTab,
  onOpenPlaceholder,
  historiesActive,
  isOwner,
  onLogout,
}: AdminSidebarProps) {
  return (
    <>
      <div className={`adm-scrim${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`adm-sidebar${open ? ' open' : ''}`}>
        <div className="adm-brand">
          <div className="adm-brand-mark">K</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              King Jegi
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500 }}>
              Admin Panel
            </div>
          </div>
          {/* Drawer close, per artboard 8b. Below 900px the sidebar is a drawer and
              had no visible dismiss — only the scrim, which is not discoverable and
              is easy to miss on a narrow screen. Hidden at desktop, where the
              sidebar is permanent and there is nothing to close. */}
          <button
            type="button"
            className="adm-iconbtn adm-drawer-close"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <nav className="adm-nav" aria-label="Admin navigation">
          <span className="adm-nav-caption">Operations</span>
          {nav.map((item) => (
            /* Bookings is an accordion over its status filters rather than a flat
               entry; the rest of NAV renders as it always has. */
            item.id === 'bookings' ? (
              <BookingsTreeMenu
                key={item.id}
                expanded={bookingsNav.expanded}
                onToggleExpanded={bookingsNav.onToggleExpanded}
                active={tab === 'bookings'}
                value={bookingsNav.value}
                onSelect={bookingsNav.onSelect}
                counts={bookingsNav.counts}
                totalCount={bookingsNav.totalCount}
                badge={item.badge}
              />
            ) : (
              <button
                key={item.id}
                type="button"
                className={`adm-nav-item${tab === item.id ? ' active' : ''}`}
                onClick={() => onOpenTab(item.id)}
              >
                <span className="adm-nav-icon">{item.icon}</span>
                {item.label}
                {item.badge != null && item.badge > 0 && <span className="adm-badge">{item.badge}</span>}
              </button>
            )
          ))}

          <span className="adm-nav-caption" style={{ marginTop: '0.9rem' }}>Management</span>
          <button
            type="button"
            className={`adm-nav-item${tab === 'menus' ? ' active' : ''}`}
            onClick={() => onOpenTab('menus')}
          >
            <span className="adm-nav-icon"><UtensilsCrossed size={18} strokeWidth={1.75} /></span>
            Menus &amp; Dishes
          </button>
          <button
            type="button"
            className={`adm-nav-item${tab === 'rentals' ? ' active' : ''}`}
            onClick={() => onOpenTab('rentals')}
          >
            <span className="adm-nav-icon"><Tent size={18} strokeWidth={1.75} /></span>
            Rentals
          </button>
          <button
            type="button"
            className={`adm-nav-item${tab === 'services' ? ' active' : ''}`}
            onClick={() => onOpenTab('services')}
          >
            <span className="adm-nav-icon"><Wrench size={18} strokeWidth={1.75} /></span>
            Service Items
          </button>
          <Link
            to="/admin/booking-histories"
            className={`adm-nav-item${historiesActive ? ' active' : ''}`}
          >
            <span className="adm-nav-icon" aria-hidden="true"><CalendarClock size={18} strokeWidth={1.75} /></span>
            Booking Histories
          </Link>
          <button
            type="button"
            className={`adm-nav-item${tab === 'audit' ? ' active' : ''}`}
            onClick={() => onOpenTab('audit')}
          >
            <span className="adm-nav-icon"><ScrollText size={18} strokeWidth={1.75} /></span>
            Audit Log
          </button>
          <button
            type="button"
            className={`adm-nav-item${tab === 'announcements' ? ' active' : ''}`}
            onClick={() => onOpenTab('announcements')}
          >
            <span className="adm-nav-icon"><Megaphone size={18} strokeWidth={1.75} /></span>
            Announcements
          </button>
          {/* Owner-only. This is NOT the security boundary — the server's
              [Authorize(Roles = "Owner")] is. Hiding the item just spares an
              Assistant a tab that would only 403 at them. An undefined adminRole
              (a session persisted before that field existed) fails closed. */}
          {isOwner && (
            <button
              type="button"
              className={`adm-nav-item${tab === 'staff' ? ' active' : ''}`}
              onClick={() => onOpenTab('staff')}
            >
              <span className="adm-nav-icon"><Users size={18} strokeWidth={1.75} /></span>
              Staff Management
            </button>
          )}
          {placeholderItems.map((name) => (
            <button
              key={name}
              type="button"
              className={`adm-nav-item${tab === 'placeholder' && placeholderName === name ? ' active' : ''}`}
              onClick={() => onOpenPlaceholder(name)}
            >
              <span className="adm-nav-icon"><Circle size={18} strokeWidth={1.75} /></span>
              {name}
            </button>
          ))}
        </nav>

        <div className="adm-sidebar-foot">
          {/* The admin dashboard had a full `.dark` styling path but no way to reach
              it — an admin had to visit the landing page to change theme. */}
          <ThemeToggle className="adm-foot-btn" showLabel size={14} />
          <button type="button" className="adm-foot-btn danger" onClick={onLogout}>
            <LogOut size={15} strokeWidth={1.75} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
