import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Packages', href: '/packages' },
  { label: 'Menus', href: '/menus' },
  { label: 'Rentals', href: '/rentals' },
  { label: 'Quotation', href: '/book' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

/** Site navbar — absolutely positioned over whatever section renders it. */
export function Navbar({ activePage }: { activePage?: string }) {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const iconBtn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--r-full)',
  };

  const renderLink = (link: { label: string; href: string }, style?: React.CSSProperties, onClick?: () => void) => {
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
    <header style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }}>
      <style>{`
        .nav-links {
          display: flex;
          align-items: center;
          gap: 2rem;
        }
        .nav-link {
          font-family: var(--font-body);
          font-size: 0.66rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 500;
          color: var(--text-secondary);
          text-decoration: none;
          transition: color 0.2s;
          white-space: nowrap;
        }
        .nav-link:hover { color: var(--primary); }
        .nav-link-active { color: var(--primary); }
        .nav-signin { padding: 0 0.75rem; }
        .nav-burger { display: none !important; }
        .nav-cta {
          background: var(--primary);
          color: var(--primary-text);
          border: none;
          padding: 0.7rem 1.5rem;
          font-family: var(--font-body);
          font-size: 0.72rem;
          font-weight: 500;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          cursor: pointer;
          border-radius: var(--r-full);
          transition: background 0.25s, transform 0.2s, box-shadow 0.2s;
          text-decoration: none;
          display: inline-block;
          white-space: nowrap;
        }
        .nav-cta:hover {
          background: var(--primary-hover);
          transform: translateY(-2px);
          box-shadow: var(--shadow-green);
        }
        @media (max-width: 1020px) {
          .nav-links { display: none; }
          .nav-burger { display: flex !important; }
          .nav-signin { display: none; }
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
          padding: '1.4rem 2.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.5rem',
        }}
      >
        <Link
          to="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.45rem',
            fontWeight: 600,
            letterSpacing: '0.22em',
            color: 'var(--accent)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          KING JEGI
        </Link>

        <ul className="nav-links" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {NAV_LINKS.map((link) => (
            <li key={link.label}>{renderLink(link)}</li>
          ))}
        </ul>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button type="button" aria-label="View cart" style={iconBtn}>
            <CartIcon />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ ...iconBtn, color: 'var(--accent)' }}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <Link to="/login" className="nav-link nav-signin">
            Sign In
          </Link>

          <Link to="/book" className="nav-cta">
            Book Now
          </Link>

          <button
            type="button"
            className="nav-burger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            style={iconBtn}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="20" height="20" aria-hidden="true">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen && (
        <ul
          className="nav-mobile-panel"
          style={{
            listStyle: 'none',
            margin: '0 1.25rem',
            padding: '0.75rem',
            background: 'var(--surface-glass)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--r-lg)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            boxShadow: 'var(--shadow-glass)',
          }}
        >
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              {renderLink(link, { display: 'block', padding: '0.7rem 0.75rem' }, () => setMenuOpen(false))}
            </li>
          ))}
          <li>
            <Link to="/login" className="nav-link" style={{ display: 'block', padding: '0.7rem 0.75rem' }}>
              Sign In
            </Link>
          </li>
        </ul>
      )}
    </header>
  );
}
