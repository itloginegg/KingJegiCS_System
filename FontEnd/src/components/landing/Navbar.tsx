import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, ShoppingCart, X } from 'lucide-react';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useAuth } from '../../hooks/useAuth';

/**
 * Sentence case, not the old 0.22em uppercase tracking.
 *
 * "Book Now" is gone from this list: it is the rose pill on the right, and having
 * it in both places made the bar carry the same destination twice.
 */
const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Packages', href: '/packages' },
  { label: 'Menus', href: '/menus' },
  { label: 'Rentals', href: '/rentals' },
];

export interface NavbarProps {
  activePage?: string;
  /** Item count for the cart badge (0 hides it). Defaults to 0 so other pages are unaffected. */
  cartCount?: number;
  /** Click handler for the cart icon (e.g. open the checkout modal). Optional. */
  onCartClick?: () => void;
  /**
   * How the bar sits on the page.
   *
   * `overlay` (default) is the historical behaviour — absolutely positioned over
   * whatever section renders it, which every page except the landing page relies
   * on for its hero to start at y=0. `sticky` is the new direction's own bar: it
   * holds the top of the viewport on a tinted, blurred ground with a hairline
   * under it. Kept a prop rather than a global switch so adopting it is per-page
   * and does not silently reflow five heroes that were built around the overlay.
   */
  placement?: 'overlay' | 'sticky';
}

/** Site navbar. */
export function Navbar({
  activePage,
  cartCount = 0,
  onCartClick,
  placement = 'overlay',
}: NavbarProps) {
  const { isAuthenticated, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const sticky = placement === 'sticky';

  const iconBtn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--r-full)',
    transition: 'background 0.2s, color 0.2s',
  };

  const renderLink = (
    link: { label: string; href: string },
    style?: React.CSSProperties,
    onClick?: () => void,
  ) => {
    const className = `nav-link${activePage?.toLowerCase() === link.label.toLowerCase() ? ' nav-link-active' : ''}`;
    return link.href.includes('#') ? (
      <a href={link.href} className={className} style={style} onClick={onClick}>
        {link.label}
      </a>
    ) : (
      <Link to={link.href} className={className} style={style} onClick={onClick}>
        {link.label}
      </Link>
    );
  };

  return (
    <header
      style={
        sticky
          ? {
              position: 'sticky',
              top: 0,
              zIndex: 30,
              /* Tinted rather than opaque, so the hero's ground reads through the
                 bar instead of stopping dead at a seam. */
              background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderBottom: '1px solid var(--border)',
            }
          : { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }
      }
    >
      <style>{`
        .nav-links {
          display: flex;
          align-items: center;
          gap: 1.65rem;
        }
        .nav-link {
          font-family: var(--font-body);
          font-size: 0.8125rem;
          font-weight: 500;
          letter-spacing: 0;
          text-transform: none;
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.2s;
          white-space: nowrap;
        }
        .nav-link:hover { color: var(--text-primary); }
        .nav-link-active { color: var(--text-primary); font-weight: 600; }
        .nav-signin { padding: 0 0.5rem; }
        .nav-icon:hover { background: var(--primary-muted); color: var(--text-primary); }
        .nav-burger { display: none !important; }
        .nav-cta {
          background: var(--accent);
          color: var(--accent-text);
          border: none;
          padding: 0.7rem 1.25rem;
          font-family: var(--font-body);
          font-size: 0.78125rem;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          border-radius: var(--r-full);
          transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
          text-decoration: none;
          display: inline-block;
          white-space: nowrap;
        }
        .nav-cta:hover {
          background: var(--accent-hover);
          transform: translateY(-1px);
          box-shadow: var(--shadow-gold);
        }
        .nav-link:focus-visible,
        .nav-cta:focus-visible,
        .nav-icon:focus-visible,
        .nav-burger:focus-visible,
        .nav-logo:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: var(--r-sm);
        }
        @media (max-width: 1020px) {
          .nav-links { display: none; }
          .nav-burger { display: flex !important; }
          .nav-signin { display: none; }
          .nav-desktop-cta { display: none; }
        }
        @media (min-width: 1021px) {
          .nav-mobile-panel { display: none; }
        }
      `}</style>

      <nav
        aria-label="Main navigation"
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: sticky ? '1rem 2.5rem' : '1.4rem 2.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.5rem',
        }}
      >
        {/* Wordmark and the section links read as one unit — the mockup groups them
            on the left and keeps account actions on the right, rather than pushing
            the links to dead centre. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2.25rem' }}>
          <Link
            to="/"
            className="nav-logo"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.1875rem',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            King&nbsp;Jegi
          </Link>

          <ul className="nav-links" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {NAV_LINKS.map((link) => (
              <li key={link.label}>{renderLink(link)}</li>
            ))}
          </ul>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            className="nav-icon"
            aria-label={cartCount > 0 ? `View cart (${cartCount} item${cartCount === 1 ? '' : 's'})` : 'View cart'}
            style={{ ...iconBtn, position: 'relative' }}
            onClick={onCartClick}
          >
            <ShoppingCart size={18} strokeWidth={1.75} aria-hidden="true" />
            {cartCount > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', top: 2, right: 2,
                  minWidth: 15, height: 15, padding: '0 3px',
                  borderRadius: 'var(--r-full)',
                  background: 'var(--accent)', color: 'var(--accent-text)',
                  fontFamily: 'var(--font-numeric)', fontSize: '0.5rem', fontWeight: 500,
                  lineHeight: '15px', textAlign: 'center',
                }}
              >
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </button>

          <ThemeToggle className="nav-icon" style={iconBtn} />

          {isAuthenticated ? (
            <>
              <Link to="/dashboard" className="nav-link nav-signin">
                Dashboard
              </Link>
              <button type="button" className="nav-link nav-signin" onClick={logout} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-link nav-signin">
                Sign in
              </Link>
              <Link to="/book" className="nav-cta nav-desktop-cta">
                Book now
              </Link>
            </>
          )}

          {isAuthenticated && (
            <Link to="/book" className="nav-cta nav-desktop-cta">
              Book now
            </Link>
          )}

          <button
            type="button"
            className="nav-burger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            style={iconBtn}
          >
            {menuOpen
              ? <X size={20} strokeWidth={1.75} aria-hidden="true" />
              : <Menu size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div
          className="nav-mobile-panel"
          style={{
            margin: '0 1.25rem 0.75rem',
            padding: '0.5rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                {renderLink(
                  link,
                  { display: 'block', padding: '0.75rem 0.85rem', fontSize: '0.9375rem' },
                  () => setMenuOpen(false),
                )}
              </li>
            ))}
            {isAuthenticated ? (
              <>
                <li>
                  <Link to="/dashboard" className="nav-link" style={{ display: 'block', padding: '0.75rem 0.85rem', fontSize: '0.9375rem' }} onClick={() => setMenuOpen(false)}>
                    Dashboard
                  </Link>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); logout(); }}
                    className="nav-link"
                    style={{ background: 'none', border: 'none', textAlign: 'left', width: '100%', display: 'block', padding: '0.75rem 0.85rem', fontSize: '0.9375rem', cursor: 'pointer' }}
                  >
                    Sign out
                  </button>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Link to="/login" className="nav-link" style={{ display: 'block', padding: '0.75rem 0.85rem', fontSize: '0.9375rem' }} onClick={() => setMenuOpen(false)}>
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link to="/register" className="nav-link" style={{ display: 'block', padding: '0.75rem 0.85rem', fontSize: '0.9375rem' }} onClick={() => setMenuOpen(false)}>
                    Register
                  </Link>
                </li>
              </>
            )}
          </ul>
          <Link
            to="/book"
            className="nav-cta"
            style={{ display: 'block', textAlign: 'center', margin: '0.35rem 0.35rem 0.35rem' }}
            onClick={() => setMenuOpen(false)}
          >
            Book now
          </Link>
        </div>
      )}
    </header>
  );
}
